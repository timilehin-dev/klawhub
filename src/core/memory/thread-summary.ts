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

const SESSION_EXPIRY_SECONDS = 60 * 60 * 2; // 2 hours

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

    logs.push({ user: userMessage, agent: agentResponse.slice(0, 200) });
    if (logs.length > 5) logs = logs.slice(-5);

    await redis.set(key, logs, { ex: SESSION_EXPIRY_SECONDS });
  } catch (error) {
    console.error("[REDIS] Failed to initialize Upstash Redis client:", error);
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

    return logs.map((l: any) => `User: ${l.user}\nAgent: ${l.agent}`).join("\n---\n");
  } catch (error) {
    console.error(`Failed to fetch session summary for ${slackUserId}:`, error);
    return "";
  }
}
