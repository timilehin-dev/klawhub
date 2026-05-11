import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/integrations/slack/verify";
import { claimEvent } from "@/events/dedup";
import { inngest } from "@/workflows/client";

/**
 * Slack Events endpoint — thin relay to Inngest.
 *
 * Returns 200 OK within ~100ms (verify + dedup + Inngest send).
 * ALL actual processing (classification, LLM calls, Slack responses)
 * runs in Inngest step functions with proper execution time (up to 15 min).
 *
 * This fixes the critical Vercel serverless issue where fire-and-forget
 * async work was killed immediately after the HTTP response.
 */

// Allow up to 60s for the handler (safety net — should complete in <1s)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.text();

  // 1. Verify Slack signature (~1ms)
  if (!verifySlackRequest(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // 2. URL verification handshake
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // 3. Ignore non-event payloads
  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;

  // 4. Quick filters — skip bot messages, subtypes, empty text (~0ms)
  if (event.bot_id || event.subtype) return NextResponse.json({ ok: true });

  const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  if (!text) return NextResponse.json({ ok: true });

  // 5. Allow messages through for proactive analysis and passive listening.
  //    (filtering is handled downstream in process.ts to minimize Inngest costs)
  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  const isThreadReply = !!(event.thread_ts && event.thread_ts !== event.ts);

  // 6. DB-backed dedup (~50ms) — survives cold starts, no race conditions
  const eventId = payload.event_id || `${event.ts || ""}-${event.user || ""}`;
  const isNew = await claimEvent(eventId);
  if (!isNew) return NextResponse.json({ ok: true });

  // 7. Dispatch to Inngest for processing — runs in its own execution context
  //    with up to 15-minute timeout and built-in retries.
  try {
    await inngest.send({
      name: "slack/message.received",
      data: {
        event,
        eventId,
        teamId: payload.team_id,
      },
    });
  } catch (err) {
    console.error("[EVENTS] Failed to send Inngest event:", err);
    return NextResponse.json({ error: "Failed to dispatch event" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
