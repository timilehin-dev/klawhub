import { inngest } from "../client";
import { generateDocument, generateOutline } from "@/lib/agents/documentor";
import {
  postToThread,
  updateMessage,
  addReaction,
  removeReaction,
  uploadBinaryFile,
} from "@/lib/slack/client";
import {
  approvalBlocks,
  replaceActionsWithDecision,
} from "@/lib/slack/blocks";
import { updateTask, trackSkillUsage } from "@/lib/db";
import { buildUserContext } from "@/lib/tools/memory";

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
    const { slackChannelId, slackThreadTs, slackUserId, messageText, taskId } =
      event.data as DocumentEventData;

    // Step 1: Build user context + generate outline
    const outline = await step.run("generate-outline", async () => {
      const userContext = await buildUserContext(slackUserId);
      await updateTask(taskId, { status: "pending_approval" });
      return generateOutline(messageText, userContext, { taskId, slackUserId });
    });

    // Step 2: Post outline for approval + wait
    const approval = await step.run("post-outline-for-approval", async () => {
      const sectionsPreview = outline.sections
        .map((s: { heading: string; body: string }) => `*${s.heading}*\n${s.body}`)
        .join("\n\n");

      const blocks = approvalBlocks(
        `Document Outline: ${outline.title}`,
        `*Format:* ${outline.format.toUpperCase()}\n*Sections:*\n\n${sectionsPreview}`,
        taskId,
        "doc_outline"
      );

      const msg = await postToThread(
        slackChannelId,
        slackThreadTs,
        `*Document Agent* — Outline ready for review`,
        { blocks }
      );

      return { messageTs: (msg as any).ts, blocks };
    });

    // Step 3: Wait for approve/reject (24h timeout)
    const decision = await step.waitForEvent("wait-for-doc-approval", {
      event: "app/approval.decided",
      timeout: "24h",
      match: "data.referenceId",
    });

    if (!decision || decision.data.decision === "rejected") {
      await step.run("handle-rejection", async () => {
        const rejectorId = decision?.data.userId || "unknown";
        const updatedBlocks = replaceActionsWithDecision(
          approval.blocks,
          "rejected",
          rejectorId
        );

        if (approval.messageTs) {
          await updateMessage(
            slackChannelId,
            approval.messageTs,
            `*Document Agent* — Outline was *rejected*`,
            { blocks: updatedBlocks }
          );
        }

        await updateTask(taskId, { status: "error" });
        await trackSkillUsage("document", slackUserId, slackChannelId, messageText, "error");

        try {
          await removeReaction(slackChannelId, slackThreadTs, "page_facing_up");
        } catch { /* ok */ }
        await addReaction(slackChannelId, slackThreadTs, "warning");

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Document Generation Cancelled*\n\nThe outline was rejected. Send a new request to try again.`
        );
      });
      return;
    }

    // Step 4: Generate full document (with user context)
    const result = await step.run("generate-document", async () => {
      const approverId = decision.data.userId || "unknown";
      const updatedBlocks = replaceActionsWithDecision(
        approval.blocks,
        "approved",
        approverId
      );

      if (approval.messageTs) {
        await updateMessage(
          slackChannelId,
          approval.messageTs,
          `*Document Agent* — Outline *approved*, generating full document...`,
          { blocks: updatedBlocks }
        );
      }

      const userContext = await buildUserContext(slackUserId);
      await updateTask(taskId, { status: "processing" });
      return generateDocument(messageText, userContext, { taskId, slackUserId });
    });

    // Step 5: Deliver
    await step.run("deliver-document", async () => {
      if (!result.success || !result.fileData) {
        await updateTask(taskId, { status: "error" });
        await trackSkillUsage("document", slackUserId, slackChannelId, messageText, "error");

        try {
          await removeReaction(slackChannelId, slackThreadTs, "page_facing_up");
        } catch { /* ok */ }
        await addReaction(slackChannelId, slackThreadTs, "warning");

        await postToThread(
          slackChannelId,
          slackThreadTs,
          `*Document Generation Failed*\n\n${result.error || "Unknown error occurred."}\n_Reply to try again._`
        );
        return;
      }

      const buffer = Buffer.from(result.fileData, "base64");
      const filename =
        result.filename ||
        `${result.title.replace(/[^a-z0-9]/gi, "_")}.${result.format}`;

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
        result: {
          title: result.title,
          format: result.format,
          sectionCount: result.sections.length,
        },
      });

      try {
        await removeReaction(slackChannelId, slackThreadTs, "page_facing_up");
      } catch { /* ok */ }
      await addReaction(slackChannelId, slackThreadTs, "white_check_mark");

      await postToThread(
        slackChannelId,
        slackThreadTs,
        `*Document Delivered*\n\n*${result.title}* (${result.format.toUpperCase()})\n${result.sections.length} sections — see the file above.\n_Reply in this thread for revisions._`
      );

      await trackSkillUsage("document", slackUserId, slackChannelId, messageText, "success");
    });
  }
);
