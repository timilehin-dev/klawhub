import { inngest } from "./client";
import { getAllWorkspaces } from "@/db";
import { listUserChannels, getChannelHistory, postToThread } from "@/integrations/slack/client";
import { agentChat } from "@/core/llm";
import { COWORKER_VOICE_MODULE } from "@/core/agents/persona";

const CHECKIN_SYSTEM_PROMPT = `You are Klawhub — a senior coworker on this team. You have been asked to scan recent channel messages for anything you can help with.

${COWORKER_VOICE_MODULE}

CRITICAL RULES:
1. You MUST output EXACTLY "NONE" if there is nothing specific you can help with. Silence is ALWAYS better than noise.
2. NEVER output generic offers like "I can help coordinate" or "I can summarize discussions" — those are useless.
3. NEVER use the phrase "Proactive Suggestion" or "I noticed this thread was quiet" or "I noticed this was quiet and wanted to help out".
4. NEVER offer to "organize tasks", "track action items", or "answer general questions" unprompted.
5. You may ONLY reply if there is a SPECIFIC, UNANSWERED question or a CONCRETE stalled task in the messages.
6. Your reply must directly reference or answer something from the messages. If you can't point to a specific message you're responding to, output "NONE".
7. Keep it short — 1-3 sentences max. You're jumping into a conversation, not writing an essay.

Examples of valid replies:
- "That API endpoint was deprecated in v3 — you'll want to use /api/v3/users instead."
- "I can run those numbers for you if you share the spreadsheet."
- "Looks like the deploy got stuck — want me to check the logs?"

Examples of INVALID replies (output NONE instead):
- "I can help coordinate this channel!"
- "Let me know what you need help with!"
- "I noticed some interesting discussions..."
- Any generic offer without referencing a specific message`;

const MIN_HUMAN_MESSAGES = 3; // Don't bother analyzing channels with very few messages

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

          // Skip channels with too few human messages — nothing meaningful to analyze
          if (history.length < MIN_HUMAN_MESSAGES) continue;

          // 3. Analyze for unanswered questions or stalled tasks
          const analysisPrompt = `Review these recent messages from a Slack channel.
Is there a SPECIFIC unanswered question or a CONCRETE stalled task you can help with?

If YES, write a direct, natural reply addressing that specific message.
If NO (nothing specific to help with), output EXACTLY: NONE

Messages:
${history.map(m => `User ${m.user}: ${m.text}`).join("\n")}

Your reply (or NONE):`;

          const suggestion = await agentChat("general", [
            { role: "system", content: CHECKIN_SYSTEM_PROMPT },
            { role: "user", content: analysisPrompt }
          ], { temperature: 0.5, maxTokens: 300 }, { workspaceId: ws.id });

          // Validate: must not be NONE, must not contain banned phrases, must be substantive
          const trimmed = suggestion?.trim() || "";
          const isNone = trimmed.toUpperCase() === "NONE" || trimmed.length < 5;
          const hasBannedPhrases = /proactive suggestion|i noticed.*quiet|i can help coordinate|track action items|organize tasks|let me know what|answer general questions/i.test(trimmed);
          const isGenericOffer = /^(i can |i('d| would) be happy to |feel free to |let me know)/i.test(trimmed);

          if (!isNone && !hasBannedPhrases && !isGenericOffer) {
            // 4. Post to the last message thread (or channel)
            const lastMsg = history[0];
            await postToThread(
              channel.id,
              lastMsg.thread_ts || lastMsg.ts,
              trimmed,
              undefined,
              ws.slackTeamId
            );
          }
        }
      });
    }
  }
);