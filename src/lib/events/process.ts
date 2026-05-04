/**
 * Async event processor — handles all Slack event processing outside the HTTP response.
 *
 * This module is the heart of Phase A: it ensures the HTTP handler returns 200 OK
 * within milliseconds, while all LLM calls, DB lookups, and Slack API calls happen
 * asynchronously in the background.
 *
 * Architecture:
 *   POST /api/slack/events
 *     → verify signature (~1ms)
 *     → quick filters (bot_id, empty text, event type) (~0ms)
 *     → DB dedup claim (~50ms)
 *     → return 200 OK
 *     → processSlackEvent() runs in background (fire-and-forget)
 */

import { postToThread, addReaction } from "@/lib/slack/client";
import { classify } from "@/lib/agents/classifier";
import { chatAsAgent } from "@/lib/agents/general";
import {
  createRun,
  createTask,
  getRunByThreadTs,
  getTaskByThreadTs,
  getActiveRunByThreadTs,
  getActiveTaskByThreadTs,
  getUserScheduleCount,
  createSchedule,
  trackSkillUsage,
  getWorkspaceByTeamId,
} from "@/lib/db";
import { memoryWrite } from "@/lib/tools/memory";
import { parseScheduleRequest } from "@/lib/tools/schedule-parser";
import { inngest } from "@/lib/inngest/client";
import { extractAndStoreKnowledge } from "@/lib/tools/knowledge-extractor";
import { ensureMember, ensureWorkspaceExists, checkUsageLimit } from "@/lib/slack/workspace";
import { getThreadHistory, buildFollowupContext } from "@/lib/utils/thread-context";
import { cleanupOldEvents } from "./dedup";
import type { Intent } from "@/types";

// ── Types ──

export interface SlackEvent {
  type: string;
  text?: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
}

export interface ProcessEventInput {
  event: SlackEvent;
  eventId: string;
  teamId?: string;
}

// ── Constants ──

const APPROVAL_PATTERNS = [
  /^\s*(approve|yes|ok|go ahead|looks good|proceed|accepted|ship it|do it|lgtm)\s*$/i,
  /^\s*\+1\s*$/,
];

const REJECTION_PATTERNS = [
  /^\s*(reject|no|cancel|stop|don't|do not|decline|nay)\s*$/i,
];

const SCHEDULE_PATTERNS = [
  /\b(schedul|remind|cron|recurring|every|daily|weekly|monthly)\b/i,
  /\b(set up|create|add)\s+(a\s+)?(schedul|remind|cron|alert)/i,
];

// ── Main Entry Point ──

export async function processSlackEvent(input: ProcessEventInput): Promise<void> {
  const { event, teamId } = input;

  // Periodic cleanup (~1% chance per event — amortized, non-blocking)
  if (Math.random() < 0.01) {
    cleanupOldEvents().catch(() => {});
  }

  // Track workspace member + ensure workspace exists (fire-and-forget, non-critical)
  const userId = event.user as string;
  ensureMember(userId, teamId).catch(() => {});
  ensureWorkspaceExists(teamId).catch(() => {});

  const channelId = event.channel as string;
  const threadTs = event.thread_ts as string | undefined;
  const messageTs = event.ts as string;
  const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  if (!text) return;

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  const isThreadReply = !!(threadTs && threadTs !== messageTs);

  if (!isMention && !isDM && !isThreadReply) return;

  // Resolve workspaceId for integration tools (non-critical)
  let workspaceId: string | undefined;
  try {
    if (teamId) {
      const ws = await getWorkspaceByTeamId(teamId);
      if (ws && ws.length > 0) workspaceId = ws[0].id;
    }
  } catch { /* non-critical */ }

  // Immediate reaction so user sees the bot is alive
  addReaction(channelId, messageTs, "eyes", teamId).catch(() => {});

  try {
    // ══════════════════════════════════════════════════
    // THREAD REPLY HANDLING — full context-aware dispatch
    // ══════════════════════════════════════════════════
    if (isThreadReply && !isMention) {
      await handleThreadReply({
        userId, channelId, threadTs, messageTs, text, teamId, workspaceId,
      });
      return;
    }

    // ══════════════════════════════════════════════════
    // NEW THREAD / DM — full classification pipeline
    // ══════════════════════════════════════════════════
    await handleNewThreadOrDM({
      userId, channelId, messageTs, text, teamId, workspaceId, isMention, isDM,
    });
  } catch (error) {
    console.error("[EVENTS] Processing error:", error);
    try {
      await postToThread(
        channelId, messageTs,
        "Something went wrong processing your request. Please try again.",
        undefined, teamId
      );
    } catch { /* give up */ }
  }
}

// ── Thread Reply Handler ──

async function handleThreadReply(ctx: {
  userId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  text: string;
  teamId?: string;
  workspaceId?: string;
}): Promise<void> {
  const { userId, channelId, threadTs, messageTs, text, teamId, workspaceId } = ctx;

  // Fetch thread history for context (includes bot messages now)
  const threadHistory = await getThreadHistory(channelId, threadTs, teamId);

  // ── 1. Approve/reject of pending builds/tasks ──
  const isApproval = APPROVAL_PATTERNS.some((p) => p.test(text));
  const isRejection = REJECTION_PATTERNS.some((p) => p.test(text));

  if (isApproval || isRejection) {
    const decision = isApproval ? "approved" : "rejected";

    const threadRun = await getRunByThreadTs(threadTs).catch(() => null);
    if (threadRun && threadRun.length > 0 && threadRun[0].status === "pending_approval") {
      const pendingRun = threadRun[0];
      await inngest.send({
        name: `app/build.approval/${pendingRun.id}`,
        data: { referenceId: pendingRun.id, decision, userId },
      });
      await postToThread(channelId, messageTs,
        `:${isApproval ? "white_check_mark" : "x"}: *${decision === "approved" ? "Approved" : "Rejected"}* by <@${userId}>. ${isApproval ? "Engineer Agent is now coding..." : "Build cancelled."}`,
        undefined, teamId);
      return;
    }

    const threadTask = await getTaskByThreadTs(threadTs).catch(() => null);
    if (threadTask && threadTask.length > 0 && threadTask[0].status === "pending_approval") {
      const pendingTask = threadTask[0];
      await inngest.send({
        name: `app/doc.approval/${pendingTask.id}`,
        data: { referenceId: pendingTask.id, decision, userId },
      });
      await postToThread(channelId, messageTs,
        `:${isApproval ? "white_check_mark" : "x"}: *${decision === "approved" ? "Approved" : "Rejected"}* by <@${userId}>. ${isApproval ? "Generating full document..." : "Document generation cancelled."}`,
        undefined, teamId);
      return;
    }
  }

  // ── 2. In-progress guard — prevent duplicate builds/tasks ──
  const activeRun = await getActiveRunByThreadTs(threadTs).catch(() => null);
  const activeTask = !activeRun
    ? await getActiveTaskByThreadTs(threadTs).catch(() => null)
    : null;

  if ((activeRun && activeRun.length > 0) || (activeTask && activeTask.length > 0)) {
    const status = activeRun?.[0]?.status || activeTask?.[0]?.status || "processing";
    const type = activeRun ? "build" : "task";
    const statusMessages: Record<string, string> = {
      pending: "being queued",
      pm: "in the PM phase (analyzing requirements)",
      coding: "in the Engineering phase (writing code)",
      qa: "in the QA phase (testing code)",
      pending_approval: "waiting for approval",
      processing: "being processed",
    };
    const detail = statusMessages[status] || status;

    await postToThread(channelId, messageTs,
      `:hourglass: A ${type} is already ${detail}. Your request will be handled after it completes.`,
      undefined, teamId);
    return;
  }

  // ── 3. Follow-up on completed/failed runs or tasks ──
  const existingRun = await getRunByThreadTs(threadTs).catch(() => null);
  if (existingRun && existingRun.length > 0) {
    const run = existingRun[0];
    if ((run.status === "done" || run.status === "error") && run.slackThreadTs === threadTs) {
      try { await addReaction(channelId, messageTs, "gear", teamId); } catch { /* ok */ }

      const followupCtx = buildFollowupContext(
        run.request,
        {
          spec: run.pmSpec || undefined,
          evaluation: typeof run.finalOutput === "string" ? run.finalOutput : undefined,
          error: run.testResult && !run.testResult.passed ? (run.testResult.error || run.finalOutput || "Build failed QA") : undefined,
        },
        threadHistory
      );

      await postToThread(channelId, messageTs, "*Build Squad re-activated!*\n_Reviewing previous context..._", undefined, teamId);

      const fullRequest = threadHistory
        ? `${text}\n\n[You are continuing a previous build. Here is the context:]\n${followupCtx}`
        : `${text}\n\n[Context from previous build: ${run.request.slice(0, 500)}${run.pmSpec ? `\n\nPrevious spec:\n${run.pmSpec.slice(0, 500)}` : ""}${run.code ? `\n\nPrevious code:\n${run.code.slice(0, 500)}` : ""}]`;

      const [newRun] = await createRun({
        slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs,
        request: fullRequest, workspaceId,
      });

      await inngest.send({
        name: "slack/build.requested",
        data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: text, runId: newRun.id, teamId },
      });

      await memoryWrite(userId, `Build follow-up: ${text.slice(0, 100)}`, "preference", workspaceId);
      return;
    }
  }

  const existingTask = await getTaskByThreadTs(threadTs).catch(() => null);
  if (existingTask && existingTask.length > 0) {
    const task = existingTask[0];
    if ((task.status === "done" || task.status === "error") && task.slackThreadTs === threadTs) {
      const taskEmojis: Record<string, string> = { document: "page_facing_up", research: "mag", analytics: "chart_with_upwards_trend" };
      try { await addReaction(channelId, messageTs, taskEmojis[task.type] || "speech_balloon", teamId); } catch { /* ok */ }

      const fullRequest = threadHistory
        ? `${text}\n\n[You are continuing a previous ${task.type} task. Thread conversation:\n${threadHistory}]`
        : `${text}\n\n[Context from previous ${task.type} task: ${task.request.slice(0, 500)}]`;

      const [newTask] = await createTask({
        slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs,
        type: task.type, request: fullRequest, workspaceId,
      });

      await inngest.send({
        name: `slack/${task.type}.requested`,
        data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: text, taskId: newTask.id, teamId },
      });

      await memoryWrite(userId, `${task.type} follow-up: ${text.slice(0, 100)}`, "preference", workspaceId);
      return;
    }
  }

  // ── 4. No existing run/task in thread — classify the reply ──
  const classification = await classify(text);

  if (classification.type === "chat") {
    const responseText = await chatAsAgent(userId, text, { workspaceId, threadHistory });
    await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction", workspaceId);
    await postToThread(channelId, messageTs, responseText, undefined, teamId);
    return;
  }

  // Handle non-chat classifications in thread replies — dispatch as new tasks in SAME thread
  if (classification.type === "build") {
    try { await addReaction(channelId, messageTs, "gear", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, "*Build Squad activated!*\n_Request: ${text}_\n\nPM Agent is analyzing...", undefined, teamId);

    const contextReq = threadHistory ? `${text}\n\n[Thread context:\n${threadHistory}]` : text;

    const [newRun] = await createRun({
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs,
      request: contextReq, workspaceId,
    });
    await inngest.send({
      name: "slack/build.requested",
      data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: text, runId: newRun.id, teamId },
    });
    return;
  }

  if (["document", "research", "analytics"].includes(classification.type)) {
    const taskType = classification.type as "document" | "research" | "analytics";
    const taskEmojis: Record<string, string> = { document: "page_facing_up", research: "mag", analytics: "chart_with_upwards_trend" };
    const taskLabels: Record<string, string> = { document: "Generating document", research: "Researching", analytics: "Analyzing data" };
    try { await addReaction(channelId, messageTs, taskEmojis[taskType] || "speech_balloon", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*${taskLabels[taskType]}...*\n_Request: ${text}_`, undefined, teamId);

    const contextReq = threadHistory ? `${text}\n\n[Thread context:\n${threadHistory}]` : text;

    const [newTask] = await createTask({
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs,
      type: taskType, request: contextReq, workspaceId,
    });
    await inngest.send({
      name: `slack/${taskType}.requested`,
      data: { slackChannelId: channelId, slackThreadTs: threadTs, slackUserId: userId, messageText: text, taskId: newTask.id, teamId },
    });
    return;
  }

  // UNCLEAR classification — ask for clarification
  await postToThread(channelId, messageTs, `:thinking: ${classification.question || "Could you clarify what you need?"}`, undefined, teamId);
}

// ── New Thread / DM Handler ──

async function handleNewThreadOrDM(ctx: {
  userId: string;
  channelId: string;
  messageTs: string;
  text: string;
  teamId?: string;
  workspaceId?: string;
  isMention: boolean;
  isDM: boolean;
}): Promise<void> {
  const { userId, channelId, messageTs, text, teamId, workspaceId } = ctx;

  // Schedule detection
  if (SCHEDULE_PATTERNS.some((p) => p.test(text))) {
    try {
      const parsed = await parseScheduleRequest(text);
      const count = await getUserScheduleCount(userId);
      if (count >= 10) {
        await postToThread(channelId, messageTs,
          ":warning: You have reached the maximum of 10 active schedules. Remove one with `/klawhub cancel-schedule` first.",
          undefined, teamId);
        return;
      }

      const [schedule] = await createSchedule({
        slackUserId: userId, slackTeamId: teamId, name: parsed.name, cronExpr: parsed.cronExpr,
        timezone: parsed.timezone, action: parsed.action, channelId,
      });

      await postToThread(channelId, messageTs,
        `:clock1: *Schedule created!*\n\n*${parsed.name}*\n${parsed.cronExpr} (${parsed.timezone})\nAction: ${parsed.action.slice(0, 100)}\n\nID: \`${schedule.id.slice(0, 8)}\`\nManage with \`/klawhub schedules\``,
        undefined, teamId);
      return;
    } catch {
      // Fall through to normal classification
    }
  }

  // Classify intent
  const classification = await classify(text);

  // CHAT — general agent
  if (classification.type === "chat") {
    try { await addReaction(channelId, messageTs, "speech_balloon", teamId); } catch { /* ok */ }
    const responseText = await chatAsAgent(userId, text, { workspaceId });
    await memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction", workspaceId);
    extractAndStoreKnowledge(userId, text).then((stored) => {
      if (stored > 0) console.log(`[EVENTS] Chat knowledge: stored ${stored} entities for ${userId}`);
    }).catch(() => {});
    await postToThread(channelId, messageTs, responseText, undefined, teamId);
    return;
  }

  // UNCLEAR
  if (classification.type === "unclear") {
    await postToThread(channelId, messageTs, `:thinking: ${classification.question || "Could you clarify what you need?"}`, undefined, teamId);
    return;
  }

  // ── Task dispatches ──
  const requestText = classification.extractedRequest || text;

  // Usage limit check
  const limitCheck = await checkUsageLimit(teamId);
  if (limitCheck && !limitCheck.allowed) {
    await postToThread(channelId, messageTs,
      `:warning: *Usage limit reached.*\nYou've used ${limitCheck.used}/${limitCheck.limit} agent runs this month. Upgrade your plan at https://klawhub.com/pricing to get more runs.`,
      undefined, teamId);
    return;
  }

  extractAndStoreKnowledge(userId, text).then((stored) => {
    if (stored > 0) console.log(`[EVENTS] Knowledge: stored ${stored} entities for ${userId}`);
  }).catch(() => {});

  try {
    if (classification.type === "build") {
      await trackSkillUsage("build", userId, channelId, requestText, "attempted");
    } else if (["document", "research", "analytics"].includes(classification.type)) {
      await trackSkillUsage(classification.type as Intent, userId, channelId, requestText, "attempted");
    }
  } catch (err: unknown) {
    console.error("[EVENTS] trackSkillUsage failed:", err instanceof Error ? err.message : err);
  }

  if (classification.type === "build") {
    try { await addReaction(channelId, messageTs, "gear", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Build Squad activated!*\n_Request: ${requestText}_\n\nPM Agent is analyzing...`, undefined, teamId);

    const [run] = await createRun({
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs,
      request: requestText, workspaceId,
    });
    await inngest.send({
      name: "slack/build.requested",
      data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, runId: run.id, teamId },
    });
    return;
  }

  if (classification.type === "document") {
    try { await addReaction(channelId, messageTs, "page_facing_up", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Generating document...*\n_Request: ${requestText}_`, undefined, teamId);

    const [task] = await createTask({
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs,
      type: "document", request: requestText, workspaceId,
    });
    await inngest.send({
      name: "slack/document.requested",
      data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, taskId: task.id, teamId },
    });
    return;
  }

  if (classification.type === "research") {
    try { await addReaction(channelId, messageTs, "mag", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Researching...*\n_Topic: ${requestText}_`, undefined, teamId);

    const [task] = await createTask({
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs,
      type: "research", request: requestText, workspaceId,
    });
    await inngest.send({
      name: "slack/research.requested",
      data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, taskId: task.id, teamId },
    });
    return;
  }

  if (classification.type === "analytics") {
    try { await addReaction(channelId, messageTs, "chart_with_upwards_trend", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Analyzing data...*\n_Request: ${requestText}_`, undefined, teamId);

    const [task] = await createTask({
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs,
      type: "analytics", request: requestText, workspaceId,
    });
    await inngest.send({
      name: "slack/analytics.requested",
      data: { slackChannelId: channelId, slackThreadTs: messageTs, slackUserId: userId, messageText: requestText, taskId: task.id, teamId },
    });
    return;
  }
}
