import { CronExpressionParser } from "cron-parser";

/**
 * Validates if a string is a valid 5-field cron expression.
 */
export function isValidCron(cron: string): boolean {
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes common natural language phrases to crons as a first pass.
 */
export function normalizeNaturalCron(text: string): string | null {
  const t = text.toLowerCase().trim();
  
  if (t === "every day" || t === "daily" || t === "every day at 9am") return "0 9 * * *";
  if (t === "every weekday" || t === "weekdays at 9am") return "0 9 * * 1-5";
  if (t === "every monday" || t === "mondays at 9am") return "0 9 * * 1";
  if (t === "every hour") return "0 * * * *";
  
  return null;
}
