import { inngest } from "./client";
import { runToolUseLoop } from "@/core/tools/executor";
import {
  generalAgentTools,
  pmAgentTools,
  engineerAgentTools,
  qaAgentTools,
  analystAgentTools,
  researchAgentTools,
  documentorAgentTools,
} from "@/core/tools/registry";
import { postToThread, updateMessage } from "@/integrations/slack/client";
import { approvalBlocks } from "@/integrations/slack/blocks";
import { mcpManager } from "@/core/tools/mcp-client";
import { getMcpServers } from "@/db";

import { PM_PROMPT } from "@/core/agents/pm";
import { ENGINEER_PROMPT } from "@/core/agents/engineer";
import { QA_PROMPT } from "@/core/agents/qa";
import { RESEARCH_PROMPT } from "@/core/agents/researcher";
import { ANALYST_PROMPT } from "@/core/agents/analyst";
import { DOCSTRUCTURE_PROMPT } from "@/core/agents/documentor";
import { ASSISTANT_PROMPT, assistantAgentTools } from "@/core/agents/assistant";

export type DagNodeTaskType = "code" | "document" | "research" | "review" | "general";

export interface DagNode {
  id: string;
  agent: "pm" | "engineer" | "qa" | "researcher" | "analyst" | "documentor" | "approval";
  instruction: string;
  dependsOn: string[];
  /** Hints the orchestrator about the nature of the task so agents are configured correctly */
  taskType?: DagNodeTaskType;
}

export interface DagEventData {
  slackChannelId: string;
  slackThreadTs: string;
  statusMessageTs?: string;
  slackUserId: string;
  runId: string;
  teamId?: string;
  workspaceId?: string;
  nodes: DagNode[];
}

/**
 * Smart truncation: Preserves start + end of text rather than just the start.
 * For code outputs, always preserves the DEPENDENCIES line and code block.
 */
function smartTruncate(text: string, maxChars = 6000): string {
  if (text.length <= maxChars) return text;

  const half = Math.floor(maxChars / 2);

  // Detect if output contains a code block — preserve it fully if under maxChars
  const codeBlockMatch = text.match(/DEPENDENCIES:.*?\n```[\s\S]*?```/);
  if (codeBlockMatch && codeBlockMatch[0].length <= maxChars) {
    return codeBlockMatch[0] + "\n... (surrounding context truncated for brevity)";
  }

  const start = text.slice(0, half);
  const end = text.slice(-half);
  return `${start}\n\n... (middle truncated — ${text.length - maxChars} chars omitted) ...\n\n${end}`;
}

const BASE_AGENT_MAP: Record<string, { tools: any[]; prompt: string }> = {
  pm:         { tools: pmAgentTools,         prompt: PM_PROMPT         || "You are a PM Agent."         },
  engineer:   { tools: engineerAgentTools,   prompt: ENGINEER_PROMPT   || "You are an Engineer Agent."  },
  qa:         { tools: qaAgentTools,         prompt: QA_PROMPT         || "You are a QA Agent."         },
  researcher: { tools: researchAgentTools,   prompt: RESEARCH_PROMPT   || "You are a Research Agent."   },
  analyst:    { tools: analystAgentTools,    prompt: ANALYST_PROMPT    || "You are a Data Analyst."     },
  documentor: { tools: documentorAgentTools, prompt: DOCSTRUCTURE_PROMPT || "You are a Documentor."     },
  // Lightweight agent for knowledge work (summarize, draft, advise, answer)
  assistant:  { tools: assistantAgentTools,  prompt: ASSISTANT_PROMPT  || "You are a helpful assistant." },
};

/** Per-agent resource config — tuned for each role's workload */
function getAgentConfig(agentName: string, taskType: DagNodeTaskType = "general") {
  if (agentName === "qa" && taskType === "code") {
    return { maxIterations: 20, temperature: 0.2, maxTokens: 32768 };
  }
  if (agentName === "researcher") {
    return { maxIterations: 15, temperature: 0.4, maxTokens: 16384 };
  }
  if (agentName === "engineer") {
    return { maxIterations: 10, temperature: 0.3, maxTokens: 16384 };
  }
  if (agentName === "documentor") {
    return { maxIterations: 6,  temperature: 0.4, maxTokens: 32768 };
  }
  // pm, analyst, qa (non-code), general
  return { maxIterations: 12, temperature: 0.3, maxTokens: 8192 };
}

export const dynamicDagWorkflow = inngest.createFunction(
  { id: "dynamic-dag", name: "Dynamic Workflow Executor", retries: 1 },
  { event: "slack/dag.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, statusMessageTs, slackUserId, runId, teamId, workspaceId, nodes } = event.data as DagEventData;

    const nodeOutputs: Record<string, string> = {};
    const completedNodes = new Set<string>();

    // ── Step 0: Load MCP tools once for the entire DAG run ──
    // This makes ALL connected MCP integrations (Notion, Salesforce, HubSpot etc.)
    // available to EVERY sub-agent in the workflow — not just the General Agent.
    const mcpTools = await step.run("load-mcp-tools", async () => {
      if (!workspaceId) return [];
      try {
        const servers = await getMcpServers(workspaceId);
        const allMcpTools: any[] = [];
        for (const srv of servers) {
          if (srv.status === "active") {
            const tools = await mcpManager.connectAndFetchTools(srv.url, srv.name, srv.authConfig);
            allMcpTools.push(...tools);
          }
        }
        console.log(`[DAG] Loaded ${allMcpTools.length} MCP tools from ${workspaceId}`);
        return allMcpTools;
      } catch (err) {
        console.warn("[DAG] Failed to load MCP tools — proceeding without them:", err);
        return [];
      }
    });

    // Merge MCP tools into all agent configs
    const AGENT_MAP: Record<string, { tools: any[]; prompt: string }> = {};
    for (const [key, config] of Object.entries(BASE_AGENT_MAP)) {
      AGENT_MAP[key] = {
        ...config,
        tools: [...config.tools, ...mcpTools],
      };
    }

    const getStatusText = () => {
      return "*Dynamic Workflow* — Active\n" + nodes.map(n => {
        if (completedNodes.has(n.id)) return `• ✅ \`${n.id}\` (${n.agent})`;
        if (n.dependsOn.every(d => completedNodes.has(d))) return `• 🔄 \`${n.id}\` (${n.agent})`;
        return `• ⏳ \`${n.id}\` (${n.agent})`;
      }).join("\n");
    };

    if (statusMessageTs) {
      await updateMessage(slackChannelId, statusMessageTs, getStatusText(), undefined, teamId);
    }

    let remainingNodes = [...nodes];

    while (remainingNodes.length > 0) {
      const readyNodes = remainingNodes.filter(n => n.dependsOn.every(dep => completedNodes.has(dep)));

      if (readyNodes.length === 0) {
        throw new Error("Deadlock detected in DAG: no nodes have all dependencies met.");
      }

      const results = await Promise.all(readyNodes.map(async (node) => {
        const safeNodeId = node.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const taskType: DagNodeTaskType = node.taskType || "general";

        if (node.agent === "approval") {
          await step.run(`post-approval-${safeNodeId}`, async () => {
             const blocks = approvalBlocks(
               `Approval Required: ${node.id}`,
               node.instruction,
               runId,
               node.id
             );
             await postToThread(slackChannelId, slackThreadTs, `⚠️ *Approval Required* for step: \`${node.id}\``, { blocks }, teamId);
          });

          const decision = await step.waitForEvent(`wait-approval-${safeNodeId}`, {
             event: `app/dag.approval/${runId}/${node.id}`,
             timeout: "24h",
          });

          if (!decision || decision.data.decision === "rejected") {
             await step.run(`approval-reject-${safeNodeId}`, async () => {
                await postToThread(slackChannelId, slackThreadTs, `❌ Workflow Halted: Step \`${node.id}\` was rejected.\nReason: ${decision?.data.feedback || "Timeout"}`, undefined, teamId);
             });
             throw new Error(`Approval rejected for ${node.id}`);
          }

          return `Approved. Feedback: ${decision.data.feedback || "No feedback provided."}`;
        }

        const agentConfig = AGENT_MAP[node.agent] || { tools: generalAgentTools, prompt: "You are an agent." };
        const resourceConfig = getAgentConfig(node.agent, taskType);

        return await step.run(`exec-${safeNodeId}`, async () => {
          let context = `You are executing step '${node.id}' in a multi-step workflow.\n\n`;
          if (node.dependsOn.length > 0) {
            context += `--- OUTPUTS FROM PREVIOUS STEPS ---\n`;
            node.dependsOn.forEach(dep => {
              const output = nodeOutputs[dep] || "No output from dependency.";
              const truncated = smartTruncate(output, 6000);
              context += `[Step: ${dep}]\n${truncated}\n\n`;
            });
          }
          context += `--- YOUR INSTRUCTION ---\n${node.instruction}`;

          return await runToolUseLoop(context, {
            systemPrompt: `${agentConfig.prompt}\n\nCOORDINATION CONTEXT:\n${context}`,
            tools: agentConfig.tools,
            context: { slackUserId, slackChannelId, slackThreadTs, runId, workspaceId },
            maxIterations: resourceConfig.maxIterations,
            temperature: resourceConfig.temperature,
            maxTokens: resourceConfig.maxTokens,
            agentName: node.agent,
            traceId: runId,  // Propagate run ID as trace ID for correlated log lines
          });
        });
      }));

      readyNodes.forEach((node, index) => {
        nodeOutputs[node.id] = results[index];
        completedNodes.add(node.id);
      });

      remainingNodes = remainingNodes.filter(n => !completedNodes.has(n.id));

      if (statusMessageTs) {
        await updateMessage(slackChannelId, statusMessageTs, getStatusText(), undefined, teamId);
      }
    }

    await step.run("finalize-dag", async () => {
      await postToThread(slackChannelId, slackThreadTs, `✅ *Workflow Completed Successfully*\nAll nodes in the dynamic graph have been executed.`, undefined, teamId);
    });
  }
);
