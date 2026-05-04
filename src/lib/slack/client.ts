import { WebClient } from "@slack/web-api";
import { getWorkspaceByTeamId } from "@/lib/db";
import { decrypt } from "@/lib/integrations/crypto";

// Per-workspace client cache (survives across requests in same serverless instance)
const clientCache = new Map<string, WebClient>();

/**
 * Get a workspace-specific Slack WebClient.
 * Falls back to SLACK_BOT_TOKEN env var if no workspace token is stored.
 */
export async function getWorkspaceSlack(teamId?: string): Promise<WebClient> {
  if (!teamId) {
    // No team context — use default env var token
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    return new WebClient(token);
  }

  // Check cache first
  let client = clientCache.get(teamId);
  if (client) return client;

  // Look up workspace token from DB
  try {
    const ws = await getWorkspaceByTeamId(teamId);
    if (ws && ws.length > 0 && ws[0].botToken) {
      // Decrypt the stored bot token (handle both encrypted and legacy plaintext)
      let token: string;
      try {
        token = decrypt(ws[0].botToken);
      } catch {
        // Legacy: token was stored before encryption was added
        token = ws[0].botToken;
      }
      client = new WebClient(token);
      clientCache.set(teamId, client);
      return client;
    }
  } catch {
    // DB lookup failed — fall through to default token
  }

  // Fallback to default token
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set and no workspace token found");
  client = new WebClient(token);
  clientCache.set(teamId, client);
  return client;
}

/**
 * Invalidate a cached workspace client (call after token refresh / reinstall).
 */
export function invalidateWorkspaceClient(teamId: string) {
  clientCache.delete(teamId);
}

// ── Legacy singleton (for backward compat — uses default SLACK_BOT_TOKEN) ──

let _defaultSlack: WebClient | null = null;

function getDefaultSlack(): WebClient {
  if (!_defaultSlack) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    _defaultSlack = new WebClient(token);
  }
  return _defaultSlack;
}

export const slack = new Proxy({} as WebClient, {
  get(_, prop) {
    return (getDefaultSlack() as any)[prop];
  },
});

// ── Helper functions — accept optional teamId for multi-workspace support ──

export async function postToThread(
  channel: string,
  threadTs: string,
  text: string,
  options?: { blocks?: unknown[] },
  teamId?: string
) {
  const client = await getWorkspaceSlack(teamId);
  return client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    ...options,
  });
}

export async function updateMessage(
  channel: string,
  ts: string,
  text: string,
  options?: { blocks?: unknown[] },
  teamId?: string
) {
  const client = await getWorkspaceSlack(teamId);
  return client.chat.update({
    channel,
    ts,
    text,
    ...options,
  });
}

export async function postEphemeral(
  channel: string,
  userId: string,
  text: string,
  options?: { blocks?: unknown[] },
  teamId?: string
) {
  const client = await getWorkspaceSlack(teamId);
  return client.chat.postEphemeral({
    channel,
    user: userId,
    text,
    ...options,
  });
}

export async function addReaction(channel: string, timestamp: string, emoji: string, teamId?: string) {
  const client = await getWorkspaceSlack(teamId);
  return client.reactions.add({ channel, timestamp, name: emoji });
}

export async function removeReaction(channel: string, timestamp: string, emoji: string, teamId?: string) {
  const client = await getWorkspaceSlack(teamId);
  return client.reactions.remove({ channel, timestamp, name: emoji });
}

export async function uploadFile(
  channel: string,
  threadTs: string,
  content: string,
  filename: string,
  title: string,
  teamId?: string
) {
  const client = await getWorkspaceSlack(teamId);
  return client.files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    content,
    filename,
    title,
  });
}

export async function uploadBinaryFile(
  channel: string,
  threadTs: string,
  fileBuffer: Buffer,
  filename: string,
  title: string,
  teamId?: string
) {
  const client = await getWorkspaceSlack(teamId);
  return client.files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    file: fileBuffer as unknown as string,
    filename,
    title,
  });
}
