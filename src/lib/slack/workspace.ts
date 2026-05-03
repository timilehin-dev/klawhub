import { getWorkspaceByTeamId, upsertWorkspaceMember } from "@/lib/db";
import { slack } from "@/lib/slack/client";

/**
 * Ensures a Slack user is tracked as a workspace member.
 * Called fire-and-forget from event handlers — never blocks the main flow.
 * If no workspace exists yet (pre-install), silently does nothing.
 */
export async function ensureMember(slackUserId: string) {
  try {
    // Get the bot's team ID from Slack API
    const auth = await slack.auth.test();
    const teamId = auth.team_id;
    if (!teamId) return;

    // Check if workspace exists in DB
    const ws = await getWorkspaceByTeamId(teamId);
    if (!ws || ws.length === 0) return;

    const workspaceId = ws[0].id;

    // Get user profile info
    let userName: string | undefined;
    try {
      const profile = await slack.users.profile.get({ user: slackUserId });
      userName = profile.profile?.display_name || profile.profile?.real_name;
    } catch {
      // User profile fetch may fail — not critical
    }

    await upsertWorkspaceMember(workspaceId, slackUserId, {
      slackUserName: userName,
    });
  } catch {
    // This is entirely non-critical — never throw
  }
}

/**
 * Checks if a workspace has hit its monthly usage limit.
 * Returns null if no workspace is configured (allow by default).
 */
export async function checkUsageLimit(): Promise<{ allowed: boolean; used: number; limit: number } | null> {
  try {
    const auth = await slack.auth.test();
    const teamId = auth.team_id;
    if (!teamId) return null;

    const ws = await getWorkspaceByTeamId(teamId);
    if (!ws || ws.length === 0) return null;

    const { checkWorkspaceUsageLimit } = await import("@/lib/db");
    return await checkWorkspaceUsageLimit(ws[0].id);
  } catch {
    return null; // Allow if check fails
  }
}
