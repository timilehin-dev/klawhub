import { getDb } from "./connection";
import { schedules } from "./schema";
import { eq, and, desc, sql, count } from "drizzle-orm";

const MAX_SCHEDULES_PER_USER = 10;

export function createSchedule(values: typeof schedules.$inferInsert) {
  return getDb().insert(schedules).values(values).returning();
}

export function getSchedule(id: string) {
  return getDb().select().from(schedules).where(eq(schedules.id, id)).limit(1);
}

export function getUserSchedules(slackUserId: string, activeOnly = true) {
  const conditions = [eq(schedules.slackUserId, slackUserId)];
  if (activeOnly) conditions.push(eq(schedules.isActive, true));
  return getDb()
    .select()
    .from(schedules)
    .where(and(...conditions))
    .orderBy(desc(schedules.createdAt));
}

export function getUserScheduleCount(slackUserId: string): Promise<number> {
  return getDb()
    .select({ cnt: count() })
    .from(schedules)
    .where(and(eq(schedules.slackUserId, slackUserId), eq(schedules.isActive, true)))
    .then((rows) => rows[0]?.cnt || 0);
}

export async function updateSchedule(id: string, updates: Partial<typeof schedules.$inferInsert>) {
  return getDb()
    .update(schedules)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schedules.id, id));
}

/** Get all active schedules that are due (system + all users). */
export function getDueSchedules(now: Date) {
  return getDb()
    .select()
    .from(schedules)
    .where(eq(schedules.isActive, true))
    .then((all) =>
      all.filter((s) => {
        // This logic is flawed for cron-based schedules. The cron expression itself should determine if it's due.
        // The `cronMatchesNow` function should be used to determine if a schedule is due.
        // This filter should likely be removed or re-evaluated based on the intended behavior.
        return true; // All schedules are passed to cronMatchesNow for proper evaluation
      })
    );
}

export function markTriggered(id: string, triggeredAt: Date) {
  return getDb()
    .update(schedules)
    .set({ lastTriggeredAt: triggeredAt, updatedAt: new Date() })
    .where(eq(schedules.id, id));
}

export function incrementFailCount(id: string) {
  return getDb()
    .update(schedules)
    .set({
      failCount: sql`${schedules.failCount} + 1`,
      updatedAt: new Date(),
      isActive: sql`${schedules.failCount} < 3`, // Deactivate after 2 failures (when count becomes 2) // auto-pause after 3 failures (failCount 0,1,2 -> stays active; 3+ -> paused)
    })
    .where(eq(schedules.id, id));
}

export function deleteSchedule(id: string) {
  return getDb().delete(schedules).where(eq(schedules.id, id));
}
