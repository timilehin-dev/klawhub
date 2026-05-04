import { getDb } from "./connection";
import { memory } from "./schema";
import { eq, and, desc, sql, count, inArray, or, gt } from "drizzle-orm";

/** Maximum memories per user per category to keep things lean. */
const MAX_MEMORIES_PER_CATEGORY = 20;

export function saveMemory(slackUserId: string, content: string, category = "general", workspaceId?: string) {
  return getDb().insert(memory).values({
    slackUserId,
    content,
    category,
    workspaceId,
    searchVector: sql`to_tsvector('english', ${content})`,
  });
}

/**
 * Full-text search using PostgreSQL tsvector.
 * Falls back to ILIKE if tsvector column is not yet populated (migration pending).
 */
export async function readMemory(slackUserId: string, query: string) {
  const safeQuery = query.replace(/[%_\\]/g, "\\$&");

  // Try tsvector search first (higher quality — matches stems, handles misspellings)
  try {
    const tsResults = await getDb()
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.slackUserId, slackUserId),
          sql`${memory.searchVector} @@ plainto_tsquery('english', ${query})`
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
