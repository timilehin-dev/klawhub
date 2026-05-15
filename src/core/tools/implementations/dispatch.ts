import { ToolDefinition } from "@/core/tools/registry";
import { inngest } from "@/workflows/client";
import { createRun, createTask } from "@/db";
import { getThreadHistory } from "@/utils/thread-context";
import { getSessionSummary } from "@/core/memory/thread-summary";

/**
 * Enrich task instructions with available context so sub-agents
 * (PM, Engineer, Researcher) see the full picture — not just raw text.
 */
async function enrichInstructions(
  instructions: string,
  ctx: { slackChannelId?: string; slackThreadTs?: string; slackUserId?: string; slackTeamId?: string }
): Promise<string> {
  const parts: string[] = [instructions];

  // Fetch thread history for context
  if (ctx.slackChannelId && ctx.slackThreadTs && ctx.slackTeamId) {
    try {
      const history = await getThreadHistory(ctx.slackChannelId, ctx.slackThreadTs, ctx.slackTeamId, 10);
      if (history && history.length > 20) {
        parts.push(`\n\n--- THREAD CONTEXT ---\n${history.slice(0, 3000)}`);
      }
    } catch {
      // Non-critical — proceed without thread context
    }
  }

  // Fetch session summary for cross-thread context
  if (ctx.slackUserId) {
    try {
      const session = await getSessionSummary(ctx.slackUserId);
      if (session && session.length > 20) {
        parts.push(`\n\n--- SESSION CONTEXT ---\n${session.slice(0, 2000)}`);
      }
    } catch {
      // Non-critical — proceed without session context
    }
  }

  return parts.join("");
}

export const dispatchTaskTool: ToolDefinition = {
  name: "dispatch_task",
  description:
    "Dispatch a task to a specialized agent workflow. Use 'build' for code/scripts, 'research' for web research, 'document' for documents, 'analytics' for data analysis, or 'coordinated' for complex tasks that need BOTH research AND code generation (runs Research + Engineer in parallel).",
  parameters: {
    task_type: {
      type: "string",
      description: "The type of task: 'build', 'research', 'document', 'analytics', or 'coordinated' (for tasks needing research + code)",
      required: true,
    },
    instructions: {
      type: "string",
      description: "Detailed instructions for the task, combining user request and context",
      required: true,
    },
  },
  async execute(params, ctx) {
    if (!ctx.slackChannelId || !ctx.slackThreadTs || !ctx.slackUserId) {
      return "Error: Cannot dispatch task without Slack channel/thread/user context.";
    }

    const { task_type } = params;

    // Enrich instructions with thread and session context
    const enrichedInstructions = await enrichInstructions(params.instructions, {
      slackChannelId: ctx.slackChannelId,
      slackThreadTs: ctx.slackThreadTs,
      slackUserId: ctx.slackUserId,
      slackTeamId: ctx.slackTeamId,
    });

    // Map task types to Inngest event names
    const eventMap: Record<string, string> = {
      build: "slack/build.requested",
      research: "slack/research.requested",
      document: "slack/document.requested",
      analytics: "slack/analytics.requested",
      coordinated: "slack/coordinated.requested",
    };

    const eventName = eventMap[task_type];
    if (!eventName) {
      return `Error: Unknown task_type '${task_type}'. Must be build, research, document, analytics, or coordinated.`;
    }

    try {
      // For non-build task types that use the tasks table
      if (task_type === "document" || task_type === "research" || task_type === "analytics") {
        const [task] = await createTask({
          slackUserId: ctx.slackUserId,
          slackChannelId: ctx.slackChannelId,
          slackThreadTs: ctx.slackThreadTs,
          type: task_type as "document" | "research" | "analytics",
          request: enrichedInstructions,
          workspaceId: ctx.workspaceId,
        });

        await inngest.send({
          name: eventName as any,
          data: {
            slackChannelId: ctx.slackChannelId,
            slackThreadTs: ctx.slackThreadTs,
            slackUserId: ctx.slackUserId,
            messageText: enrichedInstructions,
            taskId: task.id,
            teamId: ctx.slackTeamId,
          },
        });

        return `Successfully dispatched a ${task_type} task with ID ${task.id}. The specialized agent will reply in the thread shortly.`;
      }

      // For build and coordinated types that use the runs table
      const [run] = await createRun({
        slackUserId: ctx.slackUserId,
        slackChannelId: ctx.slackChannelId,
        slackThreadTs: ctx.slackThreadTs,
        request: enrichedInstructions,
        workspaceId: ctx.workspaceId,
      });

      await inngest.send({
        name: eventName as any,
        data: {
          slackChannelId: ctx.slackChannelId,
          slackThreadTs: ctx.slackThreadTs,
          slackUserId: ctx.slackUserId,
          messageText: enrichedInstructions,
          runId: run.id,
          teamId: ctx.slackTeamId,
        },
      });

      return `Successfully dispatched a ${task_type} task with ID ${run.id}. The specialized agent will reply in the thread shortly.`;
    } catch (err) {
      return `Failed to dispatch task: ${(err as Error).message}`;
    }
  },
};
