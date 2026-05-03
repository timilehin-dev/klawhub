import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { getWorkspaceSlack, postToThread, addReaction } from "@/lib/slack/client";
import { classify } from "@/lib/agents/classifier";
import { chatAsAgent } from "@/lib/agents/general";
import { createRun, createTask, getRunByThreadTs, getTaskByThreadTs, getUserSchedules, getUserScheduleCount } from "@/lib/db";
import { memoryWrite } from "@/lib/tools/memory";
import { parseScheduleRequest } from "@/lib/tools/schedule-parser";
import { createSchedule } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { extractAndStoreKnowledge } from "@/lib/tools/knowledge-extractor";
import { ensureMember, checkUsageLimit, ensureWorkspaceExists } from "@/lib/slack/workspace";
import { getWorkspaceByTeamId } from "@/lib/db";
import { trackSkillUsage } from "@/lib/db";

const processedEvents = new Set<string>();
const MAX_DEDUP = 100;

const FOLLOWUP_PATTERNS = [
  /\b(revise|revision|update|modify|change|fix|improve|adjust|tweak)\b/i,
  /\b(make it|try again|redo|regenerate|re-do)\b/i,
  /\binstead|different|another|alternative|more detail/i,
  /\b(convert|translate|rewrite|reformat)\b/i,
];

const SCHEDULE_PATTERNS = [
  /\b(schedul|remind|cron|recurring|every|daily|weekly|monthly)\b/i,
  /\b(set up|create|add)\s+(a\s+)?(schedul|remind|cron|alert)/i,
];

const APPROVAL_PATTERNS = [
  /^\s*(approve|yes|ok|go ahead|looks good|proceed|accepted|ship it|do it|lgtm)\s*$/i,
  /^\s*\+1\s*$/,
];

const REJECTION_PATTERNS = [
  /^\s*(reject|no|cancel|stop|don't|do not|decline|nay)\s*$/i,
  /^\s*-1\s*$/,
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

  if (processedEvents.has(eventId)) return NextResponse.json({ ok: true });
  processedEvents.add(eventId);
  if (processedEvents.size > MAX_DEDUP) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }

  if (event.bot_id || event.subtype) return NextResponse.json({ ok: true });

  const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  if (!text) return NextResponse.json({ ok: true });

  const userId = event.user as string;
  const channelId = event.channel as string;
  const threadTs = event.thread_ts as string | undefined;
  const messageTs = event.ts as string;

  // Extract team_id for multi-workspace support
  const teamId = payload.team_id as string | undefined;

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  const isThreadReply = !!(threadTs && threadTs !== messageTs);

  if (!isMention && !isDM && !isThreadReply) {
    return NextResponse.json({ ok: true });
  }

  if (text.length > 4000) {
    await postToThread(channelId, messageTs, "That message is too long. Please keep requests under 4000 characters.", undefined, teamId);
    return NextResponse.json({ ok: true });
  }

  // Immediate reaction so user sees the bot is alive (fire-and-forget)
  addReaction(channelId, messageTs, "eyes", teamId).catch(() => {});

  // Track user as workspace member + ensure workspace exists (fire-and-forget, non-critical)
  ensureMember(userId, teamId).catch(() => {});
  ensureWorkspaceExists(teamId).catch(() => {});

  // Resolve workspaceId for integration tools (fire-and-forget)
  let workspaceId: string | undefined;
  try {
    if (teamId) {
      const ws = await getWorkspaceByTeamId(teamId);
      if (ws && ws.length > 0) workspaceId = ws[0].id;
    }
  } catch { /* non-critical */ }

  try {
    // ── Thread reply detection ──
    if (isThreadReply && !isMention) {
      // Check for approve/reject patterns first (for pending_approval runs/tasks)
      const isApproval = APPROVAL_PATTERNS.some((p) => p.test(text));
      const isRejection = REJECTION_PATTERNS.some((p) => p.test(text));

      if (isApproval || isRejection) {
        const decision = isApproval ? "approved" : "rejected";

        // Check for pending_approval runs in this thread (query by threadTs, not id)
        const threadRun = await getRunByThreadTs(threadTs).catch((err) => {
          console.error("[EVENTS] getRunByThreadTs error:", err);
          return null;
        });
        if (threadRun && threadRun.length > 0) {
          const pendingRun = threadRun[0];
          if (pendingRun.status === "pending_approval") {
            await inngest.send({
              name: "app/approval.decided",
              data: { referenceId: pendingRun.id, decision, userId },
            });
            await postToThread(channelId, messageTs, `:${isApproval ? "white_check_mark" : "x"}: *${decision === "approved" ? "Approved" : "Rejected"}* by <@${userId}>. ${isApproval ? "Engineer Agent is now coding..." : "Build cancelled."}`, undefined, teamId);
            return NextResponse.json({ ok: true });
          }
        }

        // Check for pending_approval tasks (documents) in this thread
        const threadTask = await getTaskByThreadTs(threadTs).catch((err) => {
          console.error("[EVENTS] getTaskByThreadTs error:", err);
          return null;
        });
        if (threadTask && threadTask.length > 0) {
          const pendingTask = threadTask[0];
          if (pendingTask.status === "pending_approval") {
            await inngest.send({
              name: "app/approval.decided",
              data: { referenceId: pendingTask.id, decision, userId },
            });
            await postToThread(channelId, messageTs, `:${isApproval ? "white_check_mark" : "x"}: *${decision === "approved" ? "Approved" : "Rejected"}* by <@${userId}>. ${isApproval ? "Generating full document..." : "Document generation cancelled."}`, undefined, teamId);
            return NextResponse.json({ ok: true });
          }
        }
      }

      const isFollowup = FOLLOWUP_PATTERNS.some((p) => p.test(text));

      if (isFollowup) {
        const existingRun = await getRunByThreadTs(threadTs).catch((err) => {
          console.error("[EVENTS] getRunByThreadTs (followup) error:", err);
          return null;
        });
        const existingTask = await getTaskByThreadTs(threadTs).catch((err) => {
          console.error("[EVENTS] getTaskByThreadTs (followup) error:", err);
          return null;
        });

        if (existingRun && existingRun.length > 0) {
          const run = existingRun[0];
          if ((run.status === "done" || run.status === "error") && run.slackThreadTs === threadTs) {
            try { await addReaction(channelId, messageTs, "gear", teamId); } catch { /* ok */ }
            await postToThread(channelId, messageTs, `*Build Squad re-activated!*\n_Follow-up: ${text}_\n\nPM Agent is analyzing...`, undefined, teamId);

            const [newRun] = await createRun({
              slackUserId: userId,
              slackChannelId: channelId,
              slackThreadTs: messageTs,
              request: `${text}\n\n[Context from previous build: ${run.request.slice(0, 200)}]`,
            });

            await inngest.send({
              name: "slack/build.requested",
              data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: text, runId: newRun.id, teamId },
            });

            await memoryWrite(userId, `Build follow-up: ${text.slice(0, 100)}`, "preference");
            return NextResponse.json({ ok: true });
          }
        }

        if (existingTask && existingTask.length > 0) {
          const task = existingTask[0];
          if ((task.status === "done" || task.status === "error") && task.slackThreadTs === threadTs) {
            const taskEmojis: Record<string, string> = { document: "page_facing_up", research: "mag", analytics: "chart_with_upwards_trend" };
            try { await addReaction(channelId, messageTs, taskEmojis[task.type] || "speech_balloon", teamId); } catch { /* ok */ }

            const [newTask] = await createTask({
              slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs, type: task.type,
              request: `${text}\n\n[Context from previous task: ${task.request.slice(0, 200)}]`,
            });

            await inngest.send({
              name: `slack/${task.type}.requested`,
              data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: text, taskId: newTask.id, teamId },
            });

            await memoryWrite(userId, `${task.type} follow-up: ${text.slice(0, 100)}`, "preference");
            return NextResponse.json({ ok: true });
          }
        }
      }

      // Thread reply — classify then handle
      const classification = await classify(text);

      if (classification.type === "chat") {
        const responseText = await chatAsAgent(userId, text, { workspaceId });
        await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction");
        await postToThread(channelId, messageTs, responseText, undefined, teamId);
        return NextResponse.json({ ok: true });
      }

      // Handle non-chat classifications in thread replies — dispatch as new tasks
      if (classification.type === "build") {
        try { await addReaction(channelId, messageTs, "gear", teamId); } catch { /* ok */ }
        await postToThread(channelId, messageTs, `*Build Squad activated!*\n_Request: ${text}_\n\nPM Agent is analyzing...`, undefined, teamId);

        const [newRun] = await createRun({
          slackUserId: userId,
          slackChannelId: channelId,
          slackThreadTs: messageTs,
          request: classification.extractedRequest || text,
        });
        await inngest.send({
          name: "slack/build.requested",
          data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: classification.extractedRequest || text, runId: newRun.id, teamId },
        });
        return NextResponse.json({ ok: true });
      }

      if (["document", "research", "analytics"].includes(classification.type)) {
        const taskType = classification.type as "document" | "research" | "analytics";
        const taskEmojis: Record<string, string> = { document: "page_facing_up", research: "mag", analytics: "chart_with_upwards_trend" };
        const taskLabels: Record<string, string> = { document: "Generating document", research: "Researching", analytics: "Analyzing data" };
        try { await addReaction(channelId, messageTs, taskEmojis[taskType] || "speech_balloon", teamId); } catch { /* ok */ }
        await postToThread(channelId, messageTs, `*${taskLabels[taskType]}...*\n_Request: ${text}_`, undefined, teamId);

        const [newTask] = await createTask({
          slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs, type: taskType,
          request: classification.extractedRequest || text,
        });
        await inngest.send({
          name: `slack/${taskType}.requested`,
          data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: classification.extractedRequest || text, taskId: newTask.id, teamId },
        });
        return NextResponse.json({ ok: true });
      }

      // UNCLEAR classification — ask for clarification
      await postToThread(channelId, messageTs, `:thinking: ${classification.question || "Could you clarify what you need?"}`, undefined, teamId);
      return NextResponse.json({ ok: true });
    }

    // ── Schedule detection ──
    if (SCHEDULE_PATTERNS.some((p) => p.test(text))) {
      try {
        const parsed = await parseScheduleRequest(text);
        const count = await getUserScheduleCount(userId);
        if (count >= 10) {
          await postToThread(channelId, messageTs, `:warning: You have reached the maximum of 10 active schedules. Remove one with \`/klawhub cancel-schedule\` first.`, undefined, teamId);
          return NextResponse.json({ ok: true });
        }

        const [schedule] = await createSchedule({
          slackUserId: userId, slackTeamId: teamId, name: parsed.name, cronExpr: parsed.cronExpr,
          timezone: parsed.timezone, action: parsed.action, channelId,
        });

        await postToThread(channelId, messageTs, `:clock1: *Schedule created!*\n\n*${parsed.name}*\n${parsed.cronExpr} (${parsed.timezone})\nAction: ${parsed.action.slice(0, 100)}\n\nID: \`${schedule.id.slice(0, 8)}\`\nManage with \`/klawhub schedules\``, undefined, teamId);
        return NextResponse.json({ ok: true });
      } catch (err) {
        console.error("[EVENTS] Schedule parse failed:", err);
        // Fall through to normal classification
      }
    }

    // ── Classify FIRST (fast, 100 tokens) ──
    const classification = await classify(text);

    // CHAT — use the general agent (this is the heavy path)
    if (classification.type === "chat") {
      try { await addReaction(channelId, messageTs, "speech_balloon", teamId); } catch { /* ok */ }
      const responseText = await chatAsAgent(userId, text, { workspaceId });
      await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction");
      // Extract knowledge from chat messages (fire-and-forget with logging)
      extractAndStoreKnowledge(userId, text).then((stored) => {
        if (stored > 0) console.log(`[EVENTS] Chat knowledge: stored ${stored} entities for ${userId}`);
      }).catch((err) => {
        console.error("[EVENTS] Chat knowledge extraction failed:", err?.message || err);
      });
      await postToThread(channelId, messageTs, responseText, undefined, teamId);
      return NextResponse.json({ ok: true });
    }

    // UNCLEAR
    if (classification.type === "unclear") {
      await postToThread(channelId, messageTs, `:thinking: ${classification.question || "Could you clarify what you need?"}`, undefined, teamId);
      return NextResponse.json({ ok: true });
    }

    // ── Task dispatches (lightweight — just DB insert + Inngest event) ──
    const requestText = classification.extractedRequest || text;

    // Extract knowledge from substantive messages (fire-and-forget with logging)
    extractAndStoreKnowledge(userId, text).then((stored) => {
      if (stored > 0) console.log(`[EVENTS] Knowledge: stored ${stored} entities for ${userId}`);
    }).catch((err) => {
      console.error("[EVENTS] Knowledge extraction failed:", err?.message || err);
    });

    // Track skill usage at dispatch time (await to ensure DB write completes)
    try {
      if (classification.type === "build") {
        await trackSkillUsage("build", userId, channelId, requestText, "attempted");
      } else if (["document", "research", "analytics"].includes(classification.type)) {
        await trackSkillUsage(classification.type, userId, channelId, requestText, "attempted");
      }
    } catch (err: unknown) {
      console.error("[EVENTS] trackSkillUsage failed:", err instanceof Error ? err.message : err);
    }

    // Usage limit check (chat/unclear don't count toward limits)
    const limitCheck = await checkUsageLimit(teamId);
    if (limitCheck && !limitCheck.allowed) {
      await postToThread(channelId, messageTs, `:warning: *Usage limit reached.*\nYou've used ${limitCheck.used}/${limitCheck.limit} agent runs this month. Upgrade your plan at https://klawhub.com/pricing to get more runs.`, undefined, teamId);
      return NextResponse.json({ ok: true });
    }

    if (classification.type === "build") {
      try { await addReaction(channelId, messageTs, "gear", teamId); } catch { /* ok */ }
      await postToThread(channelId, messageTs, `*Build Squad activated!*\n_Request: ${requestText}_\n\nPM Agent is analyzing...`, undefined, teamId);

      const [run] = await createRun({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs, request: requestText });
      await inngest.send({ name: "slack/build.requested", data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, runId: run.id, teamId } });
      return NextResponse.json({ ok: true });
    }

    if (classification.type === "document") {
      try { await addReaction(channelId, messageTs, "page_facing_up", teamId); } catch { /* ok */ }
      await postToThread(channelId, messageTs, `*Generating document...*\n_Request: ${requestText}_`, undefined, teamId);

      const [task] = await createTask({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs, type: "document", request: requestText });
      await inngest.send({ name: "slack/document.requested", data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, taskId: task.id, teamId } });
      return NextResponse.json({ ok: true });
    }

    if (classification.type === "research") {
      try { await addReaction(channelId, messageTs, "mag", teamId); } catch { /* ok */ }
      await postToThread(channelId, messageTs, `*Researching...*\n_Topic: ${requestText}_`, undefined, teamId);

      const [task] = await createTask({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs, type: "research", request: requestText });
      await inngest.send({ name: "slack/research.requested", data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, taskId: task.id, teamId } });
      return NextResponse.json({ ok: true });
    }

    if (classification.type === "analytics") {
      try { await addReaction(channelId, messageTs, "chart_with_upwards_trend", teamId); } catch { /* ok */ }
      await postToThread(channelId, messageTs, `*Analyzing data...*\n_Request: ${requestText}_`, undefined, teamId);

      const [task] = await createTask({ slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs, type: "analytics", request: requestText });
      await inngest.send({ name: "slack/analytics.requested", data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, taskId: task.id, teamId } });
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error("[EVENTS] Error:", error);
    await postToThread(channelId, messageTs, "Something went wrong processing your request. Please try again.", undefined, teamId).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
