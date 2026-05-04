// ── Block Kit builders for Slack interactive messages ──

const SLACK_BLOCK_TEXT_LIMIT = 2900; // Slack's limit is 3000; keep margin for safety

/**
 * Split long text into chunks that fit Slack's block text limit.
 * Splits at newline boundaries when possible.
 */
function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen * 0.5) splitIdx = maxLen; // No good newline — hard split
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

/**
 * Create an approval message with Approve/Reject buttons.
 * Used for build specs and document outlines that need human review.
 * Automatically splits long text into multiple section blocks to avoid Slack's 3000-char limit.
 */
export function approvalBlocks(
  title: string,
  body: string,
  referenceId: string,
  actionPrefix: string
) {
  const fullText = `*${title}*\n\n${body}`;
  const chunks = splitText(fullText, SLACK_BLOCK_TEXT_LIMIT);

  const sectionBlocks = chunks.map((chunk) => ({
    type: "section" as const,
    text: {
      type: "mrkdwn" as const,
      text: chunk,
    },
  }));

  return [
    ...sectionBlocks,
    {
      type: "actions" as const,
      block_id: `${actionPrefix}_actions`,
      elements: [
        {
          type: "button" as const,
          action_id: `${actionPrefix}_approve`,
          text: { type: "plain_text" as const, text: "Approve" },
          style: "primary" as const,
          value: referenceId,
        },
        {
          type: "button" as const,
          action_id: `${actionPrefix}_reject`,
          text: { type: "plain_text" as const, text: "Reject" },
          style: "danger" as const,
          value: referenceId,
        },
      ],
    },
  ];
}

/**
 * Create a "completed" context block (replaces the action buttons after a decision).
 */
export function decisionContextBlock(decision: "approved" | "rejected", userId: string) {
  const icon = decision === "approved" ? "white_check_mark" : "x";
  const label = decision === "approved" ? "Approved" : "Rejected";
  return {
    type: "context" as const,
    elements: [
      {
        type: "mrkdwn" as const,
        text: `:${icon}: *${label}* by <@${userId}>`,
      },
    ],
  };
}

/**
 * Replace action buttons with a context block after user clicks.
 */
export function replaceActionsWithDecision(
  originalBlocks: unknown[],
  decision: "approved" | "rejected",
  userId: string
) {
  const contextBlock = decisionContextBlock(decision, userId);
  // Keep all blocks except the last actions block, then add context
  const nonActionBlocks = originalBlocks.filter(
    (b: any) => b.type !== "actions"
  );
  return [...nonActionBlocks, contextBlock];
}

/**
 * Create a retry button for failed builds.
 */
export function retryBlocks(
  runId: string,
  channelId: string,
  threadTs: string,
  userId: string,
  request: string
) {
  return [
    {
      type: "actions" as const,
      block_id: "retry_actions",
      elements: [
        {
          type: "button" as const,
          action_id: "retry_build",
          text: { type: "plain_text" as const, text: "Retry Build" },
          value: JSON.stringify({ runId, channelId, threadTs, userId, request }),
        },
      ],
    },
  ];
}
