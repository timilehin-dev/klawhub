import { NextResponse } from 'next/server';
import { upsertWorkspace } from '@/db/workspaces';

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || process.env.NEXT_PUBLIC_SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;

const SLACK_SCOPES = [
  "commands",
  "chat:write",
  "chat:write.public",
  "chat:write.customize",
  "app_mentions:read",
  "users:read",
  "channels:read",
  "groups:read",
  "im:read",
  "im:history",
  "channels:history",
  "groups:history",
  "reactions:read",
  "files:read",
  "files:write",
];
const SLACK_USER_SCOPES = ["search:read"];

export async function GET(request: Request) {
  if (!SLACK_CLIENT_ID) {
    return NextResponse.json({ error: 'Slack Client ID is not configured.' }, { status: 500 });
  }

  const { searchParams, origin, pathname } = new URL(request.url);
  const code = searchParams.get('code');
  
  // If no code is present, this is the start of the OAuth flow — redirect to Slack
  if (!code) {
    const redirectUri = searchParams.get('redirect_uri');
    const params = new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      scope: SLACK_SCOPES.join(","),
      user_scope: SLACK_USER_SCOPES.join(","),
    });

    if (redirectUri) {
      params.set("redirect_uri", redirectUri);
    }

    const slackOAuthUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    return NextResponse.redirect(slackOAuthUrl);
  }

  // If code is present, this is the callback — exchange code for tokens
  if (!SLACK_CLIENT_SECRET) {
    console.error("[SLACK-OAUTH] Missing SLACK_CLIENT_SECRET. Cannot exchange code.");
    return NextResponse.redirect(`${origin}/install?error=missing_secret`);
  }

  try {
    const exchangeResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        // The redirect_uri must match exactly what was used in the first step
        redirect_uri: `${origin}${pathname}`, 
      }),
    });

    const data = await exchangeResponse.json();

    if (!data.ok) {
      console.error("[SLACK-OAUTH] Token exchange failed:", data.error);
      return NextResponse.redirect(`${origin}/install?error=${data.error}`);
    }

    // Success! Save/Update the workspace in our database
    await upsertWorkspace({
      slackTeamId: data.team.id,
      slackBotUserId: data.bot_user_id,
      botToken: data.access_token,
      name: data.team.name,
      isActive: true,
    });

    // Redirect to the install page with a success message
    return NextResponse.redirect(`${origin}/install?success=1&workspace=${encodeURIComponent(data.team.name)}`);
  } catch (error) {
    console.error("[SLACK-OAUTH] Error during token exchange:", error);
    return NextResponse.redirect(`${origin}/install?error=exchange_error`);
  }
}