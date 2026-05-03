import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { buildSquadWorkflow } from "@/lib/inngest/functions/build-squad";
import { researchWorkflow } from "@/lib/inngest/functions/research-task";
import { documentWorkflow } from "@/lib/inngest/functions/document-task";
import { analyticsWorkflow } from "@/lib/inngest/functions/analytics-task";
import { scheduleRunnerWorkflow } from "@/lib/inngest/functions/schedule-runner";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [buildSquadWorkflow, researchWorkflow, documentWorkflow, analyticsWorkflow, scheduleRunnerWorkflow],
});
