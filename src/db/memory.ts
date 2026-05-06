import { getDb } from "./connection";
import { memory } from "./schema";
import { eq, and, desc, sql, count, inArray } from "drizzle-orm";
import { generateEmbedding } from "@/core/embeddings";

/** Maximum memories per user per category to keep things lean. */
const MAX_MEMORIES_PER_CATEGORY = 20;

export async function saveMemory(slackUserId: string, content: string, category = "general", workspaceId?: string) {
  const embedding = await generateEmbedding(content);
  return getDb().insert(memory).values({
    slackUserId,
    content,
    category,
    workspaceId,
    embedding: embedding || null,
    // search_vector is auto-populated by DB trigger — no need to pass it here
  });
}

/**
 * Semantic search using FastEmbed + pgvector, falling back to full-text search.
 */
export async function readMemory(slackUserId: string, query: string, workspaceId?: string) {
  const safeQuery = query.replace(/[%_\\]/g, "\\$&");

  // Try semantic vector search first
  try {
    const embedding = await generateEmbedding(query);
    if (embedding) {
      const results = await getDb()
        .select()
        .from(memory)
        .where(
          and(
            eq(memory.slackUserId, slackUserId),
            workspaceId ? eq(memory.workspaceId, workspaceId) : sql`true`
          )
        )
        .orderBy(sql`embedding <=> ${JSON.stringify(embedding)}::vector`)
        .limit(5);

      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.warn("[EMBEDDING] Semantic memory search failed:", (err as Error).message);
  }

  // Try tsvector search second (higher quality — matches stems, handles misspellings)
  try {
    const tsResults = await getDb()
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.slackUserId, slackUserId),
          sql`search_vector @@ plainto_tsquery('english', ${query})`
        )
      )
      .limit(5);

    // If tsvector column has data, use these results
    if (tsResults.length > 0) {
      return tsResults;
    }
  } catch {
    // search_vector column might not exist yet — fall through to ILIKE
  }

  // Fallback: ILIKE substring search (legacy)
  return getDb()
    .select()
    .from(memory)
    .where(and(eq(memory.slackUserId, slackUserId), sql`${memory.content} ILIKE ${`%${safeQuery}%`}`))
    .limit(5);
}

/** Get recent memories for a user, optionally filtered by category. */
export function getRecentMemories(slackUserId: string, category?: string, limit = 10) {
  const conditions = [eq(memory.slackUserId, slackUserId)];
  if (category) {
    conditions.push(eq(memory.category, category));
  }
  return getDb()
    .select()
    .from(memory)
    .where(and(...conditions))
    .orderBy(desc(memory.createdAt))
    .limit(limit);
}

/** Delete all memories for a specific user (used by /klawhub forget). */
export function deleteUserMemories(slackUserId: string) {
  return getDb().delete(memory).where(eq(memory.slackUserId, slackUserId));
}

/** Delete memories older than N days for a specific user. */
export function pruneOldMemories(slackUserId: string, daysOld = 30) {
  return getDb()
    .delete(memory)
    .where(
      and(
        eq(memory.slackUserId, slackUserId),
        sql`${memory.createdAt} < now() - make_interval(days => ${daysOld})`
      )
    );
}

/** Get memory count per category for a user. */
export function getMemoryStats(slackUserId: string) {
  return getDb()
    .select({
      category: memory.category,
      count: count(),
    })
    .from(memory)
    .where(eq(memory.slackUserId, slackUserId))
    .groupBy(memory.category)
    .orderBy(desc(count()));
}

/** Check if we need to prune and do it. Call after saving. */
export async function autoPruneMemory(slackUserId: string, category: string) {
  try {
    const rows: { cnt: number }[] = await getDb()
      .select({ cnt: count() })
      .from(memory)
      .where(and(eq(memory.slackUserId, slackUserId), eq(memory.category, category)));

    const cnt = rows[0]?.cnt || 0;
    if (cnt > MAX_MEMORIES_PER_CATEGORY) {
      const sub = getDb()
        .select({ id: memory.id })
        .from(memory)
        .where(and(eq(memory.slackUserId, slackUserId), eq(memory.category, category)))
        .orderBy(memory.createdAt)
        .limit(cnt - MAX_MEMORIES_PER_CATEGORY + 5);

      const toDelete = await sub;
      if (toDelete.length > 0) {
        const ids = toDelete.map((r) => r.id);
        await getDb()
          .delete(memory)
          .where(inArray(memory.id, ids));
      }
    }
  } catch {
    // Pruning is non-critical
  }
}
