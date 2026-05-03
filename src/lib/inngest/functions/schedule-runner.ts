import { inngest } from "../client";
import { getDueSchedules, markTriggered, incrementFailCount, updateSchedule } from "@/lib/db";
import { cronMatchesNow } from "@/lib/tools/cron-match";
import { slack, postToThread } from "@/lib/slack/client";
import { classify } from "@/lib/agents/classifier";
import { chatAsAgent } from "@/lib/agents/general";
import { createRun, createTask } from "@/lib/db";

export const scheduleRunnerWorkflow = inngest.createFunction(
  { id: "schedule-runner", name: "Schedule Runner" },
  { cron: "*/5 * * * *" }, // Run every 5 minutes
  async ({ step }) => {
    const now = new Date();

    const dueSchedules = await step.run("fetch-due-schedules", async () => {
      return getDueSchedules(now);
    });

    if (dueSchedules.length === 0) return;

    for (const schedule of dueSchedules) {
      const shouldFire = step.run(`check-${schedule.id.slice(0, 8)}`, async () => {
        return cronMatchesNow(
          schedule.cronExpr,
          now,
          schedule.timezone || "UTC"
        );
      });

      if (!shouldFire) continue;

      await step.run(`fire-${schedule.id.slice(0, 8)}`, async () => {
        const targetChannel = schedule.channelId;
        if (!targetChannel) {
          console.warn(`[SCHEDULER] No channel for schedule ${schedule.id}`);
          return;
        }

        try {
          // Post "running" message to get a thread_ts
          const runMsg = await slack.chat.postMessage({
            channel: targetChannel,
            text: `:clock1: *${schedule.name}*\n_Executing scheduled task..._`,
          });
          const threadTs = (runMsg as any).ts;

          // Classify the action
          const classification = await classify(schedule.action);
          const requestText = classification.extractedRequest || schedule.action;
          const userId = schedule.slackUserId;

          if (classification.type === "chat" || classification.type === "unclear") {
            // Run through the general agent (with full tool-use)
            const response = await chatAsAgent(userId, schedule.action);
            await postToThread(targetChannel, threadTs!, response);
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
              },
            });
            await updateSchedule(schedule.id, { lastRunStatus: "success" });
          }

          await markTriggered(schedule.id, new Date());
        } catch (err) {
          console.error(`[SCHEDULER] Failed to fire ${schedule.id}:`, err);

          // Try to post error message
          try {
            await slack.chat.postMessage({
              channel: targetChannel,
              text: `:warning: *${schedule.name}* — Scheduled task failed: ${(err as Error).message.slice(0, 200)}`,
            });
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
