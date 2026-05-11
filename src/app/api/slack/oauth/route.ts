import { NextResponse } from 'next/server';

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || process.env.NEXT_PUBLIC_SLACK_CLIENT_ID;
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

  const { searchParams } = new URL(request.url);
  const redirectUri = searchParams.get('redirect_uri'); // Allow client to pass redirect_uri if needed

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