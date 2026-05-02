import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { slack, postToThread, addReaction } from "@/lib/slack/client";
import { classify } from "@/lib/agents/classifier";
import { createRun, createTask } from "@/lib/db";
import { memoryWrite } from "@/lib/tools/memory";
import { inngest } from "@/lib/inngest/client";

const processedEvents = new Set<string>();
const MAX_DEDUP = 100;

export async function POST(req: NextRequest) {
  const body = await req.text();

  if (!verifySlackRequest(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);

  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;
  const eventId = payload.event_id || `${event.ts || ""}-${event.user || ""}`;

  if (processedEvents.has(eventId)) return NextResponse.json({ ok: true });
  processedEvents.add(eventId);
  if (processedEvents.size > MAX_DEDUP) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }

  if (event.bot_id || event.subtype === "bot_message") return NextResponse.json({ ok: true });

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  if (!isMention && !isDM) return NextResponse.json({ ok: true });

  const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  if (!text) return NextResponse.json({ ok: true });

  const userId = event.user as string;
  const channelId = event.channel as string;
  const threadTs = event.ts as string;

  if (text.length > 4000) {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "⚠️ That message is too long. Please keep requests under 4000 characters.",
    });
    return NextResponse.json({ ok: true });
  }

  try {
    const classification = await classify(text);

    // CHAT
    if (classification.type === "chat") {
      await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction");
      await slack.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: classification.response || "" });
      return NextResponse.json({ ok: true });
    }

    // UNCLEAR
    if (classification.type === "unclear") {
      await slack.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: `🤔 ${classification.question || "Could you clarify what you need?"}` });
      return NextResponse.json({ ok: true });
    }

    const requestText = classification.extractedRequest || text;

    // BUILD
    if (classification.type === "build") {
      try { await addReaction(channelId, threadTs, "gear"); } catch { /* ok */ }

      await slack.chat.postMessage({
        channel: channelId, thread_ts: threadTs,
        text: `⚙️ *Build Squad activated!*\n_Request: ${requestText}_\n\nPM Agent is analyzing...`,
      });

      const [run] = await createRun({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs, request: requestText });

      await inngest.send({
        name: "slack/build.requested",
        data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: requestText, runId: run.id },
      });
      return NextResponse.json({ ok: true });
    }

    // DOCUMENT
    if (classification.type === "document") {
      try { await addReaction(channelId, threadTs, "page_facing_up"); } catch { /* ok */ }
      await slack.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: `📄 *Generating document...*\n_Request: ${requestText}_` });

      const [task] = await createTask({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs, type: "document", request: requestText });
      await inngest.send({
        name: "slack/document.requested",
        data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: requestText, taskId: task.id },
      });
      return NextResponse.json({ ok: true });
    }

    // RESEARCH
    if (classification.type === "research") {
      try { await addReaction(channelId, threadTs, "mag"); } catch { /* ok */ }
      await slack.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: `🔍 *Researching...*\n_Topic: ${requestText}_` });

      const [task] = await createTask({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs, type: "research", request: requestText });
      await inngest.send({
        name: "slack/research.requested",
        data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: requestText, taskId: task.id },
      });
      return NextResponse.json({ ok: true });
    }

    // ANALYTICS
    if (classification.type === "analytics") {
      try { await addReaction(channelId, threadTs, "chart_with_upwards_trend"); } catch { /* ok */ }
      await slack.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: `📊 *Analyzing data...*\n_Request: ${requestText}_` });

      const [task] = await createTask({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs, type: "analytics", request: requestText });
      await inngest.send({
        name: "slack/analytics.requested",
        data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: requestText, taskId: task.id },
      });
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error("[EVENTS] Error:", error);
    await slack.chat.postMessage({
      channel: channelId, thread_ts: threadTs,
      text: "❌ Something went wrong processing your request. Please try again.",
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
