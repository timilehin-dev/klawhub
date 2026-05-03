import { getDb } from "./connection";
import { runs } from "./schema";
import { eq, desc } from "drizzle-orm";

export function createRun(values: typeof runs.$inferInsert) {
  return getDb().insert(runs).values(values).returning();
}

export function updateRun(id: string, updates: Partial<typeof runs.$inferInsert>) {
  return getDb().update(runs).set({ ...updates, updatedAt: new Date() }).where(eq(runs.id, id));
}

export function getRun(id: string) {
  return getDb().select().from(runs).where(eq(runs.id, id)).limit(1);
}

export function getRecentRuns(userId: string, limit = 5) {
  return getDb().select().from(runs).where(eq(runs.slackUserId, userId)).orderBy(desc(runs.createdAt)).limit(limit);
}
