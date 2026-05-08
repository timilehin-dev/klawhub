import { inngest } from "./client";
import { getStaleRuns, getStaleTasks, updateRun, updateTask } from "@/db";
import { postToThread } from "@/integrations/slack/client";

/**
 * Task Monitor — The "Proactive Coworker" watchdog.
 *
 * Runs every 15 minutes via Inngest cron. Scans the `runs` and `tasks` tables
 * for items stuck in active states (pending, processing, pending_approval)
 * longer than the threshold, and proactively notifies the user in Slack.
 *
 * This ensures Klawhub never "goes silent" on a user — if something stalls,
 * the user gets a heads-up instead of wondering what happened.
 */

const STALE_THRESHOLD_MINUTES = 15;

export const taskMonitorWorkflow = inngest.createFunction(
  { id: "task-monitor", name: "Task Monitor" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    // Step 1: Fetch stale runs and tasks in parallel
    const [staleRuns, staleTasks] = await step.run("fetch-stale-items", async () => {
      const [runs, tasks] = await Promise.all([
        getStaleRuns(STALE_THRESHOLD_MINUTES),
        getStaleTasks(STALE_THRESHOLD_MINUTES),
      ]);
      return [runs, tasks] as const;
    });

    const totalStale = staleRuns.length + staleTasks.length;
    if (totalStale === 0) return { staleRuns: 0, staleTasks: 0, notified: 0 };

    let notified = 0;

    // Step 2: Notify users about stale runs
    for (const run of staleRuns) {
      await step.run(`notify-run-${run.id.slice(0, 8)}`, async () => {
        const channelId = run.slackChannelId;
        const threadTs = run.slackThreadTs || undefined;

        const statusLabels: Record<string, string> = {
          pending: "queued but hasn't started",
          pm: "stuck in PM analysis",
          coding: "stuck in code generation",
          qa: "stuck in QA testing",
          pending_approval: "waiting for your approval",
        };
        const detail = statusLabels[run.status || "pending"] || run.status;
        const age = run.updatedAt
          ? Math.round((Date.now() - new Date(run.updatedAt).getTime()) / 60000)
          : STALE_THRESHOLD_MINUTES;

        const message = run.status === "pending_approval"
          ? `:bell: *Reminder:* A build is *waiting for your approval* (${age}min ago). Reply *approve* or *reject* to continue.`
          : `:warning: *Stale Build Detected:* This build has been *${detail}* for ${age} minutes. I'm flagging it so it doesn't fall through the cracks.\n\nIf this is unexpected, you can start a new request.`;

        try {
          await postToThread(channelId, threadTs || channelId, message);
          notified++;
        } catch {
          // Channel might be deleted or bot removed — mark run as error
          await updateRun(run.id, { status: "error" });
        }
      });
    }

    // Step 3: Notify users about stale tasks
    for (const task of staleTasks) {
      await step.run(`notify-task-${task.id.slice(0, 8)}`, async () => {
        const channelId = task.slackChannelId;
        const threadTs = task.slackThreadTs || undefined;

        const statusLabels: Record<string, string> = {
          pending: "queued but hasn't started",
          pending_approval: "waiting for your approval",
          processing: "stuck in processing",
        };
        const detail = statusLabels[task.status || "pending"] || task.status;
        const age = task.updatedAt
          ? Math.round((Date.now() - new Date(task.updatedAt).getTime()) / 60000)
          : STALE_THRESHOLD_MINUTES;

        const message = task.status === "pending_approval"
          ? `:bell: *Reminder:* A ${task.type} task is *waiting for your approval* (${age}min ago). Reply *approve* or *reject* to continue.`
          : `:warning: *Stale Task Detected:* This ${task.type} task has been *${detail}* for ${age} minutes.\n\nIf this is unexpected, you can start a new request.`;

        try {
          await postToThread(channelId, threadTs || channelId, message);
          notified++;
        } catch {
          await updateTask(task.id, { status: "error" });
        }
      });
    }

    // Step 4: Proactive Workflow Optimization (for tasks > 1 hour)
    const longRunningThreshold = 60; // 1 hour
    const longRunningTasks = await step.run("fetch-long-running", async () => {
      // Re-using stale logic but with higher threshold for optimization analysis
      return await getStaleTasks(longRunningThreshold);
    });

    for (const task of longRunningTasks) {
      await step.run(`optimize-task-${task.id.slice(0, 8)}`, async () => {
        const channelId = task.slackChannelId;
        const threadTs = task.slackThreadTs || undefined;

        // Use PM agent to suggest an improvement
        const prompt = `The following task has been running for over an hour: "${task.title}" (Type: ${task.type}).
        Proactively suggest ONE specific way to speed this up or break it down for the user.
        Example: "I noticed this is taking a while. Should I break this into 3 smaller sub-tasks to process in parallel?"
        Keep it short (1 sentence).`;

        const suggestion = await agentChat("pm", [
          { role: "system", content: "You are a workflow optimization expert." },
          { role: "user", content: prompt }
        ], { temperature: 0.3, maxTokens: 200 }, { workspaceId: task.workspaceId });

        if (suggestion) {
          await postToThread(channelId, threadTs || channelId, `:zap: *Optimization Suggestion:* ${suggestion}`);
        }
      });
    }

    console.log(`[TASK-MONITOR] Stale runs: ${staleRuns.length}, tasks: ${staleTasks.length}, notified: ${notified}, optimized: ${longRunningTasks.length}`);
    return { staleRuns: staleRuns.length, staleTasks: staleTasks.length, notified };
  }
);
