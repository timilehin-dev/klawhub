import { inngest } from "./client";

export const agentCheckInWorkflow = inngest.createFunction(
  { id: "agent-check-in", name: "Agent Check-in", retries: 2 },
  { cron: "0 */4 * * *" }, // Every 4 hours
  async ({ step }): Promise<void> => {
    // Have agents check for opportunities proactively
    await step.run("proactive-agent-check", async () => {
      // This would trigger agents to scan workspace and suggest tasks
      // For now, placeholder for future implementation
      console.log("[AGENT] Proactive check-in triggered");
    });
  }
);