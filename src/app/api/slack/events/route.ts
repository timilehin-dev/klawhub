import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { slack, postToThread, addReaction } from "@/lib/slack/client";
import { classify } from "@/lib/agents/classifier";
import { chatAsAgent } from "@/lib/agents/general";
import { createRun, createTask, getRun, getRecentTasks, getUserSchedules, getUserScheduleCount } from "@/lib/db";
import { memoryWrite } from "@/lib/tools/memory";
import { parseScheduleRequest } from "@/lib/tools/schedule-parser";
import { createSchedule } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { extractAndStoreKnowledge } from "@/lib/tools/knowledge-extractor";

const processedEvents = new Set<string>();
const MAX_DEDUP = 100;

// Keywords that suggest a follow-up in an existing thread
const FOLLOWUP_PATTERNS = [
  /\b(revise|revision|update|modify|change|fix|improve|adjust|tweak)\b/i,
  /\b(make it|try again|redo|regenerate|re-do)\b/i,
  /\binstead|different|another|alternative|more detail/i,
  /\b(convert|translate|rewrite|reformat)\b/i,
];

// Keywords that indicate a scheduling request
const SCHEDULE_PATTERNS = [
  /\b(schedul|remind|cron|recurring|every|daily|weekly|monthly)\b/i,
  /\b(set up|create|add)\s+(a\s+)?(schedul|remind|cron|alert)/i,
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

  // Ignore bot messages and subtypes (edits, joins, etc.)
  if (event.bot_id || event.subtype) return NextResponse.json({ ok: true });

  const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  if (!text) return NextResponse.json({ ok: true });

  const userId = event.user as string;
  const channelId = event.channel as string;
  const threadTs = event.thread_ts as string | undefined;
  const messageTs = event.ts as string;

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  const isThreadReply = !!(threadTs && threadTs !== messageTs);

  // Only process: mentions, DMs, or thread replies in channels (for follow-ups)
  if (!isMention && !isDM && !isThreadReply) {
    return NextResponse.json({ ok: true });
  }

  if (text.length > 4000) {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: "That message is too long. Please keep requests under 4000 characters.",
    });
    return NextResponse.json({ ok: true });
  }

  try {
    // ── Thread reply detection (follow-ups in existing threads) ──
    if (isThreadReply && !isMention) {
      const isFollowup = FOLLOWUP_PATTERNS.some((p) => p.test(text));

      if (isFollowup) {
        // Check if there's an existing run or task in this thread
        const existingRun = await getRun(threadTs).catch(() => null);
        const existingTask = await getRecentTasks(userId, 1).catch(() => null);

        if (existingRun && existingRun.length > 0) {
          const run = existingRun[0];
          if (run.slackThreadTs === threadTs && (run.status === "done" || run.status === "error")) {
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

      // Thread reply without follow-up keywords and no @mention — respond via general agent
      const classification = await classify(text);
      if (classification.type === "chat") {
        const responseText = await chatAsAgent(userId, text);
        await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction");
        await slack.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: responseText,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ── Schedule detection (in mentions and DMs) ──
    if (SCHEDULE_PATTERNS.some((p) => p.test(text))) {
      try {
        const parsed = await parseScheduleRequest(text);
        const count = await getUserScheduleCount(userId);
        if (count >= 10) {
          await slack.chat.postMessage({
            channel: channelId,
            thread_ts: messageTs,
            text: `:warning: You have reached the maximum of 10 active schedules. Remove one with \`/klawhub cancel-schedule\` first.`,
          });
          return NextResponse.json({ ok: true });
        }

        const [schedule] = await createSchedule({
          slackUserId: userId,
          name: parsed.name,
          cronExpr: parsed.cronExpr,
          timezone: parsed.timezone,
          action: parsed.action,
          channelId,
        });

        await slack.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: `:clock1: *Schedule created!*\n\n*${parsed.name}*\n${parsed.cronExpr} (${parsed.timezone})\nAction: ${parsed.action.slice(0, 100)}\n\nID: \`${schedule.id.slice(0, 8)}\`\nManage with \`/klawhub schedules\``,
        });
        return NextResponse.json({ ok: true });
      } catch (err) {
        // If parsing fails, fall through to normal classification
        console.error("[EVENTS] Schedule parse failed:", err);
      }
    }

    // ── Standard classification pipeline ──
    const classification = await classify(text);

    // CHAT — use the general agent (tool-aware, context-rich)
    if (classification.type === "chat") {
      const responseText = await chatAsAgent(userId, text);

      await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction");

      // Extract knowledge from conversations (non-blocking)
      extractAndStoreKnowledge(userId, text).catch(() => {});

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

    // Extract knowledge from task requests (non-blocking)
    extractAndStoreKnowledge(userId, text).catch(() => {});

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
