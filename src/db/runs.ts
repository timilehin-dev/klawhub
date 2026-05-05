import { getDb } from "./connection";
import { runs } from "./schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";

export function createRun(values: typeof runs.$inferInsert) {
  return getDb().insert(runs).values(values).returning();
}

export function updateRun(id: string, updates: Partial<typeof runs.$inferInsert>) {
  return getDb().update(runs).set({ ...updates, updatedAt: new Date() }).where(eq(runs.id, id));
}

export function getRun(id: string) {
  return getDb().select().from(runs).where(eq(runs.id, id)).limit(1);
}

export function getRunByThreadTs(threadTs: string) {
  return getDb().select().from(runs).where(eq(runs.slackThreadTs, threadTs)).orderBy(desc(runs.createdAt)).limit(1);
}

/**
 * Check if there's an active (in-progress) run in a thread.
 * Used to prevent duplicate builds when one is already running.
 */
export function getActiveRunByThreadTs(threadTs: string) {
  return getDb()
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.slackThreadTs, threadTs),
        inArray(runs.status, ["pending", "pm", "coding", "qa", "pending_approval"])
      )
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);
}

export function getRecentRuns(userId: string, limit = 5) {
  return getDb().select().from(runs).where(eq(runs.slackUserId, userId)).orderBy(desc(runs.createdAt)).limit(limit);
}

/** Find runs stuck in active states longer than `staleMinutes`. */
export function getStaleRuns(staleMinutes = 15) {
  return getDb()
    .select()
    .from(runs)
    .where(
      and(
        inArray(runs.status, ["pending", "pm", "coding", "qa", "pending_approval"]),
        sql`${runs.updatedAt} < NOW() - INTERVAL '${sql.raw(String(staleMinutes))} minutes'`
      )
    )
    .orderBy(desc(runs.updatedAt));
}
