import { getWorkspaceByTeamId, upsertWorkspaceMember, createWorkspace, updateWorkspace } from "@/lib/db";
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
 * Auto-creates a workspace record if the bot is installed but no workspace exists.
 * This handles the case where the Slack app was installed but the OAuth callback
 * didn't create the workspace (e.g., socket mode, manual install, etc.)
 * Called fire-and-forget from event handlers.
 */
export async function ensureWorkspaceExists() {
  try {
    const auth = await slack.auth.test();
    const teamId = auth.team_id;
    const botUserId = auth.user_id;
    if (!teamId || !botUserId) return;

    // Check if workspace already exists
    const existing = await getWorkspaceByTeamId(teamId);
    if (existing && existing.length > 0) return;

    // Create workspace from bot info
    const teamName = auth.team || auth.user || "Slack Workspace";

    await createWorkspace({
      slackTeamId: teamId,
      slackBotUserId: botUserId,
      name: teamName,
      plan: "free",
      monthlyRunLimit: 50,
      isActive: true,
    });

    console.log(`[WORKSPACE] Auto-created workspace for ${teamId} (${teamName})`);
  } catch (err) {
    // Non-critical — don't throw
    console.error("[WORKSPACE] Auto-creation failed:", err);
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
