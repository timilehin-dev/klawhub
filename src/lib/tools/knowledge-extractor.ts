import { agentChat } from "@/lib/llm";
import { upsertKnowledge } from "@/lib/db/knowledge";

const EXTRACT_PROMPT = `Extract structured knowledge entities from the user message. Return ONLY a JSON array, or an empty array [] if nothing relevant found.

Entity types: "project", "person", "event", "standing_item"

Rules:
- Extract ANY factual, reusable information — be generous, not strict
- "project": any named task, assignment, deliverable, or work item (has a name and some context)
- "person": any person mentioned by name with any detail (role, team, preference, relationship)
- "event": any date, deadline, meeting, birthday, or time-specific occurrence
- "standing_item": any recurring meeting, check-in, review, or repeated activity
- If someone mentions they're working on something, that's a project
- If someone mentions a person's name with ANY detail, extract it
- If someone mentions a date or schedule, extract it

Example input: "The fuel subsidy paper is on Chapter 3, I need to integrate the 31 survey responses"
Example output: [{"entity_type":"project","entity_name":"Fuel Subsidy Paper","data":{"status":"Chapter 3","details":"31 survey responses to integrate"}}]

Example input: "Opeoluwa's birthday is on Monday Apr 20"
Example output: [{"entity_type":"event","entity_name":"Opeoluwa's Birthday","data":{"date":"Apr 20","recurrence":"annual"}}]

Example input: "I use VS Code for my Python projects"
Example output: [{"entity_type":"standing_item","entity_name":"Development Environment","data":{"editor":"VS Code","language":"Python"}}]

Example input: "Timi is the lead on the Klawhub project"
Example output: [{"entity_type":"person","entity_name":"Timi","data":{"role":"lead"}},{"entity_type":"project","entity_name":"Klawhub","data":{"status":"active"}}]

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
    // Skip very short messages that are unlikely to contain knowledge
    if (message.length < 10) return 0;

    // Skip pure greetings
    if (/^(hi|hello|hey|sup|yo|morning|evening|afternoon)\b/i.test(message.trim()) && message.length < 50) {
      return 0;
    }

    const response = await agentChat("knowledge-extractor", [
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: message },
    ], { temperature: 0.1, maxTokens: 500 });

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;

    const entities: ExtractedEntity[] = JSON.parse(jsonMatch[0]);
    if (!entities.length) return 0;

    let stored = 0;
    for (const entity of entities.slice(0, 5)) {
      if (!entity.entity_type || !entity.entity_name) continue;

      // Sanitize entity_name
      const entityName = entity.entity_name
        .replace(/^["']|["']$/g, "")
        .trim()
        .slice(0, 200);

      if (!entityName) continue;

      try {
        await upsertKnowledge(
          slackUserId,
          entity.entity_type,
          entityName,
          entity.data || {},
          source
        );
        stored++;
      } catch (err) {
        // Log but don't throw — individual entity failures shouldn't break the flow
        console.error(`[KNOWLEDGE] Failed to store entity "${entityName}":`, err);
      }
    }

    if (stored > 0) {
      console.log(`[KNOWLEDGE] Stored ${stored} entities for user ${slackUserId}`);
    }

    return stored;
  } catch (err) {
    console.error("[KNOWLEDGE] Extraction failed:", err);
    return 0; // non-critical
  }
}
