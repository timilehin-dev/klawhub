import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch (error) {
  // Silent fallback
}

const SESSION_EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours — a full workday
const MAX_TURNS = 20;           // Remember 20 turns (up from 5)
const MAX_CHARS_PER_TURN = 500; // 500 chars each (up from 200)

export async function updateSessionSummary(
  slackUserId: string,
  userMessage: string,
  agentResponse: string
): Promise<void> {
  if (!redis) return;

  const key = `session_summary:${slackUserId}`;
  try {
    const existing = await redis.get(key);

    let logs: any[] = [];
    if (existing) {
      logs = Array.isArray(existing) ? existing : (typeof existing === "string" ? JSON.parse(existing) : [existing]);
    }

    // Truncate to meaningful length, not just 200 chars
    logs.push({
      user: userMessage.slice(0, MAX_CHARS_PER_TURN),
      agent: agentResponse.slice(0, MAX_CHARS_PER_TURN),
      ts: new Date().toISOString(),
    });

    // Keep the most recent MAX_TURNS turns
    if (logs.length > MAX_TURNS) logs = logs.slice(-MAX_TURNS);

    await redis.set(key, logs, { ex: SESSION_EXPIRY_SECONDS });
  } catch (error) {
    console.error("[REDIS] Failed to update session summary:", error);
  }
}

export async function getSessionSummary(slackUserId: string): Promise<string> {
  if (!redis) return "";

  try {
    const data = await redis.get(`session_summary:${slackUserId}`);
    if (!data) return "";

    let logs: any[] = [];
    if (data) {
      logs = Array.isArray(data) ? data : (typeof data === "string" ? JSON.parse(data) : [data]);
    }

    if (logs.length === 0) return "";

    // Group: recent 5 turns verbatim, older turns as a compressed summary header
    const recent = logs.slice(-5);
    const older = logs.slice(0, -5);

    let summary = "";
    if (older.length > 0) {
      // Compress older turns into a concise summary line
      const topics = older.map((l: any) => l.user?.slice(0, 60)).filter(Boolean).join(" | ");
      summary += `*Earlier in this session (${older.length} more turns):* ${topics}\n\n`;
    }

    summary += recent.map((l: any) => `User: ${l.user}\nKlawhub: ${l.agent}`).join("\n---\n");
    return summary;
  } catch (error) {
    console.error(`Failed to fetch session summary for ${slackUserId}:`, error);
    return "";
  }
}
