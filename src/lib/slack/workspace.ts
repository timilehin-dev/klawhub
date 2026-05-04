import { getWorkspaceByTeamId, upsertWorkspaceMember, createWorkspace } from "@/lib/db";
import { getWorkspaceSlack, invalidateWorkspaceClient } from "@/lib/slack/client";

// ── Shared auth.test() cache — avoids redundant Slack API calls per event ──
let _authCache: { teamId: string; userId: string; team: string; user: string; ts: number } | null = null;
const AUTH_CACHE_TTL = 60_000; // 1 minute

async function getCachedAuth(teamId?: string) {
  if (_authCache && Date.now() - _authCache.ts < AUTH_CACHE_TTL && (!teamId || _authCache.teamId === teamId)) {
    return { team_id: _authCache.teamId, user_id: _authCache.userId, team: _authCache.team, user: _authCache.user };
  }
  const wsClient = await getWorkspaceSlack(teamId);
  const auth = await wsClient.auth.test();
  _authCache = {
    teamId: auth.team_id ?? "",
    userId: auth.user_id ?? "",
    team: auth.team || "",
    user: auth.user || "",
    ts: Date.now()
  };
  return auth;
}

/**
 * Ensures a Slack user is tracked as a workspace member.
 * Called fire-and-forget from event handlers — never blocks the main flow.
 */
export async function ensureMember(slackUserId: string, teamId?: string) {
  try {
    const auth = await getCachedAuth(teamId);
    const effectiveTeamId = teamId || auth.team_id;
    if (!effectiveTeamId) return;

    const ws = await getWorkspaceByTeamId(effectiveTeamId);
    if (!ws || ws.length === 0) return;

    const workspaceId = ws[0].id;

    const wsClient = await getWorkspaceSlack(teamId);
    let userName: string | undefined;
    try {
      const profile = await wsClient.users.profile.get({ user: slackUserId });
      userName = profile.profile?.display_name || profile.profile?.real_name;
    } catch { /* not critical */ }

    await upsertWorkspaceMember(workspaceId, slackUserId, { slackUserName: userName });
  } catch { /* entirely non-critical */ }
}

/**
 * Auto-creates a workspace record if the bot is installed but no workspace exists.
 */
export async function ensureWorkspaceExists(teamId?: string) {
  try {
    const auth = await getCachedAuth(teamId);
    const effectiveTeamId = teamId || auth.team_id;
    const botUserId = auth.user_id;
    if (!effectiveTeamId || !botUserId) return;

    const existing = await getWorkspaceByTeamId(effectiveTeamId);
    if (existing && existing.length > 0) return;

    const teamName = auth.team || auth.user || "Slack Workspace";

    await createWorkspace({
      slackTeamId: effectiveTeamId,
      slackBotUserId: botUserId,
      name: teamName,
      plan: "free",
      monthlyRunLimit: 50,
      isActive: true,
    });

    console.log(`[WORKSPACE] Auto-created workspace for ${effectiveTeamId} (${teamName})`);
  } catch (err) {
    console.error("[WORKSPACE] Auto-creation failed:", err);
  }
}

/**
 * Checks if a workspace has hit its monthly usage limit.
 */
export async function checkUsageLimit(teamId?: string): Promise<{ allowed: boolean; used: number; limit: number } | null> {
  try {
    const auth = await getCachedAuth(teamId);
    const effectiveTeamId = teamId || auth.team_id;
    if (!effectiveTeamId) return null;

    const ws = await getWorkspaceByTeamId(effectiveTeamId);
    if (!ws || ws.length === 0) return null;

    const { checkWorkspaceUsageLimit } = await import("@/lib/db");
    return await checkWorkspaceUsageLimit(ws[0].id);
  } catch {
    return null;
  }
}
