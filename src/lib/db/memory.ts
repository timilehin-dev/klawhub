import { getDb } from "./connection";
import { memory } from "./schema";
import { eq, ilike, and } from "drizzle-orm";

export function saveMemory(slackUserId: string, content: string, category = "general") {
  return getDb().insert(memory).values({ slackUserId, content, category });
}

export function readMemory(slackUserId: string, query: string) {
  return getDb()
    .select()
    .from(memory)
    .where(and(eq(memory.slackUserId, slackUserId), ilike(memory.content, `%${query}%`)))
    .limit(5);
}
