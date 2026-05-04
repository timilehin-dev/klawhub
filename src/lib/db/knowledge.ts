import { getDb } from "./connection";
import { knowledge } from "./schema";
import { eq, and, desc, ilike, or } from "drizzle-orm";

type EntityType = "project" | "person" | "event" | "standing_item" | "technology" | "preference" | "relationship";

export function upsertKnowledge(
  slackUserId: string,
  entityType: EntityType,
  entityName: string,
  data: Record<string, unknown>,
  source?: string
) {
  return getDb()
    .insert(knowledge)
    .values({ slackUserId, entityType, entityName, data, source })
    .onConflictDoUpdate({
      target: [knowledge.slackUserId, knowledge.entityType, knowledge.entityName],
      set: { data, source, updatedAt: new Date() },
    });
}

export function getKnowledge(
  slackUserId: string,
  entityType?: EntityType,
  entityName?: string
) {
  const conditions = [eq(knowledge.slackUserId, slackUserId)];
  if (entityType) conditions.push(eq(knowledge.entityType, entityType));
  if (entityName) conditions.push(eq(knowledge.entityName, entityName));
  return getDb()
    .select()
    .from(knowledge)
    .where(and(...conditions))
    .orderBy(desc(knowledge.updatedAt));
}

export function searchKnowledge(slackUserId: string, query: string) {
  const pattern = `%${query}%`;
  return getDb()
    .select()
    .from(knowledge)
    .where(
      and(
        eq(knowledge.slackUserId, slackUserId),
        or(
          ilike(knowledge.entityName, pattern),
          ilike(knowledge.entityType, pattern)
        )
      )
    )
    .limit(20);
}

export function deleteKnowledge(id: string) {
  return getDb().delete(knowledge).where(eq(knowledge.id, id));
}

export function getAllKnowledge(slackUserId: string) {
  return getDb()
    .select()
    .from(knowledge)
    .where(eq(knowledge.slackUserId, slackUserId))
    .orderBy(desc(knowledge.updatedAt));
}

/** Build a concise context string from all user knowledge for agents. */
export async function buildKnowledgeContext(slackUserId: string): Promise<string> {
  try {
    const items = await getAllKnowledge(slackUserId);
    if (items.length === 0) return "";

    const lines = items.map((k) => {
      const dataStr = Object.entries(k.data as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([key, val]) => `${key}: ${val}`)
        .join(", ");
      return `[${k.entityType}] ${k.entityName}: ${dataStr}`;
    });

    return lines.join("\n").slice(0, 3000);
  } catch {
    return "";
  }
}
