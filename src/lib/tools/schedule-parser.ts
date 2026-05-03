import { llm } from "@/lib/llm";

interface ParsedSchedule {
  name: string;
  cronExpr: string;       // 5-field: min hour dom month dow
  timezone: string;       // IANA tz like "Africa/Lagos"
  action: string;         // what to execute
}

const SCHEDULE_PARSER_PROMPT = `You parse scheduling requests into structured data. Return ONLY valid JSON, no explanation.

Rules:
- cron_expr: standard 5-field cron (minute hour day_of_month month day_of_week)
  - Use "*" for wildcard, ranges like "1-5" for Mon-Fri
  - Example: "every weekday at 9am" → "0 9 * * 1-5"
  - Example: "every day at 8am" → "0 8 * * *"
  - Example: "every monday at 2pm" → "0 14 * * 1"
  - Example: "every 2 hours" → "0 */2 * * *"
- timezone: IANA timezone string (Africa/Lagos, America/New_York, Europe/London, Asia/Tokyo, etc.)
  - If user says "WAT" → "Africa/Lagos"
  - If user says "EST" → "America/New_York"
  - Default to "Africa/Lagos" if not specified
- name: short descriptive name (max 50 chars)
- action: the task/prompt to execute when the schedule fires

Return format:
{"name": "...", "cron_expr": "...", "timezone": "...", "action": "..."}`;

export async function parseScheduleRequest(request: string): Promise<ParsedSchedule> {
  const response = await llm.chat([
    { role: "system", content: SCHEDULE_PARSER_PROMPT },
    { role: "user", content: request },
  ], { temperature: 0.1, maxTokens: 200 });

  // Extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not parse schedule request");

  const parsed = JSON.parse(jsonMatch[0]) as ParsedSchedule;

  // Validate cron expression format (basic check: 5 space-separated fields)
  const parts = parsed.cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${parsed.cronExpr}`);
  }

  return parsed;
}
