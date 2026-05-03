import { NextRequest } from "next/server";
import { createHmac } from "crypto";

/**
 * Verifies that a Slack request is authentic using HMAC-SHA256.
 * Rejects requests older than 5 minutes to prevent replay attacks.
 */
export function verifySlackRequest(req: NextRequest, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const secret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !secret) return false;

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const mySignature = "v0=" + createHmac("sha256", secret).update(sigBaseString).digest("hex");
  return signature === mySignature;
}
