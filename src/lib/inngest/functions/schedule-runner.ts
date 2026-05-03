import { inngest } from "../client";
import { getDueSchedules, markTriggered, incrementFailCount } from "@/lib/db";
import { cronMatchesNow } from "@/lib/tools/cron-match";
import { slack } from "@/lib/slack/client";

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
        try {
          const targetChannel = schedule.channelId;
          if (!targetChannel) {
            console.warn(`[SCHEDULER] No channel for schedule ${schedule.id}`);
            return;
          }

          // Post the scheduled action as a message to the channel
          await slack.chat.postMessage({
            channel: targetChannel,
            text: `:clock1: *${schedule.name}*\n\n${schedule.action}`,
          });

          await markTriggered(schedule.id, new Date());
        } catch (err) {
          console.error(`[SCHEDULER] Failed to fire ${schedule.id}:`, err);
          await incrementFailCount(schedule.id);
        }
      });
    }
  }
);
