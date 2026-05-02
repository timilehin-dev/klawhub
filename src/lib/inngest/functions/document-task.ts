import { inngest } from "../client";
import { generateDocument } from "@/lib/agents/documentor";
import { postToThread, addReaction, removeReaction, uploadBinaryFile } from "@/lib/slack/client";
import { updateTask } from "@/lib/db";

interface DocumentEventData {
  slackChannelId: string;
  slackThreadTs: string;
  slackUserId: string;
  messageText: string;
  taskId: string;
}

export const documentWorkflow = inngest.createFunction(
  { id: "document-task", name: "Document Task", retries: 2 },
  { event: "slack/document.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, taskId } =
      event.data as DocumentEventData;

    // Step 1: Generate document
    const result = await step.run("generate-document", async () => {
      await updateTask(taskId, { status: "processing" });
      return generateDocument(event.data.messageText);
    });

    // Step 2: Deliver
    await step.run("deliver-document", async () => {
      if (!result.success || !result.fileData) {
        await updateTask(taskId, { status: "error" });

        try {
          await removeReaction(slackChannelId, slackThreadTs, "page_facing_up");
        } catch { /* ok */ }
        await addReaction(slackChannelId, slackThreadTs, "warning");

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `❌ *Document Generation Failed*\n\n${result.error || "Unknown error occurred."}\n_Reply to try again._`
        );
        return;
      }

      // Decode base64 file and upload
      const buffer = Buffer.from(result.fileData, "base64");
      const filename = result.filename || `${result.title.replace(/[^a-z0-9]/gi, "_")}.${result.format}`;

      await uploadBinaryFile(
        slackChannelId,
        slackThreadTs,
        buffer,
        filename,
        result.title
      );

      await updateTask(taskId, {
        status: "done",
        outputFilename: filename,
        result: { title: result.title, format: result.format, sectionCount: result.sections.length },
      });

      try {
        await removeReaction(slackChannelId, slackThreadTs, "page_facing_up");
      } catch { /* ok */ }
      await addReaction(slackChannelId, slackThreadTs, "white_check_mark");

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `📄 *Document Delivered*\n\n**${result.title}** (${result.format.toUpperCase()})\n${result.sections.length} sections — see the file above.\n_Reply in this thread for revisions._`
      );
    });
  }
);
