import { ToolDefinition } from "@/core/tools/registry";
import { inngest } from "@/workflows/client";
import { createRun, createTask } from "@/db";

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

    const { task_type, instructions } = params;

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
          request: instructions,
          workspaceId: ctx.workspaceId,
        });

        await inngest.send({
          name: eventName as any,
          data: {
            slackChannelId: ctx.slackChannelId,
            slackThreadTs: ctx.slackThreadTs,
            slackUserId: ctx.slackUserId,
            messageText: instructions,
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
        request: instructions,
        workspaceId: ctx.workspaceId,
      });

      await inngest.send({
        name: eventName as any,
        data: {
          slackChannelId: ctx.slackChannelId,
          slackThreadTs: ctx.slackThreadTs,
          slackUserId: ctx.slackUserId,
          messageText: instructions,
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
