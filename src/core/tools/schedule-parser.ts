import { llm } from "@/core/llm";

interface ParsedSchedule {
  name: string;
  cronExpr: string;
  timezone: string;
  action: string;
}

const SCHEDULE_PARSER_PROMPT = `You parse scheduling requests into structured data. Return ONLY a JSON object with EXACTLY these four keys: "name", "cron_expr", "timezone", "action". No markdown, no code fences, no explanation.

Rules:
- "cron_expr": standard 5-field cron (minute hour day_of_month month day_of_week)
  - "every weekday at 9am" → "0 9 * * 1-5"
  - "every day at 8am" → "0 8 * * *"
  - "every monday at 2pm" → "0 14 * * 1"
  - "every 2 hours" → "0 */2 * * *"
- "timezone": IANA timezone string. WAT = Africa/Lagos, EST = America/New_York. Default: Africa/Lagos
- "name": short descriptive name, max 50 chars
- "action": the task/prompt to execute when the schedule fires

Example input: "daily forex summary at 8am WAT weekdays"
Example output: {"name": "Daily Forex Summary", "cron_expr": "0 8 * * 1-5", "timezone": "Africa/Lagos", "action": "Generate a daily forex market summary and post key insights."}

Input:`;

export async function parseScheduleRequest(request: string): Promise<ParsedSchedule> {
  const response = await llm.chat([
    { role: "system", content: SCHEDULE_PARSER_PROMPT },
    { role: "user", content: request },
  ], { temperature: 0.0, maxTokens: 200 });

  // Strip code fences if LLM wraps in them
  let cleaned = response.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();

  // Extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not parse schedule request from LLM response");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Invalid JSON returned by LLM");
  }

  // Normalize keys — handle common variations
  const cronExpr = (parsed.cron_expr || parsed.cronExpr || parsed.cron || "") as string;
  const timezone = (parsed.timezone || parsed.tz || "Africa/Lagos") as string;
  const name = (parsed.name || parsed.title || "Untitled Schedule") as string;
  const action = (parsed.action || parsed.task || parsed.prompt || request) as string;

  if (!cronExpr || typeof cronExpr !== "string") {
    throw new Error("Missing or invalid cron_expr in schedule response");
  }

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  return {
    name: String(name).trim().slice(0, 50),
    cronExpr: cronExpr.trim(),
    timezone: String(timezone).trim(),
    action: String(action).trim().slice(0, 500),
  };
}
