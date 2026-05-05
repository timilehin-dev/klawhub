import { getWorkspaceSlack } from "@/integrations/slack/client";

/** Maximum bot messages to include in context (prevents token bloat). */
const MAX_BOT_MESSAGES = 5;
/** Maximum total messages to include. */
const MAX_TOTAL_MESSAGES = 20;
/** Maximum characters per message in context. */
const MAX_MESSAGE_LENGTH = 1000;

/**
 * Fetch recent thread messages from Slack to build conversation context.
 * Returns a formatted string of the thread history, INCLUDING bot messages.
 *
 * FIX #4 (Phase A): Previously, bot messages were excluded, which meant
 * the bot had no memory of its own responses. When a user said "make section 2 shorter",
 * the bot couldn't know what section 2 was because it filtered out its own output.
 *
 * Now: Bot messages are included (capped at MAX_BOT_MESSAGES) and formatted
 * as "[Klawhub]: {text}" to distinguish from human messages.
 */
export async function getThreadHistory(
  channelId: string,
  threadTs: string,
  teamId?: string,
  limit = MAX_TOTAL_MESSAGES
): Promise<string> {
  try {
    const slack = await getWorkspaceSlack(teamId);
    const result = await slack.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit,
      inclusive: true,
    });

    if (!result.messages || result.messages.length <= 1) {
      return "";
    }

    const messages = result.messages.slice(-limit);

    const userMessages: string[] = [];
    let botMessageCount = 0;

    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const text = (msg.text || "").replace(/<@[^>]+>/g, "").trim();
      if (!text) continue;

      const isBot = !!m.bot_id;
      const truncated = text.length > MAX_MESSAGE_LENGTH ? text.slice(0, MAX_MESSAGE_LENGTH) + "..." : text;

      if (isBot) {
        botMessageCount++;
        if (botMessageCount > MAX_BOT_MESSAGES) continue; // Cap bot messages
        userMessages.push(`[Klawhub]: ${truncated}`);
      } else if (!m.subtype) {
        // Human message (exclude subtypes like join/leave)
        userMessages.push(truncated);
      }
    }

    if (userMessages.length === 0) return "";

    return userMessages.join("\n");
  } catch (err) {
    console.error("[THREAD-CONTEXT] Failed to fetch thread history:", err);
    return "";
  }
}

/**
 * Build a context string for follow-up requests by combining:
 * - The previous run/task request
 * - Thread history
 * - The current follow-up message
 */
export function buildFollowupContext(
  previousRequest: string,
  previousResult?: { spec?: string; code?: string; evaluation?: string; error?: string },
  threadHistory?: string
): string {
  const parts: string[] = [];

  parts.push(`PREVIOUS REQUEST:\n${previousRequest.slice(0, 800)}`);

  if (previousResult?.spec) {
    parts.push(`PREVIOUS SPEC:\n${previousResult.spec.slice(0, 1500)}`);
  }

  if (previousResult?.error) {
    parts.push(`PREVIOUS ERROR:\n${previousResult.error.slice(0, 800)}`);
  }

  if (previousResult?.evaluation) {
    parts.push(`PREVIOUS QA EVALUATION:\n${previousResult.evaluation.slice(0, 800)}`);
  }

  if (previousResult?.code) {
    // Include first and last 50 lines for context without bloating
    const lines = previousResult.code.split("\n");
    const preview = lines.length > 100
      ? lines.slice(0, 50).join("\n") + "\n... (truncated) ...\n" + lines.slice(-50).join("\n")
      : previousResult.code;
    parts.push(`PREVIOUS CODE (preview):\n${preview.slice(0, 2000)}`);
  }

  if (threadHistory) {
    parts.push(`THREAD CONVERSATION:\n${threadHistory}`);
  }

  return parts.join("\n\n---\n\n");
}
