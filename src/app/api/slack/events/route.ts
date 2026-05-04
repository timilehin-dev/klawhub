import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { claimEvent } from "@/lib/events/dedup";
import { processSlackEvent } from "@/lib/events/process";

/**
 * Slack Events endpoint — receives all event_callback, app_mention, and message events.
 *
 * PHASE A FIX: Returns 200 OK within ~50ms (verify + dedup only).
 * All actual processing (classification, agent dispatch, chat) runs async.
 * This prevents Slack's 3-second timeout from killing long LLM calls.
 */
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

  // 5. Only process: mentions, DMs, and thread replies
  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  const isThreadReply = !!(event.thread_ts && event.thread_ts !== event.ts);

  if (!isMention && !isDM && !isThreadReply) {
    return NextResponse.json({ ok: true });
  }

  // 6. DB-backed dedup (~50ms) — survives cold starts, no race conditions
  const eventId = payload.event_id || `${event.ts || ""}-${event.user || ""}`;
  const isNew = await claimEvent(eventId);
  if (!isNew) return NextResponse.json({ ok: true });

  // 7. Return 200 IMMEDIATELY — all processing is async
  processSlackEvent({
    event,
    eventId,
    teamId: payload.team_id,
  }).catch((err) => {
    console.error("[EVENTS] Async processing error:", err);
  });

  return NextResponse.json({ ok: true });
}
