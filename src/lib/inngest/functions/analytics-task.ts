import { inngest } from "../client";
import { analyzeData } from "@/lib/agents/analyst";
import { postToThread, addReaction, removeReaction, uploadBinaryFile } from "@/lib/slack/client";
import { updateTask } from "@/lib/db";
import type { SandboxResponse } from "@/types";

interface AnalyticsEventData {
  slackChannelId: string;
  slackThreadTs: string;
  slackUserId: string;
  messageText: string;
  taskId: string;
  data?: string;
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
    const { slackChannelId, slackThreadTs, taskId } =
      event.data as AnalyticsEventData;

    // Step 1: Run analysis
    const result = await step.run("run-analysis", async () => {
      await updateTask(taskId, { status: "processing" });
      const r = await analyzeData(event.data.messageText, event.data.data);
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
          "Analysis Chart"
        );
      }

      await updateTask(taskId, {
        status: "done",
        result: {
          stdout: (exec.stdout || "").slice(0, 2000),
          insights: String(result.insights),
        },
      });

      try { await removeReaction(slackChannelId, slackThreadTs, "chart_with_upwards_trend"); } catch { /* ok */ }
      await addReaction(slackChannelId, slackThreadTs, "white_check_mark");

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `📊 *Analysis Complete*\n\n${String(result.insights).slice(0, 2000)}\n${exec.output_file ? "\n_Chart uploaded above._" : ""}\n_Reply in this thread for follow-up analysis._`
      );
    });
  }
);
