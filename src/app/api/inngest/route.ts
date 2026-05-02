import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { buildSquadWorkflow } from "@/lib/inngest/functions/build-squad";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [buildSquadWorkflow],
});
