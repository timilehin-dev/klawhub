import { inngest } from "./client";
import { getDueSchedules, markTriggered, incrementFailCount, updateSchedule, getWorkspaceByTeamId } from "@/db";
import { cronMatchesNow } from "@/core/tools/cron-match";
import { getWorkspaceSlack, postToThread } from "@/integrations/slack/client";
import { classify } from "@/core/agents/classifier";
import { chatAsAgent } from "@/core/agents/general";
import { createRun, createTask } from "@/db";

export const scheduleRunnerWorkflow = inngest.createFunction(
  { id: "schedule-runner", name: "Schedule Runner", retries: 3 },
  { cron: "*/5 * * * *" }, // Run every 5 minutes
  async ({ step }) => {
    const now = new Date();

    const dueSchedules = await step.run("fetch-due-schedules", async () => {
      return getDueSchedules(now);
    });

    if (dueSchedules.length === 0) return;

    for (const schedule of dueSchedules) {
      const shouldFire = await step.run(`check-${schedule.id.slice(0, 8)}`, async () => {
        return cronMatchesNow(
          schedule.cronExpr,
          now,
          schedule.timezone || "UTC"
        );
      });

      if (!shouldFire) continue;

      await step.run(`fire-${schedule.id.slice(0, 8)}`, async () => {
        const targetChannel = schedule.channelId;
        const targetTeamId = schedule.slackTeamId || undefined;
        if (!targetChannel) {
          console.warn(`[SCHEDULER] No channel for schedule ${schedule.id}`);
          return;
        }

        try {
          const wsClient = await getWorkspaceSlack(targetTeamId);
          
          // Check if this is a huddle/standup
          const isHuddle = /huddle|standup|retro/i.test(schedule.name) || /huddle|standup|retro/i.test(schedule.action);
          
          let threadTs: string | undefined;

          if (isHuddle) {
            const huddleMsg = await wsClient.chat.postMessage({
              channel: targetChannel,
              text: `:wave: *${schedule.name}* is starting!`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `:wave: *${schedule.name}* has started!\n_Please check in and share your updates for the team._`
                  }
                },
                {
                  type: "actions",
                  elements: [
                    {
                      type: "button",
                      text: { type: "plain_text", text: "Join Huddle" },
                      style: "primary",
                      action_id: "huddle_join",
                      url: "https://slack.com/features/huddles" // Fallback link
                    },
                    {
                      type: "button",
                      text: { type: "plain_text", text: "Post Update" },
                      action_id: "huddle_post_update"
                    },
                    {
                      type: "button",
                      text: { type: "plain_text", text: "Excuse Me" },
                      style: "danger",
                      action_id: "huddle_excuse"
                    }
                  ]
                }
              ]
            });
            threadTs = (huddleMsg as any).ts;
          } else {
            // Default "running" message
            const runMsg = await wsClient.chat.postMessage({
              channel: targetChannel,
              text: `:clock1: *${schedule.name}*\n_Executing scheduled task..._`,
            });
            threadTs = (runMsg as any).ts;
          }

          // Classify the action
          const classification = await classify(schedule.action);
          const requestText = classification.extractedRequest || schedule.action;
          const userId = schedule.slackUserId;

          let workspaceId: string | undefined = undefined;
          if (targetTeamId) {
            const ws = await getWorkspaceByTeamId(targetTeamId);
            if (ws && ws.length > 0) {
              workspaceId = ws[0].id;
            }
          }

          if (classification.type === "chat" || classification.type === "unclear") {
            // Run through the general agent (with full tool-use and workspace context)
            const response = await chatAsAgent(userId, schedule.action, {
              workspaceId,
              slackChannelId: targetChannel,
              slackThreadTs: threadTs,
              slackTeamId: targetTeamId,
            });
            await postToThread(targetChannel, threadTs!, response, undefined, targetTeamId);
            await updateSchedule(schedule.id, {
              lastRunStatus: "success",
              consecutiveSuccesses: (schedule.consecutiveSuccesses || 0) + 1,
            });
          } else if (classification.type === "build") {
            // Create a build run and fire the Inngest workflow
            const [run] = await createRun({
              slackUserId: userId,
              slackChannelId: targetChannel,
              slackThreadTs: threadTs,
              request: requestText,
            });
            await inngest.send({
              name: "slack/build.requested",
              data: {
                slackChannelId: targetChannel,
                slackThreadTs: threadTs,
                slackUserId: userId,
                messageText: requestText,
                runId: run.id,
                teamId: targetTeamId,
              },
            });
            await updateSchedule(schedule.id, { lastRunStatus: "success" });
          } else {
            // For research, document, analytics — create task and fire workflow
            const taskType = classification.type as "document" | "research" | "analytics";
            const [task] = await createTask({
              slackUserId: userId,
              slackChannelId: targetChannel,
              slackThreadTs: threadTs,
              type: taskType,
              request: requestText,
            });
            await inngest.send({
              name: `slack/${taskType}.requested`,
              data: {
                slackChannelId: targetChannel,
                slackThreadTs: threadTs,
                slackUserId: userId,
                messageText: requestText,
                taskId: task.id,
                teamId: targetTeamId,
              },
            });
            await updateSchedule(schedule.id, { lastRunStatus: "success" });
          }

          await markTriggered(schedule.id, new Date());
        } catch (err) {
          console.error(`[SCHEDULER] Failed to fire ${schedule.id}:`, err);

          // Try to post error message using per-workspace client
          try {
            const wsClient = await getWorkspaceSlack(targetTeamId);
            
            if (schedule.failCount === 2) {
              // It's hitting 3 failures and being auto-paused by the DB
              await wsClient.chat.postMessage({
                channel: targetChannel,
                text: `Heads up: I've paused the *${schedule.name}* schedule because it failed 3 times in a row. Let me know when you want me to look into it!`,
              });
            } else {
              await wsClient.chat.postMessage({
                channel: targetChannel,
                text: `:warning: *${schedule.name}* — Scheduled task failed: ${(err as Error).message.slice(0, 200)}`,
              });
            }
          } catch { /* ignore */ }

          await incrementFailCount(schedule.id);
          await updateSchedule(schedule.id, {
            lastRunStatus: "error",
          });
        }
      });
    }
  }
);
