import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { inngest } from "@/lib/inngest/client";
import { createRun, createTask } from "@/lib/db";
import { slack, updateMessage } from "@/lib/slack/client";
import {
  replaceActionsWithDecision,
} from "@/lib/slack/blocks";

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
  const userId = user?.id || "";

  // ── Handle global shortcut — open modal ──
  if (type === "shortcut" && payload.callback_id === "klawhub_global_shortcut") {
    const triggerId = payload.trigger_id as string;
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken || !triggerId) return NextResponse.json({ ok: true });

    await fetch("https://slack.com/api/views.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
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
                placeholder: {
                  type: "plain_text",
                  text: "What do you need? Build, document, research, or analyze...",
                },
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
                  { text: { type: "plain_text", text: "Build" }, value: "build" },
                  { text: { type: "plain_text", text: "Document" }, value: "document" },
                  { text: { type: "plain_text", text: "Research" }, value: "research" },
                  { text: { type: "plain_text", text: "Analytics" }, value: "analytics" },
                ],
              },
              label: { type: "plain_text", text: "Task Type" },
            },
            {
              type: "input",
              block_id: "channel_input",
              optional: true,
              element: {
                type: "channels_select",
                action_id: "channel_action",
                placeholder: {
                  type: "plain_text",
                  text: "Select channel (optional)",
                },
              },
              label: { type: "plain_text", text: "Channel" },
            },
          ],
        },
      }),
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  }

  // ── Handle modal submission ──
  if (type === "view_submission" && payload.view) {
    const view = payload.view as Record<string, any>;
    const state = view.state as Record<string, any>;
    const values = state.values as Record<string, Record<string, any>>;
    const requestBlock = values.request_input?.request_action || {};
    const typeBlock = values.task_type?.type_action || {};
    const channelBlock = values.channel_input?.channel_action || {};

    const requestText = requestBlock.value || "";
    const taskType = typeBlock.selected_option?.value || "build";
    const channelId = channelBlock.selected_channel || "";

    if (!requestText.trim()) {
      return NextResponse.json({
        response_action: "errors",
        errors: { request_input: "Please enter a request" },
      });
    }

    // Post to the selected channel (or DM the user if no channel)
    let targetChannel = channelId;
    if (!targetChannel) {
      // Try to open a DM with the user
      try {
        const im = await slack.conversations.open({ users: userId });
        targetChannel = (im as any).channel?.id || "";
      } catch {
        // Can't post anywhere — still create the task
      }
    }

    if (taskType === "build") {
      const [run] = await createRun({
        slackUserId: userId,
        slackChannelId: targetChannel,
        request: requestText,
      });
      await inngest.send({
        name: "slack/build.requested",
        data: {
          slackChannelId: targetChannel,
          slackThreadTs: undefined,
          slackUserId: userId,
          messageText: requestText,
          runId: run.id,
        },
      });
    } else {
      const [task] = await createTask({
        slackUserId: userId,
        slackChannelId: targetChannel,
        type: taskType as "document" | "research" | "analytics",
        request: requestText,
      });
      await inngest.send({
        name: `slack/${taskType}.requested`,
        data: {
          slackChannelId: targetChannel,
          slackThreadTs: undefined,
          slackUserId: userId,
          messageText: requestText,
          taskId: task.id,
        },
      });
    }

    return NextResponse.json({ response_action: "clear" });
  }

  // ── Handle block actions (approve, reject, retry) ──
  if (type === "block_actions") {
    const actions = (payload.actions || []) as Array<{
      action_id: string;
      value?: string;
      block_id: string;
    }>;
    const responseUrl = payload.response_url as string | undefined;
    const message = payload.message as Record<string, any> | undefined;
    const channel = payload.channel as Record<string, string> | undefined;
    const messageTs = message?.ts || payload.message_ts;
    const channelId = channel?.id || payload.channel_id;

    for (const action of actions) {
      // ── Build spec approval ──
      if (action.action_id === "build_spec_approve" && action.value) {
        await inngest.send({
          name: "app/approval.decided",
          data: { referenceId: action.value, decision: "approved", userId },
        });
        continue;
      }
      if (action.action_id === "build_spec_reject" && action.value) {
        await inngest.send({
          name: "app/approval.decided",
          data: { referenceId: action.value, decision: "rejected", userId },
        });
        continue;
      }

      // ── Document outline approval ──
      if (action.action_id === "doc_outline_approve" && action.value) {
        await inngest.send({
          name: "app/approval.decided",
          data: { referenceId: action.value, decision: "approved", userId },
        });
        continue;
      }
      if (action.action_id === "doc_outline_reject" && action.value) {
        await inngest.send({
          name: "app/approval.decided",
          data: { referenceId: action.value, decision: "rejected", userId },
        });
        continue;
      }

      // ── Retry build ──
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
        continue;
      }
    }

    // Acknowledge button clicks by disabling the buttons via response_url
    if (responseUrl && channelId && messageTs) {
      try {
        const currentBlocks = message?.blocks as unknown[] | undefined;
        if (currentBlocks) {
          // Replace action buttons with disabled state (plain text)
          const disabledBlocks = currentBlocks.map((block: any) => {
            if (block.type === "actions") {
              return {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Processing... (clicked by <@${userId}>)`,
                  },
                ],
              };
            }
            return block;
          });
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              replace_original: true,
              text: message?.text || "Processing...",
              blocks: disabledBlocks,
            }),
          });
        }
      } catch {
        // Non-critical — the Inngest event was already sent
      }
    }
  }

  return NextResponse.json({ ok: true });
}
