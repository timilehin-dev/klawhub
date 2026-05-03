import { getDb } from "./connection";
import { tasks } from "./schema";
import { eq, desc } from "drizzle-orm";

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
