import { getDb } from "./connection";
import { knowledge } from "./schema";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";

type EntityType = "project" | "person" | "event" | "standing_item" | "technology" | "preference" | "relationship";

export function upsertKnowledge(
  slackUserId: string,
  entityType: EntityType,
  entityName: string,
  data: Record<string, unknown>,
  source?: string,
  workspaceId?: string
) {
  const searchText = `${entityName} ${entityType} ${Object.values(data).filter(v => typeof v === "string").join(" ")}`;
  return getDb()
    .insert(knowledge)
    .values({ slackUserId, entityType, entityName, data, source, workspaceId, searchVector: sql`to_tsvector('english', ${searchText})` })
    .onConflictDoUpdate({
      target: [knowledge.slackUserId, knowledge.entityType, knowledge.entityName],
      set: { data, source, updatedAt: new Date(), searchVector: sql`to_tsvector('english', ${searchText})` },
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

/**
 * Full-text search using PostgreSQL tsvector.
 * Falls back to ILIKE if tsvector column is not yet populated.
 */
export async function searchKnowledge(slackUserId: string, query: string) {
  // Try tsvector search first
  try {
    const tsResults = await getDb()
      .select()
      .from(knowledge)
      .where(
        and(
          eq(knowledge.slackUserId, slackUserId),
          sql`${knowledge.searchVector} @@ plainto_tsquery('english', ${query})`
        )
      )
      .limit(20);

    if (tsResults.length > 0) {
      return tsResults;
    }
  } catch {
    // search_vector column might not exist yet — fall through to ILIKE
  }

  // Fallback: ILIKE substring search
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
