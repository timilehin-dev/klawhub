import { serve } from "inngest/next";
import { inngest } from "@/workflows/client";
import { messageHandlerWorkflow } from "@/workflows/message-handler";
import { commandChatWorkflow } from "@/workflows/command-chat";
import { scheduleRunnerWorkflow } from "@/workflows/schedule-runner";
import { heartbeatWorkflow } from "@/workflows/heartbeat";
import { taskMonitorWorkflow } from "@/workflows/task-monitor";
import { morningBriefWorkflow } from "@/workflows/morning-brief";
import { agentCheckInWorkflow } from "@/workflows/agent-check-in";
import { workflowLearningWorkflow } from "@/workflows/workflow-learning";
import { dynamicDagWorkflow } from "@/workflows/dynamic-dag";
import { knowledgeIndexingWorkflow } from "@/workflows/knowledge-indexing";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    messageHandlerWorkflow, 
    commandChatWorkflow, 
    scheduleRunnerWorkflow, 
    heartbeatWorkflow, 
    taskMonitorWorkflow,
    morningBriefWorkflow,
    agentCheckInWorkflow,
    workflowLearningWorkflow,
    dynamicDagWorkflow,
    knowledgeIndexingWorkflow
  ],
});

