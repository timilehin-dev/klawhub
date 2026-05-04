/**
 * Inngest Message Handler
 *
 * Replaces the fire-and-forget processSlackEvent() call in the HTTP handler.
 * Runs in Inngest's execution environment with up to 15-minute timeouts
 * and built-in retries — solving the Vercel serverless termination issue.
 *
 * Flow:
 *   HTTP handler → inngest.send("slack/message.received") → this function
 *   Step 1: addReaction("eyes")
 *   Step 2: processSlackEvent (classify → dispatch/respond)
 */

import { inngest } from "../client";
import { processSlackEvent, type SlackEvent } from "@/lib/events/process";
import { addReaction } from "@/lib/slack/client";

interface MessageEventData {
  event: SlackEvent;
  eventId: string;
  teamId?: string;
}

export const messageHandlerWorkflow = inngest.createFunction(
  {
    id: "slack-message-handler",
    name: "Slack Message Handler",
    retries: 1, // 1 retry on failure — prevents double-posting on transient errors
    concurrency: [
      {
        // Limit per-channel to prevent flooding
        limit: 3,
        key: "event.data.event.channel",
      },
    ],
  },
  { event: "slack/message.received" },
  async ({ event, step }): Promise<void> => {
    const { event: slackEvent, eventId, teamId } = event.data as MessageEventData;

    const channelId = slackEvent.channel as string;
    const messageTs = slackEvent.ts as string;

    // Step 1: Add "eyes" reaction — immediate visual feedback
    await step.run("add-reaction", async () => {
      try {
        await addReaction(channelId, messageTs, "eyes", teamId);
      } catch (e) {
        // Non-critical — don't fail the whole workflow for a reaction
        console.warn("[MSG-HANDLER] addReaction failed:", e);
      }
    });

    // Step 2: Process the message (classify, respond, dispatch)
    // This calls the EXISTING processSlackEvent logic — all the classification,
    // thread reply handling, approval patterns, and Inngest dispatch logic is preserved.
    await step.run("process-message", async () => {
      await processSlackEvent({ event: slackEvent, eventId, teamId });
    });
  }
);
