import { getDb } from "./connection";
import { knowledge } from "./schema";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";

import { generateEmbedding } from "@/core/embeddings";

type EntityType = "project" | "person" | "event" | "standing_item" | "technology" | "preference" | "relationship";

export async function upsertKnowledge(
  slackUserId: string,
  entityType: EntityType,
  entityName: string,
  data: Record<string, unknown>,
  source?: string,
  workspaceId?: string
) {
  const content = `${entityName} (${entityType}): ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(", ")}`;
  const embedding = await generateEmbedding(content);

  const existing = await getDb()
    .select()
    .from(knowledge)
    .where(
      and(
        eq(knowledge.slackUserId, slackUserId),
        eq(knowledge.entityType, entityType),
        eq(knowledge.entityName, entityName)
      )
    )
    .limit(1);

  if (existing && existing.length > 0) {
    return getDb()
      .update(knowledge)
      .set({
        data,
        source,
        embedding: embedding || null,
        updatedAt: new Date(),
      })
      .where(eq(knowledge.id, existing[0].id));
  } else {
    return getDb()
      .insert(knowledge)
      .values({
        slackUserId,
        entityType,
        entityName,
        data,
        source,
        workspaceId,
        embedding: embedding || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }
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
 * Semantic search using FastEmbed + pgvector, falling back to full-text search.
 */
export async function searchKnowledge(slackUserId: string, query: string, workspaceId?: string) {
  // Try semantic vector search first
  try {
    const embedding = await generateEmbedding(query);
    if (embedding) {
      const results = await getDb()
        .select()
        .from(knowledge)
        .where(
          and(
            eq(knowledge.slackUserId, slackUserId),
            workspaceId ? eq(knowledge.workspaceId, workspaceId) : undefined
          )
        )
        .orderBy(sql`embedding <=> ${JSON.stringify(embedding)}::vector`)
        .limit(20);

      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.warn("[EMBEDDING] Semantic knowledge search failed:", (err as Error).message);
  }

  // Try tsvector search second
  try {
    const tsResults = await getDb()
      .select()
      .from(knowledge)
      .where(
        and(
          eq(knowledge.slackUserId, slackUserId),
          sql`search_vector @@ plainto_tsquery('english', ${query})`
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
    .orderBy(desc(knowledge.updatedAt))
    .limit(50);
}

/** Build a concise context string from relevant user knowledge for agents. */
export async function buildKnowledgeContext(slackUserId: string, query?: string, workspaceId?: string): Promise<string> {
  try {
    const items = query
      ? await searchKnowledge(slackUserId, query, workspaceId)
      : await getAllKnowledge(slackUserId);

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
