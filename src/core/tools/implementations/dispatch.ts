import { ToolDefinition } from "@/core/tools/registry";
import { inngest } from "@/workflows/client";
import { createRun, createTask } from "@/db";
import { getThreadHistory } from "@/utils/thread-context";
import { getSessionSummary } from "@/core/memory/thread-summary";
import { buildKnowledgeContext } from "@/db/knowledge";

/**
 * Enrich task instructions with available context so sub-agents
 * (PM, Engineer, Researcher) see the full picture — not just raw text.
 */
async function enrichInstructions(
  instructions: string,
  ctx: { slackChannelId?: string; slackThreadTs?: string; slackUserId?: string; slackTeamId?: string; workspaceId?: string }
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

  // Fetch semantic knowledge (RAG)
  if (ctx.slackUserId) {
    try {
      const knowledge = await buildKnowledgeContext(ctx.slackUserId, instructions, ctx.workspaceId);
      if (knowledge && knowledge.length > 20) {
        parts.push(`\n\n--- RELEVANT KNOWLEDGE (RAG) ---\n${knowledge}`);
      }
    } catch {
      // Non-critical
    }
  }

  return parts.join("");
}

export const dispatchTaskTool: ToolDefinition = {
  name: "dispatch_task",
  description:
    "Dispatch a task to a specialized agent workflow. Use 'build' for code/scripts/automation, 'research' for web research and information gathering, 'document' for creating reports/proposals/contracts/emails, 'analytics' for data analysis and charts, 'assist' for knowledge work like summarizing, drafting, advising or answering questions, or 'coordinated' for complex tasks that need research THEN a full build pipeline (Research → PM Spec → Engineer → QA).",
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
      workspaceId: ctx.workspaceId,
    });

    // Unified DAG Generation logic
    let nodes: any[] = [];
    if (task_type === "build") {
      nodes = [
        { id: "plan", agent: "pm", instruction: `Create a detailed technical spec for: ${enrichedInstructions}`, dependsOn: [], taskType: "code" },
        { id: "approval", agent: "approval", instruction: "Please review the technical specification before coding begins.", dependsOn: ["plan"], taskType: "general" },
        { id: "code", agent: "engineer", instruction: "Implement the approved specification. Output ONLY: DEPENDENCIES line + code block. Do NOT execute anything.", dependsOn: ["approval"], taskType: "code" },
        { id: "test", agent: "qa", instruction: "You are the Sandbox Executor. Parse the Engineer's output to extract the code, language, and dependencies. Execute it in the sandbox using the code_execute tool. Evaluate it against the spec. If it FAILS, provide a precise diagnosis to the Engineer, get fixed code, and retry execution. Repeat up to 3 times autonomously. Only escalate to the user after 3 failed attempts.", dependsOn: ["code"], taskType: "code" }
      ];
    } else if (task_type === "research") {
      nodes = [{ id: "research", agent: "researcher", instruction: enrichedInstructions, dependsOn: [], taskType: "research" }];
    } else if (task_type === "document") {
      nodes = [{ id: "write", agent: "documentor", instruction: enrichedInstructions, dependsOn: [], taskType: "document" }];
    } else if (task_type === "analytics") {
      nodes = [{ id: "analyze", agent: "analyst", instruction: enrichedInstructions, dependsOn: [], taskType: "general" }];
    } else if (task_type === "assist") {
      // Generic knowledge work — no code, no sandbox. A single general-purpose agent handles it.
      nodes = [{ id: "assist", agent: "researcher", instruction: enrichedInstructions, dependsOn: [], taskType: "general" }];
    } else if (task_type === "coordinated") {
      // Full pipeline: Research → PM Spec → Approval → Engineer → QA
      nodes = [
        { id: "research", agent: "researcher", instruction: `Research background for: ${enrichedInstructions}`, dependsOn: [], taskType: "research" },
        { id: "plan", agent: "pm", instruction: `Based on the research findings, create a detailed technical spec for: ${enrichedInstructions}`, dependsOn: ["research"], taskType: "code" },
        { id: "approval", agent: "approval", instruction: "Please review the technical specification before coding begins.", dependsOn: ["plan"], taskType: "general" },
        { id: "code", agent: "engineer", instruction: "Implement the approved specification. Output ONLY: DEPENDENCIES line + code block. Do NOT execute anything.", dependsOn: ["approval"], taskType: "code" },
        { id: "test", agent: "qa", instruction: "You are the Sandbox Executor. Parse the Engineer's output to extract the code, language, and dependencies. Execute it in the sandbox using the code_execute tool. Evaluate it against the spec. If it FAILS, diagnose precisely, get the Engineer to fix it, and retry. Repeat up to 3 times autonomously.", dependsOn: ["code"], taskType: "code" }
      ];
    } else {
      return `Error: Unknown task_type '${task_type}'. Must be build, research, document, analytics, assist, or coordinated.`;
    }

    try {
      const [run] = await createRun({
        slackUserId: ctx.slackUserId,
        slackChannelId: ctx.slackChannelId,
        slackThreadTs: ctx.slackThreadTs,
        request: `Unified Task: ${task_type}`,
        workspaceId: ctx.workspaceId,
      });

      await inngest.send({
        name: "slack/dag.requested" as any,
        data: {
          slackChannelId: ctx.slackChannelId,
          slackThreadTs: ctx.slackThreadTs,
          slackUserId: ctx.slackUserId,
          messageText: enrichedInstructions,
          runId: run.id,
          teamId: ctx.slackTeamId,
          nodes: nodes,
        },
      });

      return `Successfully dispatched a ${task_type} workflow with ID ${run.id}. The agent squad will handle it and post updates in the thread.`;
    } catch (err) {
      return `Failed to dispatch unified task: ${(err as Error).message}`;
    }
  },
};

export const dispatchWorkflowTool: ToolDefinition = {
  name: "dispatch_workflow",
  description:
    "Dispatch a custom, dynamically generated multi-agent DAG (Directed Acyclic Graph) workflow. Use this for complex sequences that don't fit standard tasks. E.g., Research -> PM -> Approval -> Engineer.",
  parameters: {
    nodes: {
      type: "string",
      description: "JSON array of DAG nodes. Each node must have: id (string), agent ('pm'|'engineer'|'qa'|'researcher'|'analyst'|'general'|'approval'), instruction (string), and dependsOn (string array of node ids this node depends on).",
      required: true,
    },
  },
  async execute(params, ctx) {
    if (!ctx.slackChannelId || !ctx.slackThreadTs || !ctx.slackUserId) {
      return "Error: Cannot dispatch workflow without Slack channel/thread/user context.";
    }

    try {
      const nodes = JSON.parse(params.nodes);
      
      const [run] = await createRun({
        slackUserId: ctx.slackUserId,
        slackChannelId: ctx.slackChannelId,
        slackThreadTs: ctx.slackThreadTs,
        request: "Dynamic Workflow Execution",
        workspaceId: ctx.workspaceId,
      });

      await inngest.send({
        name: "slack/dag.requested" as any,
        data: {
          slackChannelId: ctx.slackChannelId,
          slackThreadTs: ctx.slackThreadTs,
          slackUserId: ctx.slackUserId,
          runId: run.id,
          teamId: ctx.slackTeamId,
          nodes: nodes,
        },
      });

      return `Successfully dispatched custom DAG workflow (Run ID: ${run.id}). The agents will execute the nodes and post updates in the thread.`;
    } catch (err) {
      return `Failed to dispatch workflow: ${(err as Error).message}`;
    }
  },
};
