import { llm } from "@/lib/llm";
import { upsertKnowledge } from "@/lib/db/knowledge";

const EXTRACT_PROMPT = `Extract structured knowledge entities from the user message. Return ONLY a JSON array, or an empty array [] if nothing relevant found.

Entity types: "project", "person", "event", "standing_item"

Rules:
- Only extract if the message contains factual, reusable information
- Ignore one-off questions or casual chat
- "project": has a name, status/progress, and possibly an owner or deadline
- "person": has a role, team, or preference
- "event": has a date/time, description, possibly recurrence
- "standing_item": recurring check-in, review, or meeting

Example input: "The fuel subsidy paper is on Chapter 3, I need to integrate the 31 survey responses"
Example output: [{"entity_type":"project","entity_name":"Fuel Subsidy Paper","data":{"status":"Chapter 3","details":"31 survey responses to integrate"}}]

Example input: "Opeoluwa's birthday is on Monday Apr 20"
Example output: [{"entity_type":"event","entity_name":"Opeoluwa's Birthday","data":{"date":"Apr 20","recurrence":"annual"}}]

Return format: [{"entity_type":"...", "entity_name":"...", "data": {...}}]`;

interface ExtractedEntity {
  entity_type: "project" | "person" | "event" | "standing_item";
  entity_name: string;
  data: Record<string, unknown>;
}

export async function extractAndStoreKnowledge(
  slackUserId: string,
  message: string,
  source = "conversation"
): Promise<number> {
  try {
    const response = await llm.chat([
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: message },
    ], { temperature: 0.1, maxTokens: 300 });

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;

    const entities: ExtractedEntity[] = JSON.parse(jsonMatch[0]);
    if (entities.length === 0) return 0;

    let stored = 0;
    for (const entity of entities.slice(0, 5)) {
      if (!entity.entity_type || !entity.entity_name) continue;
      await upsertKnowledge(
        slackUserId,
        entity.entity_type,
        entity.entity_name.slice(0, 200),
        entity.data,
        source
      );
      stored++;
    }
    return stored;
  } catch {
    return 0; // non-critical
  }
}
