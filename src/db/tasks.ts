import { getDb } from "./connection";
import { tasks } from "./schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";

export function createTask(values: typeof tasks.$inferInsert) {
  return getDb().insert(tasks).values(values).returning();
}

export function updateTask(id: string, updates: Partial<typeof tasks.$inferInsert>) {
  return getDb().update(tasks).set({ ...updates, updatedAt: new Date() }).where(eq(tasks.id, id));
}

export function getRecentTasks(userId: string, limit = 5) {
  return getDb().select().from(tasks).where(eq(tasks.slackUserId, userId)).orderBy(desc(tasks.createdAt)).limit(limit);
}

export function getTaskByThreadTs(threadTs: string) {
  return getDb().select().from(tasks).where(eq(tasks.slackThreadTs, threadTs)).orderBy(desc(tasks.createdAt)).limit(1);
}

/**
 * Check if there's an active (in-progress) task in a thread.
 * Used to prevent duplicate tasks when one is already running.
 */
export function getActiveTaskByThreadTs(threadTs: string) {
  return getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.slackThreadTs, threadTs),
        inArray(tasks.status, ["pending_approval", "processing"])
      )
    )
    .orderBy(desc(tasks.createdAt))
    .limit(1);
}

/** Find tasks stuck in active states longer than `staleMinutes`. */
export function getStaleTasks(staleMinutes = 15) {
  return getDb()
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ["pending", "pending_approval", "processing"]),
        sql`${tasks.updatedAt} < NOW() - INTERVAL '${sql.raw(String(staleMinutes))} minutes'`
      )
    )
    .orderBy(desc(tasks.updatedAt));
}
