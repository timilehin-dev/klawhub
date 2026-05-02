import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { createRun, getRecentRuns } from "@/lib/db";
import { createTask, getRecentTasks } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { runs, tasks } from "@/lib/db/schema";

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
        text: `*Klawhub — Your AI Coworker*\n\nUsage: \`/klawhub [your request]\`\n\nExamples:\n• \`/klawhub build a python script that fetches crypto prices\`\n• \`/klawhub create a Q4 revenue report in PDF\`\n• \`/klawhub research the latest trends in AI startups\`\n• \`/klawhub analyze this sales data and show me trends\`\n• \`/klawhub status\` — view recent activity`,
      });
    }

    // Validate input length
    if (text.length > 4000) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "⚠️ Request too long. Keep it under 4000 characters.",
      });
    }

    if (text.toLowerCase().startsWith("status")) {
      return handleStatus(userId);
    }

    // Create a generic task — the classifier will route it properly
    // But since slash commands skip the classifier, we detect intent from keywords
    const intent = detectIntent(text);

    if (intent === "build") {
      const [run] = await createRun({
        slackUserId: userId,
        slackChannelId: channelId,
        request: text,
      });

      await inngest.send({
        name: "slack/build.requested",
        data: {
          slackChannelId: channelId,
          slackThreadTs: undefined,
          slackUserId: userId,
          messageText: text,
          runId: run.id,
        },
      });

      // Use response_url to post a threaded message if available
      if (responseUrl) {
        await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `⚙️ *Build Squad activated!*\n_Request: ${text}_\n\nPM Agent is analyzing...`,
          }),
        }).catch(() => {});
      }

      return NextResponse.json({
        response_type: "ephemeral",
        text: `🚀 Build Squad activated!\n_Request: ${text}_\n\nI'll post updates in this channel.`,
      });
    }

    // For document, research, analytics — create a task
    const taskType = intent === "document" ? "document" : intent === "research" ? "research" : "analytics";
    const eventName = `slack/${taskType}.requested` as const;

    const [task] = await createTask({
      slackUserId: userId,
      slackChannelId: channelId,
      type: taskType as "document" | "research" | "analytics",
      request: text,
    });

    await inngest.send({
      name: eventName,
      data: {
        slackChannelId: channelId,
        slackThreadTs: undefined,
        slackUserId: userId,
        messageText: text,
        taskId: task.id,
      },
    });

    const emoji = intent === "document" ? "📄" : intent === "research" ? "🔍" : "📊";
    const label = intent === "document" ? "Generating document" : intent === "research" ? "Researching" : "Analyzing data";

    return NextResponse.json({
      response_type: "ephemeral",
      text: `${emoji} ${label}...\n_Request: ${text}_\n\nI'll post results in this channel.`,
    });
  }

  // ── /klawhub-status ──
  if (command === "/klawhub-status") {
    return handleStatus(userId);
  }

  return NextResponse.json({ ok: true });
}

function handleStatus(userId: string): Promise<NextResponse> {
  return getRecentRuns(userId, 3)
    .then((r) => getRecentTasks(userId, 3).then((t) => ({ runs: r, tasks: t })))
    .then(({ runs: runList, tasks: taskList }) => {
      const lines: string[] = [];

      for (const r of runList) {
        const icon = r.status === "done" ? "✅" : r.status === "error" ? "⚠️" : "⏳";
        lines.push(`${icon} [BUILD] ${r.request.slice(0, 40)} — ${r.status}`);
      }
      for (const t of taskList) {
        const icon = t.status === "done" ? "✅" : t.status === "error" ? "⚠️" : "⏳";
        lines.push(`${icon} [${t.type.toUpperCase()}] ${t.request.slice(0, 40)} — ${t.status}`);
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
    });
}

function detectIntent(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(build|create an? app|script|tool|automation|code|program|function|bot|api)\b/.test(lower)) {
    return "build";
  }
  if (/\b(document|report|proposal|invoice|contract|letter|resume|pdf|docx|write\s+a)\b/.test(lower)) {
    return "document";
  }
  if (/\b(research|investigate|find|search|look into|compare|analyze\s+market|competitor)\b/.test(lower)) {
    return "research";
  }
  if (/\b(analy[sz]e|chart|graph|data|statistics|metrics|kpi|trend|visuali[zs]e|dashboard)\b/.test(lower)) {
    return "analytics";
  }
  return "build"; // default to build for backwards compatibility
}
