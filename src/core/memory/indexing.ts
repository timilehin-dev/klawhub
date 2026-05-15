import { getDb } from "@/db/connection";
import { documentChunks } from "@/db/schema";
import { generateEmbedding } from "@/core/embeddings";
import { getThreadReplies } from "@/integrations/slack/client";
import { agentChat } from "@/core/llm";
import { upsertKnowledge } from "@/db/knowledge";
import { eq, and } from "drizzle-orm";

export interface IndexingResult {
  success: boolean;
  indexedCount: number;
  summary?: string;
  error?: string;
}

/** Simple character-based chunking with overlap. */
export function chunkText(text: string, size: number = 1000, overlap: number = 200): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, Math.min(start + size, text.length)));
    start += size - overlap;
  }
  return chunks;
}

/** Remove existing chunks for a resource to avoid duplicates. */
async function deleteOldChunks(workspaceId: string, sourceId: string) {
    await getDb()
        .delete(documentChunks)
        .where(
            and(
                eq(documentChunks.workspaceId, workspaceId),
                eq(documentChunks.sourceId, sourceId)
            )
        );
}


/** Index a Slack thread: summarize and store. */
export async function indexSlackThread(
  workspaceId: string,
  channelId: string,
  threadTs: string,
  slackUserId: string,
  teamId?: string
): Promise<IndexingResult> {
  try {
    const replies = await getThreadReplies(channelId, threadTs, teamId);
    if (replies.length === 0) return { success: false, indexedCount: 0, error: "Thread not found" };

    // Deduplicate: remove old chunks for this thread
    await deleteOldChunks(workspaceId, threadTs);

    const fullText = replies.map(r => `<@${r.user || 'Unknown'}>: ${r.text}`).join("\n");

    
    // 1. Generate a summary for the structured 'knowledge' table
    const summaryPrompt = `Extract key organizational knowledge from the following Slack thread.
Identify all projects, standing preferences, decisions, or important people mentioned.
Format as a JSON list of objects: [{ "entityName": "...", "entityType": "project|person|event|standing_item|technology|preference|relationship", "summary": "...", "outcomes": ["..."] }]
Thread:
${fullText.slice(0, 10000)}`;

    const summaryStr = await agentChat("analyst", [{ role: "user", content: summaryPrompt }]);
    let entities = [];
    try {
        const cleaned = summaryStr.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        entities = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        entities = [{
            entityName: `Thread ${threadTs}`,
            entityType: "event",
            summary: summaryStr.slice(0, 500)
        }];
    }

    // 2. Store all extracted entities in 'knowledge'
    for (const entity of entities) {
        await upsertKnowledge(
            slackUserId,
            entity.entityType || "event",
            entity.entityName || `Thread ${threadTs}`,
            entity,
            `slack://${channelId}/${threadTs}`,
            workspaceId
        );
    }

    // 3. Chunk and store in 'document_chunks' for granular RAG
    const chunks = chunkText(fullText, 1200, 200);
    let count = 0;
    for (const chunk of chunks) {
      const chunkEmbedding = await generateEmbedding(chunk);
      if (chunkEmbedding) {
        await getDb().insert(documentChunks).values({
            workspaceId,
            sourceId: threadTs,
            sourceType: "slack",
            content: chunk,
            embedding: chunkEmbedding,
            metadata: { channelId, ts: threadTs },
          });
          count++;
      }
    }

    return { success: true, indexedCount: count, summary: entities[0]?.summary || "Indexed" };
  } catch (err) {
    console.error("[INDEXING] Slack thread indexing failed:", err);
    return { success: false, indexedCount: 0, error: (err as Error).message };
  }
}

/** Index a document (PDF, Docx, etc.) */
export async function indexDocument(
  workspaceId: string,
  sourceId: string,
  sourceType: "gdrive" | "github" | "upload",
  content: string,
  filename: string,
  metadata: Record<string, any> = {}
): Promise<IndexingResult> {
  try {
    // Deduplicate
    await deleteOldChunks(workspaceId, sourceId);

    const chunks = chunkText(content, 1200, 200);

    let count = 0;
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk);
      if (embedding) {
        await getDb().insert(documentChunks).values({
            workspaceId,
            sourceId,
            sourceType,
            content: chunk,
            embedding,
            metadata: { ...metadata, filename },
          });
          count++;
      }
    }

    return { success: true, indexedCount: count };
  } catch (err) {
    console.error("[INDEXING] Document indexing failed:", err);
    return { success: false, indexedCount: 0, error: (err as Error).message };
  }
}
