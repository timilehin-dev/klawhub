import { WebClient } from "@slack/web-api";
import { getWorkspaceByTeamId } from "@/db";
import { decrypt } from "@/integrations/crypto";
import { toSlackMrkdwn } from "@/utils/slack-mrkdwn";

// Per-workspace client cache (survives across requests in same serverless instance)
const clientCache = new Map<string, WebClient>();
// Per-workspace workspaceId cache (populated alongside client cache)
const workspaceIdCache = new Map<string, string>();

// Pre-warmed default client (env var token) — avoids DB lookup on every first request
let _prewarmedDefault: WebClient | null = null;
function getPrewarmedDefault(): WebClient {
  if (!_prewarmedDefault) {
    const token = process.env.SLACK_BOT_TOKEN || process.env.NEXT_PUBLIC_SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    _prewarmedDefault = new WebClient(token);
  }
  return _prewarmedDefault;
}

/**
 * Get a workspace-specific Slack WebClient.
 * Falls back to SLACK_BOT_TOKEN env var if no workspace token is stored.
 * Caches both client and workspaceId to avoid duplicate DB lookups.
 */
export async function getWorkspaceSlack(teamId?: string): Promise<WebClient> {
  if (!teamId) return getPrewarmedDefault();

  // Check cache first
  const cached = clientCache.get(teamId);
  if (cached) return cached;

  // Try DB lookup for workspace-specific token (OAuth-installed workspaces)
  try {
    const ws = await getWorkspaceByTeamId(teamId);
    if (ws && ws.length > 0) {
      // Cache workspaceId alongside the client
      if (ws[0].id) workspaceIdCache.set(teamId, ws[0].id);

      if (ws[0].botToken) {
        let token: string;
        try {
          token = decrypt(ws[0].botToken);
        } catch {
          token = ws[0].botToken; // Legacy plaintext fallback
        }
        const client = new WebClient(token);
        clientCache.set(teamId, client);
        return client;
      }
    }
  } catch (err) {
    console.error(`[Slack Client] Error fetching workspace or decrypting token for team ${teamId}:`, err);
  }

  // Fallback: use default token and cache it for this teamId
  const client = getPrewarmedDefault();
  clientCache.set(teamId, client);
  return client;
}

/**
 * Get cached workspaceId for a team (populated by getWorkspaceSlack).
 * Returns undefined if not yet cached (caller should do their own lookup).
 */
export function getCachedWorkspaceId(teamId?: string): string | undefined {
  if (!teamId) return undefined;
  return workspaceIdCache.get(teamId);
}

/**
 * Invalidate a cached workspace client (call after token refresh / reinstall).
 */
export function invalidateWorkspaceClient(teamId: string) {
  clientCache.delete(teamId);
  workspaceIdCache.delete(teamId);
}

// ── Legacy singleton (for backward compat — uses default SLACK_BOT_TOKEN) ──

let _defaultSlack: WebClient | null = null;

function getDefaultSlack(): WebClient {
  if (!_defaultSlack) {
    const token = process.env.SLACK_BOT_TOKEN || process.env.NEXT_PUBLIC_SLACK_BOT_TOKEN;
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
    text: toSlackMrkdwn(text),
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
    text: toSlackMrkdwn(text),
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
    text: toSlackMrkdwn(text),
    ...options,
  });
}

export async function addReaction(channel: string, timestamp: string, emoji: string, teamId?: string) {
  const client = await getWorkspaceSlack(teamId);
  try {
    return await client.reactions.add({ channel, timestamp, name: emoji });
  } catch (error: any) {
    // Slack API errors often have a 'code' or specific error types. Relying on message string is fragile.
    // For now, keeping as is, but noting as a potential area for improvement.
    if (error?.data?.error === "already_reacted" || error?.message?.includes("already_reacted")) {
      console.warn(`[Slack] Reaction ${emoji} already added to ${timestamp}`);
      return;
    }
    throw error;
  }
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

// ── Passive Listening & Proactive Support Helpers ──

const channelNameCache = new Map<string, string>();

/** Fetch and cache channel name to avoid hitting Slack rate limits. */
export async function getChannelName(channelId: string, teamId?: string): Promise<string | undefined> {
  const cached = channelNameCache.get(channelId);
  if (cached) return cached;

  try {
    const client = await getWorkspaceSlack(teamId);
    const info = await client.conversations.info({ channel: channelId });
    if (info.ok && info.channel?.name) {
      channelNameCache.set(channelId, info.channel.name);
      return info.channel.name;
    }
  } catch {
    // Non-critical: ignore errors and return undefined
  }
  return undefined;
}

/** Get the decrypted bot token for direct HTTP fetches or outside tool use. */
export async function getWorkspaceToken(teamId?: string): Promise<string> {
  if (!teamId) {
    const token = process.env.SLACK_BOT_TOKEN || process.env.NEXT_PUBLIC_SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    return token;
  }

  const ws = await getWorkspaceByTeamId(teamId);
  if (ws && ws.length > 0 && ws[0].botToken) {
    try {
      return decrypt(ws[0].botToken);
    } catch {
      return ws[0].botToken;
    }
  }

  const token = process.env.SLACK_BOT_TOKEN || process.env.NEXT_PUBLIC_SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  return token;
}

/** Download a file directly from Slack using authorization token. */
export async function downloadSlackFile(fileUrl: string, teamId?: string): Promise<Buffer> {
  const token = await getWorkspaceToken(teamId);
  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Slack file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** List all public channels the bot is a member of. */
export async function listUserChannels(teamId?: string) {
  const client = await getWorkspaceSlack(teamId);
  const result = await client.conversations.list({
    types: "public_channel,private_channel",
  });

  if (!result.ok) throw new Error("Failed to list Slack channels");

  // Filter for channels where is_member is true
  return (result.channels || []).filter(c => c.is_member).map(c => ({
    id: c.id!,
    name: c.name!,
  }));
}

/** Get recent message history for a channel. Messages are NOT stored. */
export async function getChannelHistory(channelId: string, limit: number = 20, teamId?: string) {
  const client = await getWorkspaceSlack(teamId);
  const result = await client.conversations.history({
    channel: channelId,
    limit,
  });

  if (!result.ok) throw new Error(`Failed to fetch history for channel ${channelId}`);

  return (result.messages || []).map(m => ({
    user: m.user,
    text: m.text || "",
    ts: m.ts!,
    thread_ts: m.thread_ts,
  }));
}


/** Get all messages in a thread. */
export async function getThreadReplies(channelId: string, threadTs: string, teamId?: string) {
  const client = await getWorkspaceSlack(teamId);
  const result = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
  });

  if (!result.ok) throw new Error(`Failed to fetch thread replies for ${threadTs}`);

  return (result.messages || []).map(m => ({
    user: m.user,
    text: m.text || "",
    ts: m.ts!,
    thread_ts: m.thread_ts,
  }));
}
