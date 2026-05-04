import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { classify } from "@/lib/agents/classifier";
import {
  createRun,
  createTask,
  getRecentRuns,
  getRecentTasks,
  getUserSkillStats,
  getMemoryStats,
  getUserSchedules,
  getSchedule,
  deleteSchedule as dbDeleteSchedule,
  getUserScheduleCount,
  updateSchedule,
  trackSkillUsage,
} from "@/lib/db";
import { memoryForget } from "@/lib/tools/memory";
import { parseScheduleRequest } from "@/lib/tools/schedule-parser";
import { createSchedule } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { checkUsageLimit } from "@/lib/slack/workspace";

// Allow up to 60s for slash commands (classification may need LLM)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.text();

  if (!verifySlackRequest(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(body);
  const command = params.get("command");
  const text = (params.get("text") || "").trim();
  const userId = params.get("user_id");
  const channelId = params.get("channel_id");
  const responseUrl = params.get("response_url");
  const teamId = params.get("team_id") || undefined;

  if (!userId || !channelId) {
    return NextResponse.json({ ok: true });
  }

  // ── /klawhub [request] — universal command ──
  if (command === "/klawhub") {
    if (!text) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `*Klawhub — Your AI Coworker*\n\nUsage: \`/klawhub [your request]\`\n\n*Examples:*
• \`/klawhub build a python script that fetches crypto prices\`
• \`/klawhub create a Q4 revenue report in PDF\`
• \`/klawhub research the latest trends in AI startups\`
• \`/klawhub analyze this sales data and show me trends\`
• \`/klawhub schedule daily forex scan at 8am weekdays\`\n\n*Commands:*
• \`/klawhub help\` — show all commands
• \`/klawhub status\` — view recent activity & skill stats
• \`/klawhub schedules\` — view your active schedules
• \`/klawhub cancel-schedule [id]\` — remove a schedule
• \`/klawhub forget\` — clear your memory & start fresh`,
      });
    }

    if (text.length > 4000) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Request too long. Keep it under 4000 characters.",
      });
    }

    // ── Sub-commands ──
    const sub = text.toLowerCase();

    if (sub === "help") {
      return handleHelp();
    }

    if (sub === "status") {
      return handleStatus(userId);
    }

    if (sub === "forget") {
      return handleForget(userId);
    }

    if (sub === "history") {
      return handleHistory(userId);
    }

    if (sub === "schedules") {
      return handleListSchedules(userId);
    }

    // /klawhub cancel-schedule [id]
    if (sub.startsWith("cancel-schedule")) {
      const id = text.replace(/^cancel-schedule\s+/i, "").trim();
      return handleCancelSchedule(userId, id);
    }

    // ── Schedule creation ──
    if (/schedul|remind|cron|recurring|every|daily|weekly|monthly/i.test(sub)) {
      return handleCreateSchedule(userId, channelId, text, teamId);
    }

    // ── Classify and dispatch ──
    let classification;
    try {
      classification = await classify(text);
    } catch (err) {
      console.error("[COMMANDS] Classification failed:", err);
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Sorry, I couldn't process that request. Please try again.",
      });
    }

    // Chat — defer to Inngest via response_url (avoids Vercel timeout)
    if (classification.type === "chat") {
      if (responseUrl) {
        // Send to Inngest for deferred processing
        await inngest.send({
          name: "slack/command.chat",
          data: {
            userId,
            text: classification.response || text,
            responseUrl,
            teamId,
          },
        });
        return NextResponse.json({
          response_type: "ephemeral",
          text: ":speech_balloon: Thinking...",
        });
      }
      // Fallback: no response_url — return a brief message
      return NextResponse.json({
        response_type: "in_channel",
        text: "Please @mention me in a channel for a full response.",
      });
    }

    if (classification.type === "unclear") {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `Could you clarify? ${classification.question || "What do you need?"}`,
      });
    }

    const requestText = classification.extractedRequest || text;

    // Usage limit check before dispatching any task (matches events route behavior)
    const limitCheck = await checkUsageLimit(teamId);
    if (limitCheck && !limitCheck.allowed) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `:warning: *Usage limit reached.* You've used ${limitCheck.used}/${limitCheck.limit} agent runs this month. Upgrade your plan at https://klawhub.com/pricing to get more runs.`,
      });
    }

    // Post initial message via response_url to get a thread_ts
    let threadTs: string | undefined;

    if (responseUrl) {
      try {
        const emoji = classification.type === "build" ? "gear" : classification.type === "document" ? "page_facing_up" : classification.type === "research" ? "mag" : "chart_with_upwards_trend";
        const label = classification.type === "build" ? "Build Squad activated" : classification.type === "document" ? "Generating document" : classification.type === "research" ? "Researching" : "Analyzing data";

        const response = await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `:${emoji}: *${label}*...\n_Request: ${requestText}_`,
          }),
        });
        const responseData = await response.json();
        threadTs = responseData.ts;
      } catch {
        // If response_url fails, proceed without threading
      }
    }

    // Dispatch to appropriate workflow
    if (classification.type === "build") {
      // Track skill usage at dispatch (await to ensure DB write)
      try {
        await trackSkillUsage("build", userId, channelId, requestText, "attempted");
      } catch (err: unknown) {
        console.error("[COMMANDS] trackSkillUsage (build) failed:", err instanceof Error ? err.message : err);
      }

      const [run] = await createRun({
        slackUserId: userId,
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        request: requestText,
      });

      await inngest.send({
        name: "slack/build.requested",
        data: {
          slackChannelId: channelId,
          slackThreadTs: threadTs,
          slackUserId: userId,
          messageText: requestText,
          runId: run.id,
          teamId,
        },
      });
    } else {
      const taskType = classification.type as "document" | "research" | "analytics";
      // Track skill usage at dispatch (await to ensure DB write)
      try {
        await trackSkillUsage(taskType, userId, channelId, requestText, "attempted");
      } catch (err: unknown) {
        console.error("[COMMANDS] trackSkillUsage (task) failed:", err instanceof Error ? err.message : err);
      }

      const [task] = await createTask({
        slackUserId: userId,
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        type: taskType,
        request: requestText,
      });

      await inngest.send({
        name: `slack/${taskType}.requested`,
        data: {
          slackChannelId: channelId,
          slackThreadTs: threadTs,
          slackUserId: userId,
          messageText: requestText,
          taskId: task.id,
          teamId,
        },
      });
    }

    return NextResponse.json({
      response_type: "ephemeral",
      text: `Got it! Processing your request. Updates will appear in this channel.`,
    });
  }

  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────
// Command Handlers
// ─────────────────────────────────────────

function handleHelp(): NextResponse<unknown> {
  return NextResponse.json({
    response_type: "ephemeral",
    text: `*Klawhub — Commands*

\`/klawhub [request]\` — Universal command. I'll figure out what you need.
\`/klawhub schedule [description]\` — Set up a recurring schedule (e.g. "daily forex scan at 8am WAT")
\`/klawhub schedules\` — View your active schedules.
\`/klawhub cancel-schedule [id]\` — Cancel a schedule.
\`/klawhub status\` — View recent activity and skill usage stats.
\`/klawhub history\` — View your recent requests.
\`/klawhub forget\` — Clear all your stored context.
\`/klawhub help\` — Show this message.

*What I can do:*
:gear: *Build* — Scripts, tools, apps, automations (Python and JavaScript)
:page_facing_up: *Document* — Reports, proposals, invoices, contracts (PDF and DOCX)
:mag: *Research* — Web research with cited sources and deep analysis
:chart_with_upwards_trend: *Analytics* — Data analysis, charts, visualizations
:clock1: *Schedule* — Recurring tasks, reminders, automated reports

*Tips:*
• Mention me with @Klawhub in any channel to activate me
• Reply in threads with "revise", "change", or "try again" to follow up
• Say "schedule" or "remind me every..." to set up recurring tasks`,
  });
}

async function handleStatus(userId: string): Promise<NextResponse> {
  try {
    const [runList, taskList, skillStats, memStats, scheduleList] = await Promise.all([
      getRecentRuns(userId, 3),
      getRecentTasks(userId, 3),
      getUserSkillStats(userId).catch(() => []),
      getMemoryStats(userId).catch(() => []),
      getUserSchedules(userId).catch(() => []),
    ]);

    const lines: string[] = [];

    for (const r of runList) {
      const icon = r.status === "done" ? "white_check_mark" : r.status === "error" ? "warning" : "hourglass";
      lines.push(`:${icon}: [BUILD] ${r.request.slice(0, 40)} — ${r.status}`);
    }
    for (const t of taskList) {
      const icon = t.status === "done" ? "white_check_mark" : t.status === "error" ? "warning" : "hourglass";
      lines.push(`:${icon}: [${t.type.toUpperCase()}] ${t.request.slice(0, 40)} — ${t.status}`);
    }

    // Skill usage stats
    if (skillStats.length > 0) {
      lines.push("\n*Your skill usage:*");
      for (const s of skillStats) {
        lines.push(`  :bar_chart: ${String(s.skillName)} — ${s.count} uses`);
      }
    }

    // Memory stats
    if (memStats.length > 0) {
      lines.push("\n*Your memory:*");
      for (const m of memStats) {
        lines.push(`  :brain: ${String(m.category)} — ${m.count} entries`);
      }
    }

    // Active schedules
    const active = scheduleList.filter((s) => s.isActive);
    if (active.length > 0) {
      lines.push(`\n*Active schedules: ${active.length}*`);
      for (const s of active) {
        lines.push(`  :clock1: ${s.name} (${s.cronExpr})`);
      }
    }

    if (lines.length === 0) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "No recent activity. Use `/klawhub [request]` to get started.",
      });
    }

    return NextResponse.json({
      response_type: "ephemeral",
      text: `*Your recent activity:*\n\n${lines.join("\n")}`,
    });
  } catch {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Could not load status. Please try again.",
    });
  }
}

async function handleHistory(userId: string): Promise<NextResponse> {
  try {
    const [runList, taskList] = await Promise.all([
      getRecentRuns(userId, 10),
      getRecentTasks(userId, 10),
    ]);

    const lines: string[] = [];

    for (const r of runList) {
      const icon = r.status === "done" ? "white_check_mark" : r.status === "error" ? "warning" : "hourglass";
      const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "";
      lines.push(`:${icon}: [BUILD] ${r.request.slice(0, 50)} — ${r.status} (${date})`);
    }
    for (const t of taskList) {
      const icon = t.status === "done" ? "white_check_mark" : t.status === "error" ? "warning" : "hourglass";
      const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "";
      lines.push(`:${icon}: [${t.type.toUpperCase()}] ${t.request.slice(0, 50)} — ${t.status} (${date})`);
    }

    if (lines.length === 0) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "No history yet. Use `/klawhub [request]` to get started.",
      });
    }

    return NextResponse.json({
      response_type: "ephemeral",
      text: `*Your history:*\n\n${lines.join("\n")}`,
    });
  } catch {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Could not load history. Please try again.",
    });
  }
}

async function handleForget(userId: string): Promise<NextResponse> {
  try {
    const deleted = await memoryForget(userId);
    return NextResponse.json({
      response_type: "ephemeral",
      text: deleted > 0
        ? `:broom: Done! Cleared ${deleted} memory entries. I've forgotten everything about you — starting fresh.`
        : ":broom: You had no stored memory to clear.",
    });
  } catch {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Could not clear memory. Please try again.",
    });
  }
}

async function handleListSchedules(userId: string): Promise<NextResponse> {
  try {
    const list = await getUserSchedules(userId);
    if (list.length === 0) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "No schedules yet. Create one with:\n`/klawhub schedule daily standup at 9am`\n`/klawhub schedule weekly report every Friday at 5pm`",
      });
    }

    const lines = list.map((s) => {
      const status = s.isActive ? ":white_check_mark:" : ":pause_button:";
      return `${status} \`${s.id.slice(0, 8)}\` *${s.name}*\n  ${s.cronExpr} (${s.timezone}) — ${s.action.slice(0, 60)}`;
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: `*Your schedules (${list.length}/10):*\n\n${lines.join("\n\n")}\n\nCancel with: \`/klawhub cancel-schedule [id]\``,
    });
  } catch {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Could not load schedules. Please try again.",
    });
  }
}

async function handleCreateSchedule(userId: string, channelId: string, text: string, teamId?: string): Promise<NextResponse> {
  try {
    const count = await getUserScheduleCount(userId);
    if (count >= 10) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: ":warning: You've reached the maximum of 10 active schedules. Remove one with `/klawhub cancel-schedule [id]` first.",
      });
    }

    const parsed = await parseScheduleRequest(text);
    const [schedule] = await createSchedule({
      slackUserId: userId,
      slackTeamId: teamId,
      name: parsed.name,
      cronExpr: parsed.cronExpr,
      timezone: parsed.timezone,
      action: parsed.action,
      channelId,
    });

    return NextResponse.json({
      response_type: "in_channel",
      text: `:clock1: *Schedule created!*\n\n*${parsed.name}*\n\`${parsed.cronExpr}\` (${parsed.timezone})\n> ${parsed.action}\n\nID: \`${schedule.id.slice(0, 8)}\` — manage with \`/klawhub schedules\``,
    });
  } catch (err) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: `:warning: Could not parse schedule. Try a format like:\n• \`/klawhub schedule daily forex scan at 8am WAT weekdays\`\n• \`/klawhub schedule weekly report every Friday at 5pm\`\n\nError: ${(err as Error).message.slice(0, 100)}`,
    });
  }
}

async function handleCancelSchedule(userId: string, id: string): Promise<NextResponse> {
  if (!id) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Usage: `/klawhub cancel-schedule [id]`\nFind IDs with `/klawhub schedules`",
    });
  }

  try {
    const allSchedules = await getUserSchedules(userId, false);
    const match = allSchedules.find((s: { id: string }) => s.id.startsWith(id));
    if (!match) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `:warning: No schedule found with ID "${id}". Check \`/klawhub schedules\` for your active schedules.`,
      });
    }

    await dbDeleteSchedule(match.id);
    return NextResponse.json({
      response_type: "ephemeral",
      text: `:broom: Schedule *${match.name}* (\`${match.id.slice(0, 8)}\`) has been cancelled.`,
    });
  } catch {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Could not cancel schedule. Please try again.",
    });
  }
}
