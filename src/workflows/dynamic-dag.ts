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

// Import real personas to maintain intelligence quality
import { PM_PROMPT } from "@/core/agents/pm";
import { ENGINEER_PROMPT } from "@/core/agents/engineer";
import { QA_PROMPT } from "@/core/agents/qa";
import { RESEARCH_PROMPT } from "@/core/agents/researcher";
import { ANALYST_PROMPT } from "@/core/agents/analyst";
import { DOCSTRUCTURE_PROMPT } from "@/core/agents/documentor";

export interface DagNode {
  id: string;
  agent: "pm" | "engineer" | "qa" | "researcher" | "analyst" | "documentor" | "approval";
  instruction: string;
  dependsOn: string[];
}

export interface DagEventData {
  slackChannelId: string;
  slackThreadTs: string;
  statusMessageTs?: string;
  slackUserId: string;
  runId: string;
  teamId?: string;
  nodes: DagNode[];
}

const AGENT_MAP: Record<string, { tools: any[]; prompt: string }> = {
  pm: { tools: pmAgentTools, prompt: PM_PROMPT || "You are a PM Agent." },
  engineer: { tools: engineerAgentTools, prompt: ENGINEER_PROMPT || "You are an Engineer Agent." },
  qa: { tools: qaAgentTools, prompt: QA_PROMPT || "You are a QA Agent." },
  researcher: { tools: researchAgentTools, prompt: RESEARCH_PROMPT || "You are a Research Agent." },
  analyst: { tools: analystAgentTools, prompt: ANALYST_PROMPT || "You are a Data Analyst Agent." },
  documentor: { tools: documentorAgentTools, prompt: DOCSTRUCTURE_PROMPT || "You are a Documentor Agent." },
};

export const dynamicDagWorkflow = inngest.createFunction(
  { id: "dynamic-dag", name: "Dynamic Workflow Executor", retries: 1 },
  { event: "slack/dag.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, statusMessageTs, slackUserId, runId, teamId, nodes } = event.data as DagEventData;
    
    const nodeOutputs: Record<string, string> = {};
    const completedNodes = new Set<string>();

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
        // Sanitize node ID for Inngest step compatibility
        const safeNodeId = node.id.replace(/[^a-zA-Z0-9_-]/g, '_');

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

        return await step.run(`exec-${safeNodeId}`, async () => {
          let context = `You are executing step '${node.id}' in a multi-step workflow.\n\n`;
          if (node.dependsOn.length > 0) {
            context += `--- OUTPUTS FROM PREVIOUS STEPS ---\n`;
            node.dependsOn.forEach(dep => {
              const output = nodeOutputs[dep] || "No output from dependency.";
              // Truncate huge outputs to prevent context blowup (keep first 4000 chars)
              const truncated = output.length > 4000 ? output.slice(0, 4000) + "\n... (truncated for brevity)" : output;
              context += `[Step: ${dep}]\n${truncated}\n\n`;
            });
          }
          context += `--- YOUR INSTRUCTION ---\n${node.instruction}`;

          return await runToolUseLoop(context, {
            systemPrompt: `${agentConfig.prompt}\n\nCOORDINATION CONTEXT:\n${context}`,
            tools: agentConfig.tools,
            context: { slackUserId, slackChannelId, slackThreadTs, runId },
            maxIterations: 12,
            temperature: 0.3,
            maxTokens: 4096,
            agentName: node.agent
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
