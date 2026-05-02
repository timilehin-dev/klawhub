import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

function verifySlackRequest(req: NextRequest, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const secret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !secret) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const mySignature = "v0=" + createHmac("sha256", secret).update(sigBaseString).digest("hex");
  return signature === mySignature;
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  if (!verifySlackRequest(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(decodeURIComponent(body).replace("payload=", ""));

  // Handle shortcuts
  if (payload.type === "shortcut") {
    if (payload.callback_id === "klawhub_global_shortcut") {
      // Open a modal or post a message
      return NextResponse.json({
        response_action: "clear",
      });
    }
  }

  // Handle block actions (button clicks)
  if (payload.type === "block_actions") {
    // Future: handle approve/reject buttons
  }

  return NextResponse.json({ ok: true });
}
