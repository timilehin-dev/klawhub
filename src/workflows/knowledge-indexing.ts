import { inngest } from "./client";
import { indexSlackThread, indexDocument } from "@/core/memory/indexing";
import { googleDriveRead, googleDriveExportDoc } from "@/integrations/clients";
import { sandbox } from "@/core/tools/sandbox";

export const knowledgeIndexingWorkflow = inngest.createFunction(
  { id: "knowledge-indexing", name: "Knowledge Indexing" },
  { event: "knowledge/index.requested" },
  async ({ event, step }) => {
    const { type, workspaceId, resourceId, slackUserId, teamId, metadata } = event.data;

    if (type === "slack_thread") {
      const result = await step.run("index-slack-thread", async () => {
        return indexSlackThread(workspaceId, metadata.channelId, resourceId, slackUserId, teamId);
      });
      return result;
    }

    if (type === "gdrive_file") {
      const result = await step.run("index-gdrive-file", async () => {
        // 1. Read file
        const driveResult = await googleDriveRead(workspaceId, resourceId);
        let content = driveResult.content;

        // 2. Parse if binary or special Google Doc
        if (driveResult.contentType?.includes("application/vnd.google-apps.document")) {
            const exportResult = await googleDriveExportDoc(workspaceId, resourceId);
            content = exportResult.content;
        } else if (driveResult.isBase64) {
            // Safety: Check size (max 10MB)
            const sizeInMb = (content.length * 0.75) / (1024 * 1024);
            if (sizeInMb > 10) {
                return { success: false, error: "File too large for indexing (max 10MB)" };
            }

            const parseResult = await sandbox({
                type: "parse_document",
                file: content, // Already b64 from googleDriveRead
                filename: metadata.filename || "file"
            });
            content = parseResult.text || "";
        }

        return indexDocument(workspaceId, resourceId, "gdrive", content, metadata.filename || "gdrive-file", metadata);
      });
      return result;
    }

    return { success: false, error: `Unsupported index type: ${type}` };
  }
);
