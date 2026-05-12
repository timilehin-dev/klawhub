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
          const analysisPrompt = `Review these recent messages from a channel. 
          Are there any unresolved questions or stalled discussions where you can jump in and help?
          
          If YES, write a natural, casual reply as a coworker jumping into the thread to help. 
          Do NOT use phrases like "Proactive Suggestion" or "I noticed this was quiet". Just answer the question or offer to do the work.
          If NO (or if you already replied), output exactly "NONE".
          
          Messages:
          ${history.map(m => `User ${m.user}: ${m.text}`).join("\n")}
          
          Your reply (or NONE):`;

          const suggestion = await agentChat("general", [
            { role: "system", content: "You are Klawhub, a highly competent, human-like senior coworker. Speak naturally, directly, and without robotic pleasantries." },
            { role: "user", content: analysisPrompt }
          ], { temperature: 0.7, maxTokens: 500 }, { workspaceId: ws.id });

          if (suggestion && suggestion.toUpperCase() !== "NONE") {
            // 4. Post proactive suggestion to the last message thread (or channel)
            const lastMsg = history[0];
            await postToThread(
              channel.id,
              lastMsg.thread_ts || lastMsg.ts,
              suggestion,
              undefined,
              ws.slackTeamId
            );
          }
        }
      });
    }
  }
);