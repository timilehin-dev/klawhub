import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { inngest } from "@/lib/inngest/client";
import { createRun, createTask } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.text();

  if (!verifySlackRequest(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, any>;

  try {
    const decoded = decodeURIComponent(body);
    payload = JSON.parse(decoded.replace(/^payload=/, ""));
  } catch {
    return NextResponse.json({ ok: true });
  }

  const type = payload.type as string;
  const user = payload.user as Record<string, string> | undefined;

  // Handle global shortcut — open modal
  if (type === "shortcut" && payload.callback_id === "klawhub_global_shortcut") {
    const triggerId = payload.trigger_id as string;
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken || !triggerId) return NextResponse.json({ ok: true });

    await fetch("https://slack.com/api/views.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger_id: triggerId,
        view: {
          type: "modal",
          callback_id: "klawhub_request_modal",
          title: { type: "plain_text", text: "Klawhub" },
          submit: { type: "plain_text", text: "Submit" },
          blocks: [
            {
              type: "input",
              block_id: "request_input",
              element: {
                type: "plain_text_input",
                action_id: "request_action",
                placeholder: { type: "plain_text", text: "What do you need? Build, document, research, or analyze..." },
                multiline: true,
              },
              label: { type: "plain_text", text: "Your Request" },
            },
            {
              type: "input",
              block_id: "task_type",
              element: {
                type: "static_select",
                action_id: "type_action",
                placeholder: { type: "plain_text", text: "Select type" },
                options: [
                  { text: { type: "plain_text", text: "🔧 Build" }, value: "build" },
                  { text: { type: "plain_text", text: "📄 Document" }, value: "document" },
                  { text: { type: "plain_text", text: "🔍 Research" }, value: "research" },
                  { text: { type: "plain_text", text: "📊 Analytics" }, value: "analytics" },
                ],
              },
              label: { type: "plain_text", text: "Task Type" },
            },
          ],
        },
      }),
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  }

  // Handle modal submission
  if (type === "view_submission" && payload.view) {
    const view = payload.view as Record<string, any>;
    const state = view.state as Record<string, any>;
    const values = state.values as Record<string, Record<string, any>>;
    const requestBlock = values.request_input?.request_action || {};
    const typeBlock = values.task_type?.type_action || {};
    const requestText = requestBlock.value || "";
    const taskType = typeBlock.selected_option?.value || "build";
    const userId = user?.id || "";

    if (!requestText.trim()) {
      return NextResponse.json({ response_action: "errors", errors: { request_input: "Please enter a request" } });
    }

    if (taskType === "build") {
      const [run] = await createRun({ slackUserId: userId, slackChannelId: "", request: requestText });
      await inngest.send({
        name: "slack/build.requested",
        data: { slackChannelId: "", slackThreadTs: undefined, slackUserId: userId, messageText: requestText, runId: run.id },
      });
    } else {
      const [task] = await createTask({
        slackUserId: userId,
        slackChannelId: "",
        type: taskType as "document" | "research" | "analytics",
        request: requestText,
      });
      await inngest.send({
        name: `slack/${taskType}.requested`,
        data: { slackChannelId: "", slackThreadTs: undefined, slackUserId: userId, messageText: requestText, taskId: task.id },
      });
    }

    return NextResponse.json({ response_action: "clear" });
  }

  // Handle block actions
  if (type === "block_actions") {
    const actions = (payload.actions || []) as Array<{ action_id: string; value?: string }>;
    for (const action of actions) {
      if (action.action_id === "retry_build" && action.value) {
        try {
          const value = JSON.parse(action.value);
          await inngest.send({
            name: "slack/build.requested",
            data: {
              slackChannelId: value.channelId,
              slackThreadTs: value.threadTs,
              slackUserId: value.userId,
              messageText: value.request,
              runId: value.runId,
            },
          });
        } catch { /* invalid JSON */ }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
