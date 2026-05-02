import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { classify } from "@/lib/agents/classifier";
import { createRun, createTask, getRecentRuns, getRecentTasks } from "@/lib/db";
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
        text: `*Klawhub — Your AI Coworker*\n\nUsage: \`/klawhub [your request]\`\n\nExamples:\n• \`/klawhub build a python script that fetches crypto prices\`\n• \`/klawhub create a Q4 revenue report in PDF\`\n• \`/klawhub research the latest trends in AI startups\`\n• \`/klawhub analyze this sales data and show me trends\`\n• \`/klawhub status\` — view recent activity`,
      });
    }

    if (text.length > 4000) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Request too long. Keep it under 4000 characters.",
      });
    }

    if (text.toLowerCase().startsWith("status")) {
      return handleStatus(userId);
    }

    // Use the LLM classifier for intent routing (same as mentions)
    let classification;
    try {
      classification = await classify(text);
    } catch (err) {
      console.error("[COMMANDS] Classification failed:", err);
      // Fallback to chat response
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

function handleStatus(userId: string): Promise<NextResponse> {
  return getRecentRuns(userId, 3)
    .then((r) => getRecentTasks(userId, 3).then((t) => ({ runs: r, tasks: t })))
    .then(({ runs: runList, tasks: taskList }) => {
      const lines: string[] = [];

      for (const r of runList) {
        const icon = r.status === "done" ? "white_check_mark" : r.status === "error" ? "warning" : "hourglass";
        lines.push(`:${icon}: [BUILD] ${r.request.slice(0, 40)} — ${r.status}`);
      }
      for (const t of taskList) {
        const icon = t.status === "done" ? "white_check_mark" : t.status === "error" ? "warning" : "hourglass";
        lines.push(`:${icon}: [${t.type.toUpperCase()}] ${t.request.slice(0, 40)} — ${t.status}`);
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
