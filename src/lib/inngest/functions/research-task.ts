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
}

export const researchWorkflow = inngest.createFunction(
  { id: "research-task", name: "Research Task", retries: 2 },
  { event: "slack/research.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, slackUserId, messageText, taskId } =
      event.data as ResearchEventData;

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
        `*Research Complete*\n\n${String(result.findings).slice(0, 3000)}\n\n*Sources:*\n${sourceList}`
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
          findings: String(result.findings).slice(0, 1000),
          sources,
        },
      });

      try {
        await removeReaction(slackChannelId, slackThreadTs, "mag");
      } catch { /* ok */ }
      await addReaction(slackChannelId, slackThreadTs, "white_check_mark");

      await trackSkillUsage("research", slackUserId, slackChannelId, messageText, "success");
    });
  }
);
