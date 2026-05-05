import { NextRequest, NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { signWorkspaceId } from "@/utils/session";
import { encrypt } from "@/integrations/crypto";

// Slack OAuth callback — exchanges code for token, creates workspace record
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/install?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/install?error=no_code", request.url)
    );
  }

  const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/install?error=not_configured", request.url)
    );
  }

  // Exchange code for access token via Slack OAuth v2
  try {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/slack/oauth`;

    const resp = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await resp.json();

    if (!data.ok || !data.team) {
      return NextResponse.redirect(
        new URL(
          `/install?error=oauth_failed&detail=${encodeURIComponent(data.error || "unknown")}`,
          request.url
        )
      );
    }

    // Create or update workspace record
    const { createWorkspace, upsertWorkspaceMember } = await import("@/db");

    // Encrypt bot token before storing
    const encryptedBotToken = data.bot_token ? encrypt(data.bot_token) : undefined;

    // The installer becomes workspace admin
    const installerUserId = data.authed_user?.id;
    const installerUserToken = data.authed_user?.access_token;

    // Get workspace name from bot token
    let workspaceName = data.team?.name || "Unknown Workspace";
    let workspaceDomain = data.team?.domain;
    let botUserId = "";

    if (data.bot_token) {
      try {
        const tempClient = new WebClient(data.bot_token);
        const botInfo = await tempClient.auth.test();
        botUserId = botInfo.user_id || "";
      } catch {
        // Bot info fetch failed — not critical
      }
    }

    // Get installer's real name
    let installerName: string | undefined;
    let installerEmail: string | undefined;
    if (installerUserToken) {
      try {
        const userClient = new WebClient(installerUserToken);
        const userInfo = await userClient.users.profile.get({ user: installerUserId! });
        installerName = userInfo.profile?.display_name || userInfo.profile?.real_name;
        installerEmail = userInfo.profile?.email;
      } catch {
        // User info fetch failed — not critical
      }
    }

    // Create workspace (upsert via unique slack_team_id)
    let workspaceId: string | null = null;

    try {
      const { getWorkspaceByTeamId } = await import("@/db");
      const existing = await getWorkspaceByTeamId(data.team.id);
      if (existing && existing.length > 0) {
        // Workspace exists — update it
        const { updateWorkspace } = await import("@/db");
        await updateWorkspace(existing[0].id, {
          slackBotUserId: botUserId,
          botToken: encryptedBotToken,
          name: workspaceName,
          domain: workspaceDomain,
          isActive: true,
        });
        workspaceId = existing[0].id;
      } else {
        // New workspace
        const [created] = await createWorkspace({
          slackTeamId: data.team.id,
          slackBotUserId: botUserId,
          botToken: encryptedBotToken,
          name: workspaceName,
          domain: workspaceDomain,
          plan: "free",
          monthlyRunLimit: 50,
          isActive: true,
        });
        workspaceId = created.id;
      }
    } catch {
      // Fallback: try to fetch existing workspace
      try {
        const { getWorkspaceByTeamId } = await import("@/db");
        const ws = await getWorkspaceByTeamId(data.team.id);
        if (ws && ws.length > 0) workspaceId = ws[0].id;
      } catch { /* give up */ }
    }

    // Add installer as workspace admin
    if (workspaceId && installerUserId) {
      await upsertWorkspaceMember(workspaceId, installerUserId, {
        slackUserName: installerName,
        slackUserEmail: installerEmail,
        isWorkspaceAdmin: true,
      });
    }

    // Redirect to success page — set workspace cookie so dashboard can identify the workspace
    const workspaceSlug = workspaceDomain || data.team.id;
    const redirectUrl = new URL(`/install?success=1&workspace=${encodeURIComponent(workspaceSlug)}`, request.url);
    const response = NextResponse.redirect(redirectUrl);

    // Store signed workspace ID in an httpOnly cookie
    if (workspaceId) {
      response.cookies.set("klawhub_workspace_id", signWorkspaceId(workspaceId), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days (renews on next install)
        path: "/",
      });
      // Also store workspace name for display (not httpOnly — readable by client)
      response.cookies.set("klawhub_workspace_name", workspaceName, {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[OAUTH] Installation failed:", message);
    return NextResponse.redirect(
      new URL(
        `/install?error=server_error`,
        request.url
      )
    );
  }
}
