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
} from "@/lib/db";
import { memoryForget } from "@/lib/tools/memory";
import { inngest } from "@/lib/inngest/client";

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
• \`/klawhub analyze this sales data and show me trends\`\n\n*Commands:*
• \`/klawhub help\` — show all commands
• \`/klawhub status\` — view recent activity & skill stats
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

    // Chat and unclear — respond directly
    if (classification.type === "chat") {
      return NextResponse.json({
        response_type: "in_channel",
        text: classification.response || "",
      });
    }

    if (classification.type === "unclear") {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `Could you clarify? ${classification.question || "What do you need?"}`,
      });
    }

    const requestText = classification.extractedRequest || text;

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
        },
      });
    } else {
      const taskType = classification.type as "document" | "research" | "analytics";
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
        },
      });
    }

    return NextResponse.json({
      response_type: "ephemeral",
      text: `Got it! Processing your request. Updates will appear in this channel.`,
    });
  }

  // ── /klawhub-status ──
  if (command === "/klawhub-status") {
    return handleStatus(userId);
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

\`/klawhub [request]\` — Your universal command. I'll figure out what you need.
\`/klawhub status\` — View recent activity and your skill usage stats.
\`/klawhub history\` — View your recent requests across all skills.
\`/klawhub forget\` — Clear all your stored context and start fresh.
\`/klawhub help\` — Show this message.

*What I can do:*
:gear: **Build** — Scripts, tools, apps, automations (Python & JavaScript)
:page_facing_up: **Document** — Reports, proposals, invoices, contracts (PDF & DOCX)
:mag: **Research** — Web research with cited sources and deep analysis
:chart_with_upwards_trend: **Analytics** — Data analysis, charts, visualizations

*Tips:*
• Mention me with @Klawhub in any channel to activate me
• Reply in a thread with "revise", "change", or "try again" to follow up
• Use the global shortcut (Ctrl+K) to open the request modal`,
  });
}

async function handleStatus(userId: string): Promise<NextResponse> {
  try {
    const [runList, taskList, skillStats, memStats] = await Promise.all([
      getRecentRuns(userId, 3),
      getRecentTasks(userId, 3),
      getUserSkillStats(userId).catch(() => []),
      getMemoryStats(userId).catch(() => []),
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
