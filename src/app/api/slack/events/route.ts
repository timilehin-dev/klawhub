import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { slack, postToThread, addReaction } from "@/lib/slack/client";
import { classify } from "@/lib/agents/classifier";
import { createRun, createTask, getRun, getRecentTasks } from "@/lib/db";
import { memoryWrite, buildUserContext } from "@/lib/tools/memory";
import { inngest } from "@/lib/inngest/client";

const processedEvents = new Set<string>();
const MAX_DEDUP = 100;

// Keywords that suggest a follow-up in an existing thread
const FOLLOWUP_PATTERNS = [
  /\b(revise|revision|update|modify|change|fix|improve|adjust|tweak)\b/i,
  /\b(make it|try again|redo|regenerate|re-do)\b/i,
  /\binstead|different|another|alternative|more detail/i,
  /\b(convert|translate|rewrite|reformat)\b/i,
];

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

  // Dedup
  if (processedEvents.has(eventId)) return NextResponse.json({ ok: true });
  processedEvents.add(eventId);
  if (processedEvents.size > MAX_DEDUP) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }

  // Ignore bot messages
  if (event.bot_id || event.subtype === "bot_message") return NextResponse.json({ ok: true });

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  if (!isMention && !isDM) return NextResponse.json({ ok: true });

  const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  if (!text) return NextResponse.json({ ok: true });

  const userId = event.user as string;
  const channelId = event.channel as string;
  const threadTs = event.thread_ts as string | undefined;
  const messageTs = event.ts as string;

  if (text.length > 4000) {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: "That message is too long. Please keep requests under 4000 characters.",
    });
    return NextResponse.json({ ok: true });
  }

  try {
    // ── Thread reply detection ──
    // If the user is replying in a thread (not the top message), check if it's a follow-up
    if (threadTs && threadTs !== messageTs) {
      const isFollowup = FOLLOWUP_PATTERNS.some((p) => p.test(text));

      if (isFollowup) {
        // Check if there's an existing run or task in this thread
        const existingRun = await getRun(threadTs).catch(() => null);
        const existingTask = await getRecentTasks(userId, 1).catch(() => null);

        if (existingRun && existingRun.length > 0) {
          const run = existingRun[0];
          if (run.slackThreadTs === threadTs && (run.status === "done" || run.status === "error")) {
            // Retrigger the build with the follow-up context
            try { await addReaction(channelId, messageTs, "gear"); } catch { /* ok */ }
            await postToThread(channelId, messageTs, `*Build Squad re-activated!*\n_Follow-up: ${text}_\n\nPM Agent is analyzing...`);

            const [newRun] = await createRun({
              slackUserId: userId,
              slackChannelId: channelId,
              slackThreadTs: messageTs,
              request: `${text}\n\n[Context from previous build: ${run.request.slice(0, 200)}]`,
            });

            await inngest.send({
              name: "slack/build.requested",
              data: {
                slackChannelId: channelId,
                slackThreadTs: messageTs,
                slackUserId: userId,
                messageText: text,
                runId: newRun.id,
              },
            });

            await memoryWrite(userId, `Build follow-up: ${text.slice(0, 100)}`, "preference");
            return NextResponse.json({ ok: true });
          }
        }

        if (existingTask && existingTask.length > 0) {
          const task = existingTask[0];
          if (task.slackThreadTs === threadTs && (task.status === "done" || task.status === "error")) {
            // Retrigger the task
            const taskEmojis: Record<string, string> = {
              document: "page_facing_up",
              research: "mag",
              analytics: "chart_with_upwards_trend",
            };
            const emoji = taskEmojis[task.type] || "speech_balloon";
            try { await addReaction(channelId, messageTs, emoji); } catch { /* ok */ }

            const [newTask] = await createTask({
              slackUserId: userId,
              slackChannelId: channelId,
              slackThreadTs: messageTs,
              type: task.type,
              request: `${text}\n\n[Context from previous task: ${task.request.slice(0, 200)}]`,
            });

            await inngest.send({
              name: `slack/${task.type}.requested`,
              data: {
                slackChannelId: channelId,
                slackThreadTs: messageTs,
                slackUserId: userId,
                messageText: text,
                taskId: newTask.id,
              },
            });

            await memoryWrite(userId, `${task.type} follow-up: ${text.slice(0, 100)}`, "preference");
            return NextResponse.json({ ok: true });
          }
        }
      }
    }

    // ── Standard classification pipeline ──
    const classification = await classify(text);

    // CHAT
    if (classification.type === "chat") {
      const userContext = await buildUserContext(userId);
      let responseText = classification.response || "";

      // If we have context, personalize the chat response
      if (userContext && !responseText.includes("I don't have context")) {
        responseText = classification.response || "";
      }

      await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction");
      await slack.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: responseText,
      });
      return NextResponse.json({ ok: true });
    }

    // UNCLEAR
    if (classification.type === "unclear") {
      await slack.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `:thinking: ${classification.question || "Could you clarify what you need?"}`,
      });
      return NextResponse.json({ ok: true });
    }

    const requestText = classification.extractedRequest || text;

    // BUILD
    if (classification.type === "build") {
      try { await addReaction(channelId, messageTs, "gear"); } catch { /* ok */ }

      await postToThread(channelId, messageTs, `*Build Squad activated!*\n_Request: ${requestText}_\n\nPM Agent is analyzing...`);

      const [run] = await createRun({
        slackUserId: userId,
        slackChannelId: channelId,
        slackThreadTs: messageTs,
        request: requestText,
      });

      await inngest.send({
        name: "slack/build.requested",
        data: {
          slackChannelId: channelId,
          slackThreadTs: messageTs,
          slackUserId: userId,
          messageText: requestText,
          runId: run.id,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // DOCUMENT
    if (classification.type === "document") {
      try { await addReaction(channelId, messageTs, "page_facing_up"); } catch { /* ok */ }
      await postToThread(channelId, messageTs, `*Generating document...*\n_Request: ${requestText}_`);

      const [task] = await createTask({
        slackUserId: userId,
        slackChannelId: channelId,
        slackThreadTs: messageTs,
        type: "document",
        request: requestText,
      });
      await inngest.send({
        name: "slack/document.requested",
        data: {
          slackChannelId: channelId,
          slackThreadTs: messageTs,
          slackUserId: userId,
          messageText: requestText,
          taskId: task.id,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // RESEARCH
    if (classification.type === "research") {
      try { await addReaction(channelId, messageTs, "mag"); } catch { /* ok */ }
      await postToThread(channelId, messageTs, `*Researching...*\n_Topic: ${requestText}_`);

      const [task] = await createTask({
        slackUserId: userId,
        slackChannelId: channelId,
        slackThreadTs: messageTs,
        type: "research",
        request: requestText,
      });
      await inngest.send({
        name: "slack/research.requested",
        data: {
          slackChannelId: channelId,
          slackThreadTs: messageTs,
          slackUserId: userId,
          messageText: requestText,
          taskId: task.id,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // ANALYTICS
    if (classification.type === "analytics") {
      try { await addReaction(channelId, messageTs, "chart_with_upwards_trend"); } catch { /* ok */ }
      await postToThread(channelId, messageTs, `*Analyzing data...*\n_Request: ${requestText}_`);

      const [task] = await createTask({
        slackUserId: userId,
        slackChannelId: channelId,
        slackThreadTs: messageTs,
        type: "analytics",
        request: requestText,
      });
      await inngest.send({
        name: "slack/analytics.requested",
        data: {
          slackChannelId: channelId,
          slackThreadTs: messageTs,
          slackUserId: userId,
          messageText: requestText,
          taskId: task.id,
        },
      });
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error("[EVENTS] Error:", error);
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: "Something went wrong processing your request. Please try again.",
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
