import { getDb } from "./connection";
import { memory } from "./schema";
import { eq, ilike, and } from "drizzle-orm";

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
