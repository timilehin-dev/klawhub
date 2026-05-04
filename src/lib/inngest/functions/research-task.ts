import { inngest } from "../client";
import { conductResearch } from "@/lib/agents/researcher";
import { memoryWrite } from "@/lib/tools/memory";
import { postToThread, addReaction, removeReaction } from "@/lib/slack/client";
import { updateTask, trackSkillUsage } from "@/lib/db";

interface ResearchEventData {
  slackChannelId: string;
  slackThreadTs: string;
  slackUserId: string;
  messageText: string;
  taskId: string;
  teamId?: string;
}

export const researchWorkflow = inngest.createFunction(
  { id: "research-task", name: "Research Task", retries: 2 },
  { event: "slack/research.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, slackUserId, messageText, taskId, teamId } =
      event.data as ResearchEventData;

    try {
      // Step 1: Conduct research
      const result = await step.run("conduct-research", async () => {
        await updateTask(taskId, { status: "processing" });
        return conductResearch(messageText, { taskId, slackUserId });
      });

      // Step 2: Post findings
      await step.run("deliver-findings", async () => {
        const sources = result.sources;
        const sourceList = sources
          .map((s, i) => `${i + 1}. <${s.url}|${s.title}>`)
          .join("\n");

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Research Complete*\n\n${String(result.findings)}\n\n*Sources:*\n${sourceList}`,
          undefined,
          teamId
        );

        // Save to memory for future context
        await memoryWrite(
          slackUserId,
          `Researched: ${messageText.slice(0, 100)}`,
          "research"
        );

        await updateTask(taskId, {
          status: "done",
          result: {
            findings: String(result.findings),
            sources,
          },
        });

        try {
          await removeReaction(slackChannelId, slackThreadTs, "mag", teamId);
        } catch { /* ok */ }
        await addReaction(slackChannelId, slackThreadTs, "white_check_mark", teamId);

        await trackSkillUsage("research", slackUserId, slackChannelId, messageText, "success");
      });
    } catch (workflowError) {
      // Error boundary — ensure task status is updated and user is notified
      console.error("[RESEARCH] Workflow error:", workflowError);
      try {
        await updateTask(taskId, { status: "error" });
        await trackSkillUsage("research", slackUserId, slackChannelId, messageText, "error");

        try {
          await removeReaction(slackChannelId, slackThreadTs, "mag", teamId);
        } catch { /* ok */ }
        await addReaction(slackChannelId, slackThreadTs, "warning", teamId);

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Research Failed*\n\nAn error occurred during research: ${(workflowError as Error).message?.slice(0, 500) || "Unknown error"}.\n_Reply in this thread to try again._`,
          undefined,
          teamId
        );
      } catch (notifyError) {
        console.error("[RESEARCH] Error notification failed:", notifyError);
      }
    }
  }
);
