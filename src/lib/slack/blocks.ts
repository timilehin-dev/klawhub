// ── Block Kit builders for Slack interactive messages ──

/**
 * Create an approval message with Approve/Reject buttons.
 * Used for build specs and document outlines that need human review.
 */
export function approvalBlocks(
  title: string,
  body: string,
  referenceId: string,
  actionPrefix: string
) {
  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: `*${title}*\n\n${body}`,
      },
    },
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
