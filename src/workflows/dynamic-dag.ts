import { inngest } from "./client";
import { runToolUseLoop } from "@/core/tools/executor";
import {
  generalAgentTools,
  pmAgentTools,
  engineerAgentTools,
  qaAgentTools,
  analystAgentTools,
  researchAgentTools,
} from "@/core/tools/registry";
import { postToThread, updateMessage } from "@/integrations/slack/client";
import { approvalBlocks } from "@/integrations/slack/blocks";

export interface DagNode {
  id: string;
  agent: "pm" | "engineer" | "qa" | "researcher" | "analyst" | "general" | "approval";
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

const AGENT_TOOLS_MAP: Record<string, any[]> = {
  pm: pmAgentTools,
  engineer: engineerAgentTools,
  qa: qaAgentTools,
  researcher: researchAgentTools,
  analyst: analystAgentTools,
  general: generalAgentTools,
};

export const dynamicDagWorkflow = inngest.createFunction(
  { id: "dynamic-dag", name: "Dynamic Workflow Executor", retries: 1 },
  { event: "slack/dag.requested" },
  async ({ event, step }): Promise<void> => {
    const { slackChannelId, slackThreadTs, statusMessageTs, slackUserId, runId, teamId, nodes } = event.data as DagEventData;
    
    const nodeOutputs: Record<string, any> = {};
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

    // Topological sorting logic loop
    let remainingNodes = [...nodes];
    
    while (remainingNodes.length > 0) {
      // Find all nodes whose dependencies are met
      const readyNodes = remainingNodes.filter(n => n.dependsOn.every(dep => completedNodes.has(dep)));
      
      if (readyNodes.length === 0) {
        throw new Error("Deadlock detected in DAG: no nodes have all dependencies met.");
      }

      // Execute ready nodes in parallel
      const results = await Promise.all(readyNodes.map(async (node) => {
        if (node.agent === "approval") {
          const approvalId = `approval-${node.id}-${runId}`;
          
          await step.run(`post-approval-${node.id}`, async () => {
             const blocks = approvalBlocks(
               `Approval Required: ${node.id}`,
               node.instruction,
               runId,
               node.id
             );
             await postToThread(slackChannelId, slackThreadTs, `⚠️ *Approval Required* for step: \`${node.id}\``, { blocks }, teamId);
          });

          const decision = await step.waitForEvent(`wait-approval-${node.id}`, {
             event: `app/dag.approval/${runId}/${node.id}`,
             timeout: "24h",
          });
          
          if (!decision || decision.data.decision === "rejected") {
             await step.run(`approval-reject-${node.id}`, async () => {
                await postToThread(slackChannelId, slackThreadTs, `❌ Workflow Halted: Step \`${node.id}\` was rejected.\nReason: ${decision?.data.feedback || "Timeout"}`, undefined, teamId);
             });
             throw new Error(`Approval rejected for ${node.id}`);
          }
          
          return `Approved. Feedback: ${decision.data.feedback || "No feedback provided."}`;
        }

        return await step.run(`exec-${node.id}`, async () => {
          let context = `You are executing step '${node.id}' in a multi-step workflow.\n\n`;
          if (node.dependsOn.length > 0) {
            context += `--- OUTPUTS FROM PREVIOUS STEPS ---\n`;
            node.dependsOn.forEach(dep => {
              context += `[Step: ${dep}]\n${nodeOutputs[dep]}\n\n`;
            });
          }
          context += `--- YOUR INSTRUCTION ---\n${node.instruction}`;

          return await runToolUseLoop(context, {
            systemPrompt: `You are the ${node.agent} agent. You are participating in a coordinated workflow. Execute your instruction thoroughly based on the provided context outputs. You must use your tools to accomplish the task.`,
            tools: AGENT_TOOLS_MAP[node.agent] || generalAgentTools,
            context: { slackUserId, slackChannelId, slackThreadTs, runId },
            maxIterations: 10,
            temperature: 0.4,
            maxTokens: 4096,
            agentName: node.agent
          });
        });
      }));

      // Store results and update completed set
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
