import { inngest } from "./client";
import { getAllWorkspaces } from "@/db";
import { listUserChannels, getChannelHistory, postToThread } from "@/integrations/slack/client";
import { agentChat } from "@/core/llm";

export const agentCheckInWorkflow = inngest.createFunction(
  { id: "agent-check-in", name: "Agent Check-in", retries: 2 },
  { cron: "0 */4 * * *" }, // Every 4 hours
  async ({ step }): Promise<void> => {
    const workspaces = await step.run("get-all-workspaces", async () => {
      return await getAllWorkspaces();
    });

    for (const ws of workspaces) {
      await step.run(`proactive-check-${ws.id}`, async () => {
        // 1. Get channels the bot is in for this workspace
        const channels = await listUserChannels(ws.slackTeamId);

        for (const channel of channels) {
          // 2. Fetch recent history (Zero-Persistence: not saved to DB)
          let history = await getChannelHistory(channel.id, 15, ws.slackTeamId);
          if (ws.slackBotUserId) {
            history = history.filter(m => m.user !== ws.slackBotUserId);
          }

          if (history.length === 0) continue;

          // 3. Analyze for unanswered questions or silence
          const analysisPrompt = `Analyze the following Slack messages. 
          Are there any questions asked by users that haven't received a clear answer or resolution in the last few messages?
          
          If YES, provide a short, helpful suggestion or answer based on general knowledge. 
          If NO or if the bot has already replied recently, output "NONE".
          
          Messages:
          ${history.map(m => `User ${m.user}: ${m.text}`).join("\n")}
          
          Output ONLY the suggestion or "NONE".`;

          const suggestion = await agentChat("general", [
            { role: "system", content: "You are a proactive coworker. You help answer stale questions." },
            { role: "user", content: analysisPrompt }
          ], { temperature: 0.2, maxTokens: 500 }, { workspaceId: ws.id });

          if (suggestion && suggestion.toUpperCase() !== "NONE") {
            // 4. Post proactive suggestion to the last message thread (or channel)
            const lastMsg = history[0];
            await postToThread(
              channel.id,
              lastMsg.thread_ts || lastMsg.ts,
              `*Proactive Suggestion:* ${suggestion}\n\n_I noticed this thread was quiet and wanted to help out!_`,
              undefined,
              ws.slackTeamId
            );
          }
        }
      });
    }
  }
);