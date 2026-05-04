import { getWorkspaceSlack } from "@/lib/slack/client";

/**
 * Fetch recent thread messages from Slack to build conversation context.
 * Returns a formatted string of the thread history, excluding bot messages.
 */
export async function getThreadHistory(
  channelId: string,
  threadTs: string,
  teamId?: string,
  limit = 20
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

    // Filter to user messages only (exclude bot messages), build context
    const contextMessages: string[] = [];
    const messages = result.messages.slice(-limit); // most recent N messages

    for (const msg of messages) {
      // Skip bot messages (we only want human context)
      if (msg.bot_id || msg.subtype) continue;

      const text = (msg.text || "").replace(/<@[^>]+>/g, "").trim();
      if (!text) continue;

      // Truncate very long messages to keep context manageable
      const truncated = text.length > 500 ? text.slice(0, 500) + "..." : text;
      contextMessages.push(truncated);
    }

    if (contextMessages.length === 0) return "";

    // Take last 10 messages to keep context window reasonable
    const recent = contextMessages.slice(-10);
    return recent.join("\n");
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

  parts.push(`PREVIOUS REQUEST:\n${previousRequest.slice(0, 500)}`);

  if (previousResult?.spec) {
    parts.push(`PREVIOUS SPEC:\n${previousResult.spec.slice(0, 1000)}`);
  }

  if (previousResult?.error) {
    parts.push(`PREVIOUS ERROR:\n${previousResult.error.slice(0, 500)}`);
  }

  if (previousResult?.evaluation) {
    parts.push(`PREVIOUS QA EVALUATION:\n${previousResult.evaluation.slice(0, 500)}`);
  }

  if (threadHistory) {
    parts.push(`THREAD CONVERSATION:\n${threadHistory}`);
  }

  return parts.join("\n\n---\n\n");
}
