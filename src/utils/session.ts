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
  
  // If it's a valid hex string of even length, use hex
  if (secret.length >= 32 && secret.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  // Fall back to treating it as utf8 (highly robust for plain-text keys)
  return Buffer.from(secret, "utf8");
}

// ── Cookie Signing ──

/**
 * Sign a workspace ID for use in an httpOnly cookie.
 * Format: "workspaceId.hmacHex"
 */
export function signWorkspaceId(workspaceId: string): string {
  const hmac = createHmac("sha256", getSecret());
  hmac.update(workspaceId);
  const sig = hmac.digest("hex").slice(0, 32); // 32 hex chars = 16 bytes
  return `${workspaceId}.${sig}`;
}

/**
 * Verify and extract a signed workspace ID from a cookie value.
 * Returns null if the signature is invalid.
 */
export function verifyWorkspaceId(cookieValue: string): string | null {
  try {
    const dotIndex = cookieValue.lastIndexOf(".");
    if (dotIndex === -1) {
      console.warn("[SESSION] Cookie missing signature dot delimiter:", cookieValue);
      return null;
    }

    const workspaceId = cookieValue.slice(0, dotIndex);
    const sig = cookieValue.slice(dotIndex + 1);

    const hmac = createHmac("sha256", getSecret());
    hmac.update(workspaceId);
    const expected = hmac.digest("hex").slice(0, 32);

    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(sig, "utf8");
    if (expectedBuf.length !== actualBuf.length) {
      console.warn("[SESSION] Cookie signature length mismatch. Expected length:", expectedBuf.length, "Actual:", actualBuf.length);
      return null;
    }
    
    const matched = timingSafeEqual(expectedBuf, actualBuf);
    if (!matched) {
      console.warn("[SESSION] Cookie signature mismatch verification failed. WorkspaceId:", workspaceId);
      return null;
    }
    return workspaceId;
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
  const sig = hmac.digest("hex").slice(0, 32);
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
  const expected = hmac.digest("hex").slice(0, 32);

  try {
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(sig, "utf8");
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

// ── Rate Limiting (in-memory, per-IP) ──

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // per window
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60_000; // clean up every 5 min

function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt + RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(key);
    }
  }
}

/**
 * Check rate limit for an IP address.
 * Returns true if the request is allowed, false if rate limited.
 */
export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  // Periodic cleanup
  if (rateLimitMap.size > 1000) cleanupRateLimits();

  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count);
  return { allowed: entry.count <= RATE_LIMIT_MAX_REQUESTS, remaining };
}
