import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies that a Slack request is authentic using HMAC-SHA256.
 * Rejects requests older than 5 minutes to prevent replay attacks.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifySlackRequest(req: NextRequest, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const secret = process.env.SLACK_SIGNING_SECRET || process.env.NEXT_PUBLIC_SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !secret) return false;

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const mySignature = "v0=" + createHmac("sha256", secret).update(sigBaseString).digest("hex");

  // Timing-safe comparison to prevent timing attacks
  const expected = Buffer.from(mySignature, "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
