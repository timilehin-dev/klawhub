import { createHmac, timingSafeEqual } from "crypto";

/**
 * Session helpers for signing cookies and OAuth states.
 * Uses HMAC-SHA256 for tamper-proof tokens.
 *
 * Requires SESSION_SECRET env var (falls back to INTEGRATION_ENCRYPTION_KEY).
 */

function getSecret(): Buffer {
  // Prioritize INTEGRATION_ENCRYPTION_KEY to ensure absolute consistency across Serverless and Edge runtimes
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("INTEGRATION_ENCRYPTION_KEY or SESSION_SECRET is required");

  // Force treating as utf8 under both standard Node and Next.js Edge runtimes.
  // This bypasses Next.js Edge hex-decoding polyfill bugs and aligns keys perfectly.
  return Buffer.from(secret, "utf8");
}

// ── Cookie Signing ──

/**
 * Sign a workspace ID for use in an httpOnly cookie.
 * Format: "workspaceId.hmacHex"
 */
export async function signWorkspaceId(workspaceId: string): Promise<string> {
  // Use global, standard Web Crypto API available natively in both standard Node.js and Edge Runtime.
  // This bypasses any buggy node-crypto polyfills.
  const subtle = typeof crypto !== "undefined" && crypto.subtle ? crypto.subtle : (globalThis as any).crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto API (subtle) is not available in this runtime environment");

  const keyData = getSecret();
  const encoder = new TextEncoder();
  const data = encoder.encode(workspaceId);

  const key = await subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await subtle.sign("HMAC", key, data);
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${workspaceId}.${sigHex}`;
}

/**
 * Verify and extract a signed workspace ID from a cookie value.
 * Returns null if the signature is invalid.
 */
export async function verifyWorkspaceId(cookieValue: string): Promise<string | null> {
  try {
    const dotIndex = cookieValue.lastIndexOf(".");
    if (dotIndex === -1) {
      console.warn("[SESSION] Cookie missing signature dot delimiter:", cookieValue);
      return null;
    }

    const workspaceId = cookieValue.slice(0, dotIndex);
    const sig = cookieValue.slice(dotIndex + 1);

    const subtle = typeof crypto !== "undefined" && crypto.subtle ? crypto.subtle : (globalThis as any).crypto?.subtle;
    if (!subtle) throw new Error("Web Crypto API (subtle) is not available in this runtime environment");

    const encoder = new TextEncoder();
    const keyData = getSecret();
    const data = encoder.encode(workspaceId);

    const key = await subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await subtle.sign("HMAC", key, data);
    const expectedSigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Use timingSafeEqual to prevent timing attacks
    try {
      const expectedBuf = Buffer.from(expectedSigHex, "utf8");
      const actualBuf = Buffer.from(sig, "utf8");
      if (expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)) {
        return workspaceId;
      }
    } catch {
      // Fallback to standard comparison if Buffers fail, but log it
      if (expectedSigHex === sig) return workspaceId;
    }

    console.warn("[SESSION] Cookie signature mismatch verification failed. WorkspaceId:", workspaceId);
    return null;
  } catch (err) {
    console.error("[SESSION] Error during cookie verification:", err);
    return null;
  }
}

// ── OAuth State Signing ──

/**
 * Create a signed OAuth state string.
 * Format: "provider:workspaceId:timestamp.hmacHex"
 * Timestamp prevents replay (states older than 10 minutes are rejected).
 */
export function createSignedOAuthState(provider: string, workspaceId: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(36);
  const payload = `${provider}:${workspaceId}:${timestamp}`;
  const hmac = createHmac("sha256", getSecret());
  hmac.update(payload);
  const sig = hmac.digest("hex");
  return `${payload}.${sig}`;
}

/**
 * Verify and parse a signed OAuth state.
 * Returns null if invalid, expired (>10 min), or tampered.
 */
export function verifyOAuthState(state: string): { provider: string; workspaceId: string } | null {
  const dotIndex = state.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payload = state.slice(0, dotIndex);
  const sig = state.slice(dotIndex + 1);

  const hmac = createHmac("sha256", getSecret());
  hmac.update(payload);
  const expected = hmac.digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(sig, "hex");
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null;
  } catch {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3) return null;

  const [provider, workspaceId, tsBase36] = parts;
  const ts = parseInt(tsBase36, 36);
  const ageSeconds = Math.floor(Date.now() / 1000) - ts;

  // Reject states older than 10 minutes
  if (ageSeconds > 600 || ageSeconds < 0) return null;

  return { provider, workspaceId };
}

import { Redis } from "@upstash/redis";

const RATE_LIMIT_WINDOW_SECONDS = 60; 
const RATE_LIMIT_MAX_REQUESTS = 60; 

let redis: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch {
  // Fallback to allowed if Redis fails to avoid blocking users
}

/**
 * Check rate limit for an IP address.
 * Uses Redis for persistence across serverless cold starts.
 */
export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  if (!redis) {
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS };
  }

  const key = `rate_limit:${ip}`;
  try {
    const count = await redis.incr(key);
    
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }

    const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - count);
    return { allowed: count <= RATE_LIMIT_MAX_REQUESTS, remaining };
  } catch (err) {
    console.error("[RATE-LIMIT] Redis error:", err);
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS };
  }
}
