import { getDb } from "./connection";
import { memory } from "./schema";
import { eq, ilike, and, desc, sql, count } from "drizzle-orm";

/** Maximum memories per user per category to keep things lean. */
const MAX_MEMORIES_PER_CATEGORY = 20;

export function saveMemory(slackUserId: string, content: string, category = "general") {
  return getDb().insert(memory).values({ slackUserId, content, category });
}

export function readMemory(slackUserId: string, query: string) {
  // Escape SQL LIKE wildcards in user query to prevent injection
  const safeQuery = query.replace(/[%_\\]/g, "\\$&");
  return getDb()
    .select()
    .from(memory)
    .where(and(eq(memory.slackUserId, slackUserId), ilike(memory.content, `%${safeQuery}%`)))
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
        sql`${memory.createdAt} < now() - interval '${sql.raw(String(daysOld))} days'`
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
      // Delete oldest memories beyond the limit
      const sub = getDb()
        .select({ id: memory.id })
        .from(memory)
        .where(and(eq(memory.slackUserId, slackUserId), eq(memory.category, category)))
        .orderBy(memory.createdAt)
        .limit(cnt - MAX_MEMORIES_PER_CATEGORY + 5); // remove extra buffer

      const toDelete = await sub;
      if (toDelete.length > 0) {
        const ids = toDelete.map((r) => r.id);
        await getDb()
          .delete(memory)
          .where(sql`${memory.id} IN ${sql.raw(`(${ids.map((id) => `'${id}'`).join(",")})`)}`);
      }
    }
  } catch {
    // Pruning is non-critical
  }
}
