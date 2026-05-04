import { WebClient } from "@slack/web-api";
import { getWorkspaceByTeamId } from "@/lib/db";
import { decrypt } from "@/lib/integrations/crypto";
import { toSlackMrkdwn } from "@/lib/utils/slack-mrkdwn";

// Per-workspace client cache (survives across requests in same serverless instance)
const clientCache = new Map<string, WebClient>();
// Per-workspace workspaceId cache (populated alongside client cache)
const workspaceIdCache = new Map<string, string>();

// Pre-warmed default client (env var token) — avoids DB lookup on every first request
let _prewarmedDefault: WebClient | null = null;
function getPrewarmedDefault(): WebClient {
  if (!_prewarmedDefault) {
    const token = process.env.SLACK_BOT_TOKEN;
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
  } catch {
    // DB lookup failed — fall through to default
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
