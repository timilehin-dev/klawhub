import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { slack } from "@/lib/slack/client";
import { agents } from "@/lib/agents";

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

const processedEvents = new Set<string>();

export async function POST(req: NextRequest) {
  const body = await req.text();

  if (!verifySlackRequest(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);

  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback") {
    const event = payload.event;
    const eventId = payload.event_id || `${event.ts}-${event.user}`;

    if (processedEvents.has(eventId)) {
      return NextResponse.json({ ok: true });
    }
    processedEvents.add(eventId);

    if (processedEvents.size > 100) {
      const first = processedEvents.values().next().value;
      processedEvents.delete(first);
    }

    if (event.bot_id || event.subtype === "bot_message") {
      return NextResponse.json({ ok: true });
    }

    const isAppMention = event.type === "app_mention";
    const isDirectMessage = event.type === "message" && event.channel_type === "im";

    if (!isAppMention && !isDirectMessage) {
      return NextResponse.json({ ok: true });
    }

    const text = event.text || "";
    const cleanText = text.replace(/<@[^>]+>/g, "").trim();

    if (!cleanText) {
      return NextResponse.json({ ok: true });
    }

    try {
      // CLASSIFY the message first
      const classification = await agents.general.classify(cleanText);

      if (classification.type === "chat") {
        // Simple chat response, no build squad
        await slack.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: classification.response,
        });
        return NextResponse.json({ ok: true });
      }

      if (classification.type === "unclear") {
        // Ask for clarification
        await slack.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: `🤔 ${classification.question}`,
        });
        return NextResponse.json({ ok: true });
      }

      // BUILD — activate the squad
      const buildRequest = classification.extractedRequest;

      try {
        await slack.reactions.add({
          channel: event.channel,
          timestamp: event.ts,
          name: "gear",
        });
      } catch (reactErr: any) {
        if (reactErr.data?.error === "already_reacted") {
          console.log("[SLACK] Already reacted, continuing...");
        } else {
          throw reactErr;
        }
      }

      await slack.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `⚙️ Build Squad activated!\n_Request: ${buildRequest}_\n\nPM Agent is analyzing...`,
      });

      const [run] = await db
        .insert(runs)
        .values({
          slackUserId: event.user,
          slackChannelId: event.channel,
          slackThreadTs: event.ts,
          request: buildRequest,
          status: "pending",
        })
        .returning();

      await inngest.send({
        name: "slack/build.requested",
        data: {
          slackChannelId: event.channel,
          slackThreadTs: event.ts,
          slackUserId: event.user,
          messageText: buildRequest,
          runId: run.id,
        },
      });

      console.log(`[SLACK] Build requested by ${event.user}: ${buildRequest.slice(0, 50)}...`);
    } catch (error) {
      console.error("[SLACK] Error handling event:", error);

      try {
        await slack.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: "❌ Something went wrong. Check the logs.",
        });
      } catch {}
    }
  }

  return NextResponse.json({ ok: true });
}
