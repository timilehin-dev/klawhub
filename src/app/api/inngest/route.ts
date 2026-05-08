import { serve } from "inngest/next";
import { inngest } from "@/workflows/client";
import { messageHandlerWorkflow } from "@/workflows/message-handler";
import { commandChatWorkflow } from "@/workflows/command-chat";
import { buildSquadWorkflow } from "@/workflows/build-squad";
import { researchWorkflow } from "@/workflows/research-task";
import { documentWorkflow } from "@/workflows/document-task";
import { analyticsWorkflow } from "@/workflows/analytics-task";
import { scheduleRunnerWorkflow } from "@/workflows/schedule-runner";
import { heartbeatWorkflow } from "@/workflows/heartbeat";
import { taskMonitorWorkflow } from "@/workflows/task-monitor";
import { coordinatedTaskWorkflow } from "@/workflows/coordinated-task";
import { morningBriefWorkflow } from "@/workflows/morning-brief";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    messageHandlerWorkflow, 
    commandChatWorkflow, 
    buildSquadWorkflow, 
    coordinatedTaskWorkflow, 
    researchWorkflow, 
    documentWorkflow, 
    analyticsWorkflow, 
    scheduleRunnerWorkflow, 
    heartbeatWorkflow, 
    taskMonitorWorkflow,
    morningBriefWorkflow
  ],
});

