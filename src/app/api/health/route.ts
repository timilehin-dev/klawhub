import { NextResponse } from "next/server";

/**
 * Health Check Endpoint
 * Validates connectivity to all critical dependencies:
 * - PostgreSQL (Supabase)
 * - Redis (Upstash)
 * - LLM provider (Ollama)
 */
export async function GET() {
  const checks: Record<string, { status: "ok" | "error" | "unconfigured"; latencyMs?: number; error?: string }> = {};
  const startAll = Date.now();

  // 1. Database
  try {
    const start = Date.now();
    const { getDb } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`SELECT 1`);
    checks.database = { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    checks.database = { status: "error", error: (err as Error).message };
  }

  // 2. Redis
  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const start = Date.now();
      const { Redis } = await import("@upstash/redis");
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      await redis.ping();
      checks.redis = { status: "ok", latencyMs: Date.now() - start };
    } else {
      checks.redis = { status: "unconfigured" };
    }
  } catch (err) {
    checks.redis = { status: "error", error: (err as Error).message };
  }

  // 3. LLM Provider
  try {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://api.ollama.com/v1";
    const key = process.env.OLLAMA_API_KEY_1;
    if (key) {
      const start = Date.now();
      const resp = await fetch(`${ollamaUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
      checks.llm = { status: resp.ok ? "ok" : "error", latencyMs: Date.now() - start, ...(resp.ok ? {} : { error: `HTTP ${resp.status}` }) };
    } else {
      checks.llm = { status: "unconfigured" };
    }
  } catch (err) {
    checks.llm = { status: "error", error: (err as Error).message };
  }

  // 4. Inngest
  checks.inngest = {
    status: process.env.INNGEST_SIGNING_KEY ? "ok" : "unconfigured",
  };

  // 5. External Services
  checks.tavily = { status: process.env.TAVILY_API_KEY_1 ? "ok" : "unconfigured" };
  checks.modal = { status: process.env.MODAL_FUNCTION_URL ? "ok" : "unconfigured" };
  checks.resend = { status: process.env.RESEND_API_KEY ? "ok" : "unconfigured" };
  checks.slack = { status: process.env.SLACK_BOT_TOKEN ? "ok" : "unconfigured" };
  checks.encryption = { status: process.env.INTEGRATION_ENCRYPTION_KEY ? "ok" : "unconfigured" };

  const overallOk = Object.values(checks).every(c => c.status !== "error");

  return NextResponse.json({
    status: overallOk ? "healthy" : "degraded",
    totalLatencyMs: Date.now() - startAll,
    checks,
  }, { status: overallOk ? 200 : 503 });
}
