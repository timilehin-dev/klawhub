import { inngest } from "../client";
import { analyzeData } from "@/lib/agents/analyst";
import { postToThread, addReaction, removeReaction, uploadBinaryFile } from "@/lib/slack/client";
import { updateTask, trackSkillUsage } from "@/lib/db";
import type { SandboxResponse } from "@/types";

interface AnalyticsEventData {
  slackChannelId: string;
  slackThreadTs: string;
  slackUserId: string;
  messageText: string;
  taskId: string;
  data?: string;
  teamId?: string;
}

interface AnalyticsResult {
  code: string;
  execution: SandboxResponse & { output_file?: string; filename?: string };
  insights: string;
}

export const analyticsWorkflow = inngest.createFunction(
  { id: "analytics-task", name: "Analytics Task", retries: 2 },
  { event: "slack/analytics.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, slackUserId, taskId, teamId } =
      event.data as AnalyticsEventData;

    try {
      // Step 1: Run analysis
      const result = await step.run("run-analysis", async () => {
        await updateTask(taskId, { status: "processing" });
        const r = await analyzeData(event.data.messageText, event.data.data, { taskId, slackUserId });
        return r as AnalyticsResult;
      });

      // Step 2: Deliver results
      await step.run("deliver-analysis", async () => {
        const exec = result.execution;

        // Upload chart if generated
        if (exec.output_file) {
          const buffer = Buffer.from(exec.output_file, "base64");
          const chartFilename = exec.filename || `analysis-${taskId.slice(0, 8)}.png`;

          await uploadBinaryFile(
            slackChannelId,
            slackThreadTs,
            buffer,
            chartFilename,
            "Analysis Chart",
            teamId
          );
        }

        const outcome = exec.success ? "success" : "error";

        await updateTask(taskId, {
          status: exec.success ? "done" : "error",
          result: {
            stdout: exec.stdout || "",
            insights: String(result.insights),
          },
        });

        try {
          await removeReaction(slackChannelId, slackThreadTs, "chart_with_upwards_trend", teamId);
        } catch { /* ok */ }
        await addReaction(
          slackChannelId,
          slackThreadTs,
          exec.success ? "white_check_mark" : "warning",
          teamId
        );

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Analysis ${exec.success ? "Complete" : "Failed"}*\n\n${String(result.insights)}\n${exec.output_file ? "\n_Chart uploaded above._" : ""}\n_Reply in this thread for follow-up analysis._`,
          undefined,
          teamId
        );

        await trackSkillUsage("analytics", slackUserId, slackChannelId, event.data.messageText, outcome);
      });
    } catch (workflowError) {
      // Error boundary — ensure task status is updated and user is notified
      console.error("[ANALYTICS] Workflow error:", workflowError);
      try {
        await updateTask(taskId, { status: "error" });
        await trackSkillUsage("analytics", slackUserId, slackChannelId, event.data.messageText, "error");

        try {
          await removeReaction(slackChannelId, slackThreadTs, "chart_with_upwards_trend", teamId);
        } catch { /* ok */ }
        await addReaction(slackChannelId, slackThreadTs, "warning", teamId);

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Analysis Failed*\n\nAn error occurred: ${(workflowError as Error).message?.slice(0, 500) || "Unknown error"}.\n_Reply in this thread to try again._`,
          undefined,
          teamId
        );
      } catch (notifyError) {
        console.error("[ANALYTICS] Error notification failed:", notifyError);
      }
    }
  }
);
