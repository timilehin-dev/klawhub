import { ToolDefinition } from "@/core/tools/registry";
import { inngest } from "@/workflows/client";
import { createRun } from "@/db";

export const dispatchTaskTool: ToolDefinition = {
  name: "dispatch_task",
  description:
    "Dispatch a task to a specialized agent workflow (build, research, document, analytics). Use this when the user wants a script built, deep research done, a document created, or data analyzed.",
  parameters: {
    task_type: {
      type: "string",
      description: "The type of task: 'build', 'research', 'document', or 'analytics'",
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

    let eventName = "";
    if (task_type === "build") eventName = "slack/build.requested";
    else if (task_type === "research") eventName = "slack/research.requested";
    else if (task_type === "document") eventName = "slack/document.requested";
    else if (task_type === "analytics") eventName = "slack/analytics.requested";
    else return `Error: Unknown task_type '${task_type}'. Must be build, research, document, or analytics.`;

    try {
      // Create a run record in the database
      const [run] = await createRun({
        slackUserId: ctx.slackUserId,
        slackChannelId: ctx.slackChannelId,
        slackThreadTs: ctx.slackThreadTs,
        request: instructions,
        workspaceId: ctx.workspaceId,
      });

      // Dispatch to Inngest
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
