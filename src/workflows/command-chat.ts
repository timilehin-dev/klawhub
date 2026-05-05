/**
 * Inngest Command Chat Handler
 *
 * Handles deferred chat responses for /klawhub slash commands.
 * The slash command returns "Thinking..." immediately, then this function
 * runs the LLM call and posts the response via response_url.
 */

import { inngest } from "./client";
import { chatAsAgent } from "@/core/agents/general";
import { getWorkspaceByTeamId } from "@/db";

interface CommandChatData {
  userId: string;
  text: string;
  responseUrl: string;
  teamId?: string;
}

export const commandChatWorkflow = inngest.createFunction(
  {
    id: "slack-command-chat",
    name: "Slack Command Chat Response",
    retries: 1,
  },
  { event: "slack/command.chat" },
  async ({ event, step }): Promise<void> => {
    const { userId, text, responseUrl, teamId } = event.data as CommandChatData;

    const responseText = await step.run("generate-response", async () => {
      // Resolve workspaceId for integration tools
      let workspaceId: string | undefined;
      try {
        if (teamId) {
          const ws = await getWorkspaceByTeamId(teamId);
          if (ws && ws.length > 0) workspaceId = ws[0].id;
        }
      } catch { /* non-critical */ }

      return chatAsAgent(userId, text, { workspaceId });
    });

    await step.run("post-response", async () => {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "in_channel",
          replace_original: true,
          text: responseText,
        }),
      });
    });
  }
);
