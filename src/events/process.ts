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

import { postToThread, addReaction, getCachedWorkspaceId, getChannelName, downloadSlackFile } from "@/integrations/slack/client";
import { sandbox } from "@/core/tools/sandbox";
import { classify } from "@/core/agents/classifier";
import { chatAsAgent } from "@/core/agents/general";
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
} from "@/db";
import { memoryWrite } from "@/core/tools/memory";
import { parseScheduleRequest } from "@/core/tools/schedule-parser";
import { inngest } from "@/workflows/client";
import { extractAndStoreKnowledge } from "@/core/tools/knowledge-extractor";
import { ensureMember, ensureWorkspaceExists, checkUsageLimit } from "@/integrations/slack/workspace";
import { getThreadHistory, buildFollowupContext } from "@/utils/thread-context";
import { updateSessionSummary } from "@/core/memory/thread-summary";
import { matchSkill } from "@/core/skills/loader";
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
  files?: any[];
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
  const _t0 = Date.now();

  // ── Instant acknowledgment — fire reaction BEFORE any DB/API calls ──
  const channelId = event.channel as string;
  const messageTs = event.ts as string;
  const userId = event.user as string;
  const threadTs = event.thread_ts as string | undefined;

  // NOTE: The addReaction is now also done in the Inngest message-handler step,
  // but we keep this as a best-effort fallback for when processSlackEvent is called directly.
  addReaction(channelId, messageTs, "eyes", teamId).catch(() => { });

  // Periodic cleanup (~1% chance per event — amortized, non-blocking)
  if (Math.random() < 0.01) {
    cleanupOldEvents().catch(() => { });
  }

  // Track workspace member + ensure workspace exists (fire-and-forget, non-critical)
  ensureMember(userId, teamId).catch((err) => console.error("[EVENTS] Failed to ensure member/workspace:", err));
  ensureWorkspaceExists(teamId).catch((err) => console.error("[EVENTS] Failed to ensure member/workspace:", err));

  const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  const hasFiles = !!(event.files && event.files.length > 0);
  let fileTextContext = "";
  if (!text && !hasFiles) return;
  console.log(`[PERF] processSlackEvent setup: ${Date.now() - _t0}ms`);

  const isMention = event.type === "app_mention";
  const isDM = event.type === "message" && event.channel_type === "im";
  const isThreadReply = !!(threadTs && threadTs !== messageTs);

  // ── Ignore messages from bots (including self) to prevent loops ──
  if (event.subtype === "bot_message" || event.bot_id) {
    return;
  }

  const matchedSkill = matchSkill(text);
  if (matchedSkill) {
    console.log(`[EVENTS] Skill matched: ${matchedSkill.name} for text: "${text.slice(0, 50)}..."`);
  }

  let isPassiveListen = false;
  if (!isMention && !isDM && !isThreadReply && channelId) {
    // Optimization: Only lookup channel name if we have a reason to (e.g. skill matched or proactive check)
    // For now, we always check if a skill matched. If NOT, we skip the lookup unless we want to support keyword-based proactive channels.
    if (!matchedSkill) {
       // In the future, check a local cache of proactive channel IDs here.
       return; 
    }

    const channelName = await getChannelName(channelId, teamId);
    if (channelName) {
      const isProactiveChannel = /klawhub-invoice|klawhub-finance|klawhub-legal/i.test(channelName);
      if (isProactiveChannel && event.subtype !== "bot_message") {
        isPassiveListen = true;
      }
    }
  }

  // ── Passive Listening: Suggest help if a skill matches in a regular channel ──
  if (!isMention && !isDM && !isThreadReply && !isPassiveListen) {
    if (matchedSkill && event.subtype !== "bot_message") {
      try {
        console.log(`[EVENTS] Posting proactive suggestion for skill: ${matchedSkill.name}`);
        await addReaction(channelId, messageTs, "bulb", teamId);
        const suggestion = `I noticed you're discussing *${matchedSkill.name}*. Would you like me to help with that? 
_I can start this task for you right now._`;
        await postToThread(channelId, messageTs, suggestion, undefined, teamId);
      } catch (e) {
        console.warn("[LISTENING] Failed to post suggestion:", e);
      }
    }
    return;
  }

  // Resolve workspaceId — try cache first (populated by addReaction's getWorkspaceSlack call)
  // Falls back to DB lookup only if cache miss
  const _t1 = Date.now();
  let workspaceId = getCachedWorkspaceId(teamId);
  if (!workspaceId && teamId) {
    try {
      const ws = await getWorkspaceByTeamId(teamId);
      workspaceId = ws?.[0]?.id;
    } catch { /* non-critical */ }
  }
  console.log(`[PERF] workspaceId resolve (cache=${!!workspaceId || !teamId}): ${Date.now() - _t1}ms`);

  // Handle file downloading and parsing proactively if we are passive listening and files exist

  if (hasFiles && event.files) {
    const file = event.files[0];
    const allowedExtensions = [".pdf", ".docx", ".txt", ".csv", ".json", ".xml", ".yaml", ".yml", ".md"];
    const ext = "." + (file.name || "").split(".").pop()?.toLowerCase();

    if (allowedExtensions.includes(ext)) {
      try {
        await addReaction(channelId, messageTs, "hourglass", teamId);
        await postToThread(channelId, messageTs,
          `:mag: *Klawhub:* I detected an uploaded document (\`${file.name}\`). Running secure ephemeral parsing inside the isolated sandbox...`,
          undefined, teamId
        );

        const fileBuffer = await downloadSlackFile(file.url_private, teamId);
        const fileB64 = fileBuffer.toString("base64");

        const result = await sandbox({
          type: "parse_document",
          file: fileB64,
          filename: file.name || "document.pdf",
        });

        if (result.success && result.text) {
          fileTextContext = `[Uploaded File: ${file.name}]\nExtracted Content:\n${result.text}`;
          await postToThread(channelId, messageTs,
            `:white_check_mark: Secure parsing complete! Document context loaded.`,
            undefined, teamId
          );
        }
      } catch (err) {
        console.error("[FILE_PROCESSING] Error downloading or parsing file:", err);

      }
    }
  }

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
      isPassiveListen, fileTextContext,
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
  console.log(`[PERF] processSlackEvent total: ${Date.now() - _t0}ms`);
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

  // ── 1. Approve/reject fast path — skip thread history fetch (saves 300-800ms) ──
  const isApproval = APPROVAL_PATTERNS.some((p) => p.test(text));
  const isRejection = REJECTION_PATTERNS.some((p) => p.test(text));

  if (isApproval || isRejection) {
    const decision = isApproval ? "approved" : "rejected";

    // Parallel DB lookups (saves 100-400ms vs sequential)
    const [threadRun, threadTask] = await Promise.all([
      getRunByThreadTs(threadTs).catch(() => null),
      getTaskByThreadTs(threadTs).catch(() => null),
    ]);

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

  // Fetch thread history + check active/completed runs in parallel (saves 300-800ms)
  const _t3 = Date.now();
  const [threadHistory, activeRun, existingRun] = await Promise.all([
    getThreadHistory(channelId, threadTs, teamId),
    getActiveRunByThreadTs(threadTs).catch(() => null),
    getRunByThreadTs(threadTs).catch(() => null),
  ]);
  console.log(`[PERF] thread context fetch: ${Date.now() - _t3}ms`);

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

  // ── Classify thread reply to prevent casual chat from reactivating tasks ──
  const RUN_CONTROL_PATTERNS = [
    /^\s*(retry|re-run|re-execute|try again|run again|go again|execute again)\s*$/i,
    /\b(fix|bug|error|fail|issue|modify|change|update|add|remove|refactor)\b/i
  ];

  const classification = await classify(text, threadHistory);
  const isControlSignal = RUN_CONTROL_PATTERNS.some((p) => p.test(text));

  if (classification.type === "chat" && !isControlSignal) {
    try { await addReaction(channelId, messageTs, "speech_balloon", teamId); } catch { /* ok */ }
    const responseText = await chatAsAgent(userId, text, { workspaceId, threadHistory, slackChannelId: channelId, slackThreadTs: threadTs, slackTeamId: teamId });
    memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction", workspaceId).catch(() => { });
    extractAndStoreKnowledge(userId, text).catch(() => { });
    updateSessionSummary(userId, text, responseText).catch(() => { });
    await postToThread(channelId, messageTs, responseText, undefined, teamId);
    return;
  }

  // ── 2. Follow-up on completed/failed runs (existingRun already fetched above) ──
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

      memoryWrite(userId, `Build follow-up: ${text.slice(0, 100)}`, "preference", workspaceId).catch(() => { });
      return;
    }
  }

  // ── 3. Follow-up on completed/failed tasks (existingRun already fetched above) ──
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

      memoryWrite(userId, `${task.type} follow-up: ${text.slice(0, 100)}`, "preference", workspaceId).catch(() => { });
      return;
    }
  }

  // ── 4. Fast-path Skill Routing ──
  const matchedSkill = matchSkill(text);
  if (matchedSkill) {
    try { await addReaction(channelId, messageTs, "zap", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Executing Skill: ${matchedSkill.name}...*`, undefined, teamId);

    const skillCtx = {
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: threadTs,
      workspaceId, teamId
    };

    try {
      const result = await matchedSkill.execute(text, skillCtx);
      await postToThread(channelId, messageTs, result, undefined, teamId);
      await trackSkillUsage(matchedSkill.name, userId, channelId, text, "success").catch(() => { });
    } catch (err) {
      await postToThread(channelId, messageTs, `Skill failed: ${(err as Error).message}`, undefined, teamId);
      await trackSkillUsage(matchedSkill.name, userId, channelId, text, "error").catch(() => { });
    }
    return;
  }

  // ── 5. No existing run/task in thread — reuse classification from above ──

  if (classification.type === "chat") {
    const _t5 = Date.now();
    const responseText = await chatAsAgent(userId, text, { workspaceId, threadHistory, slackChannelId: channelId, slackThreadTs: threadTs || messageTs, slackTeamId: teamId });
    console.log(`[PERF] chatAsAgent (thread reply): ${Date.now() - _t5}ms`);
    memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction", workspaceId).catch(() => { });
    extractAndStoreKnowledge(userId, text).catch(() => { });
    updateSessionSummary(userId, text, responseText).catch(() => { });
    await postToThread(channelId, messageTs, responseText, undefined, teamId);
    return;
  }

  // Handle non-chat classifications in thread replies — dispatch as new tasks in SAME thread
  if (classification.type === "build") {
    try { await addReaction(channelId, messageTs, "gear", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Build Squad activated!*\n_Request: ${text}_\n\nPM Agent is analyzing...`, undefined, teamId);

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
  isPassiveListen?: boolean;
  fileTextContext?: string;
}): Promise<void> {
  const { userId, channelId, messageTs, text, teamId, workspaceId, isPassiveListen, fileTextContext } = ctx;

  if (isPassiveListen) {
    try { await addReaction(channelId, messageTs, "speech_balloon", teamId); } catch { /* ok */ }
    const prompt = `[PROACTIVE MONITORING COWORKER]
A file or message was posted in a monitored channel.
User message: "${text || "(No text message, file uploaded)"}"
${fileTextContext ? `Extracted Document Context:\n${fileTextContext}` : ""}

Please analyze this document/message proactively as a human coworker would.
1. Formulate helpful recommendations (e.g., draft email to client with invoice, summarize receipt/transaction, log expense, etc.).
2. Present clear, actionable next steps.
3. Be friendly, brief, conversational, and direct. Do NOT sound like a bot. Keep your response short and useful.`;

    const responseText = await chatAsAgent(userId, prompt, { workspaceId, slackChannelId: channelId, slackThreadTs: messageTs, slackTeamId: teamId });
    await postToThread(channelId, messageTs, responseText, undefined, teamId);
    return;
  }

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

  // Fast-path Skill Routing
  const matchedSkill = matchSkill(text);
  if (matchedSkill) {
    try { await addReaction(channelId, messageTs, "zap", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Executing Skill: ${matchedSkill.name}...*`, undefined, teamId);

    const skillCtx = {
      slackUserId: userId, slackChannelId: channelId, slackThreadTs: messageTs,
      workspaceId, teamId
    };

    try {
      const result = await matchedSkill.execute(text, skillCtx);
      await postToThread(channelId, messageTs, result, undefined, teamId);
      await trackSkillUsage(matchedSkill.name, userId, channelId, text, "success").catch(() => { });
    } catch (err) {
      await postToThread(channelId, messageTs, `Skill failed: ${(err as Error).message}`, undefined, teamId);
      await trackSkillUsage(matchedSkill.name, userId, channelId, text, "error").catch(() => { });
    }
    return;
  }

  // Classify intent
  const t0 = Date.now();
  const classification = await classify(text);
  console.log(`[PERF] classify('${text.slice(0, 40)}') → ${classification.type} in ${Date.now() - t0}ms`);

  // CHAT — general agent
  if (classification.type === "chat") {
    try { await addReaction(channelId, messageTs, "speech_balloon", teamId); } catch { /* ok */ }
    const t0 = Date.now();
    const responseText = await chatAsAgent(userId, text, { workspaceId, slackChannelId: channelId, slackThreadTs: messageTs, slackTeamId: teamId });
    const elapsed = Date.now() - t0;
    console.log(`[PERF] chatAsAgent completed in ${elapsed}ms`);
    memoryWrite(userId, `Chat: ${text.slice(0, 100)}`, "interaction", workspaceId).catch(() => { });
    extractAndStoreKnowledge(userId, text).catch(() => { });
    updateSessionSummary(userId, text, responseText).catch(() => { });
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
  }).catch(() => { });

  try {
    if (classification.type === "build") {
      await trackSkillUsage("build", userId, channelId, requestText, "attempted");
    } else if (["document", "research", "analytics"].includes(classification.type)) {
      await trackSkillUsage(classification.type as Intent, userId, channelId, requestText, "attempted");
    }
  } catch (err: unknown) {
    console.error("[EVENTS] trackSkillUsage failed:", err instanceof Error ? err.message : err);
  }

  // ── Smart Dispatch: Multi-intent requests go to Agent Coordination ──
  const isMultiIntent = (text.match(/(build|create|write|generate|make|code|develop|implement|script)/i) &&
    text.match(/(research|investigate|find|look\s+into|explore|study|analyze)/i)) ||
    text.length > 300;

  if (isMultiIntent) {
    try { await addReaction(channelId, messageTs, "robot_face", teamId); } catch { /* ok */ }
    await postToThread(channelId, messageTs, `*Multi-Agent Coordination activated!*\n_Synthesizing a complete solution for your request..._`, undefined, teamId);

    const responseText = await chatAsAgent(userId, text, { workspaceId, slackChannelId: channelId, slackThreadTs: messageTs, slackTeamId: teamId });
    await postToThread(channelId, messageTs, responseText, undefined, teamId);
    return;
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
