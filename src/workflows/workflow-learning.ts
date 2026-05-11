import { inngest } from "./client";
import { getWorkspaceByTeamId, getDb } from "@/db";
import { workflowLearnings } from "@/db/schema";
import { slack } from "@/integrations/slack/client";

/**
 * Workflow Learning Loop
 * Listens for specific reactions on bot messages to capture positive/negative feedback.
 * 
 * Trigger: slack/event.received (type: reaction_added)
 * Reactions: 
 *   - 👍: Positive feedback
 *   - 👎: Negative feedback
 *   - 🧠: Insight / Knowledge capture
 *   - 💡: Tool suggestion / Correction
 */

export const workflowLearningWorkflow = inngest.createFunction(
  { id: "workflow-learning", name: "Workflow Learning Loop" },
  { event: "slack/event.received" },
  async ({ event, step }) => {
    const { event: slackEvent, teamId } = event.data;

    // 1. Only process "reaction_added"
    if (slackEvent.type !== "reaction_added") return;

    const reaction = slackEvent.reaction;
    const reactionUser = slackEvent.user;
    const channelId = slackEvent.item.channel;
    const messageTs = slackEvent.item.ts;

    // 2. Filter reactions we care about
    const validReactions = ["thumbsup", "thumbsdown", "brain", "bulb"];
    if (!validReactions.includes(reaction)) return;

    // 3. Resolve workspace
    const workspace = await step.run("get-workspace", async () => {
      if (!teamId) return null;
      const ws = await getWorkspaceByTeamId(teamId);
      return ws && ws.length > 0 ? ws[0] : null;
    });

    if (!workspace) return;

    // 4. Fetch the message context from Slack
    const context = await step.run("get-message-context", async () => {
      const resp = await slack.conversations.replies({
        channel: channelId,
        ts: messageTs,
        limit: 1,
        inclusive: true
      });
      const msg = resp.messages?.[0];
      if (!msg) return null;

      return {
        text: msg.text,
        botId: msg.bot_id,
        user: msg.user,
        ts: msg.ts
      };
    });

    if (!context) return;

    // 5. Save to workflow_learnings
    await step.run("save-learning", async () => {
      const db = getDb();
      const rating = reaction === "thumbsup" ? 1 : 
                     reaction === "thumbsdown" ? -1 : 0;
      
      await db.insert(workflowLearnings).values({
        workspaceId: workspace.id,
        slackUserId: reactionUser,
        category: "general",
        triggerPrompt: context.text || "No message text",
        feedback: `Reaction :${reaction}: added by user`,
        correction: `Manual feedback: ${reaction}`,
        rating: rating,
      });
    });

    // 6. Visual feedback (optional)
    await step.run("acknowledge-feedback", async () => {
        try {
            await slack.reactions.add({
                channel: channelId,
                timestamp: messageTs,
                name: "heart"
            });
        } catch { /* already reacted */ }
    });
  }
);
