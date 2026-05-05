import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } else {
    console.warn("Upstash Redis credentials missing. Conversation cache will be disabled.");
  }
} catch (error) {
  console.error("Failed to initialize Upstash Redis:", error);
}

export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const MAX_THREAD_MESSAGES = 20;
const THREAD_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

export async function appendToThreadCache(
  threadId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  if (!redis) return;

  const key = `thread:${threadId}`;
  const message: ThreadMessage = {
    role,
    content,
    timestamp: Date.now(),
  };

  try {
    await redis.rpush(key, JSON.stringify(message));
    // Keep only the last MAX_THREAD_MESSAGES
    await redis.ltrim(key, -MAX_THREAD_MESSAGES, -1);
    await redis.expire(key, THREAD_EXPIRY_SECONDS);
  } catch (error) {
    console.error(`Failed to append to thread cache ${threadId}:`, error);
  }
}

export async function getThreadCache(threadId: string): Promise<ThreadMessage[]> {
  if (!redis) return [];

  const key = `thread:${threadId}`;
  try {
    const rawMessages = await redis.lrange(key, 0, -1);
    return rawMessages.map((msg: string | ThreadMessage) => {
      // Upstash might automatically parse JSON, so we handle both string and object
      return typeof msg === "string" ? JSON.parse(msg) : msg;
    });
  } catch (error) {
    console.error(`Failed to fetch thread cache ${threadId}:`, error);
    return [];
  }
}

export async function clearThreadCache(threadId: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.del(`thread:${threadId}`);
  } catch (error) {
    console.error(`Failed to clear thread cache ${threadId}:`, error);
  }
}
