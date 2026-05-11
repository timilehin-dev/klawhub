import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/integrations/providers/registry";
import { completeOAuthFlow } from "@/integrations/oauth";
import { getWorkspaceById } from "@/db";
import { verifyOAuthState } from "@/utils/session";

// GET /api/integrations/callback/[provider]?code=xxx&state=xxx
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);

  if (!provider) {
    return NextResponse.redirect(new URL(`/dashboard?error=unknown_provider`, request.url));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  if (error) {
    return NextResponse.redirect(
      new URL(`/dashboard?error=${encodeURIComponent(error)}&provider=${providerId}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL(`/dashboard?error=missing_params&provider=${providerId}`, request.url)
    );
  }

  // Verify HMAC-signed state (prevents forgery and replay attacks)
  const parsedState = verifyOAuthState(state);
  if (!parsedState || parsedState.provider !== providerId) {
    console.error(`[INTEGRATIONS] Invalid or expired OAuth state for ${providerId}`);
    return NextResponse.redirect(
      new URL(`/dashboard?error=invalid_state&provider=${providerId}`, request.url)
    );
  }

  const workspaceId = parsedState.workspaceId;
  const ws = await getWorkspaceById(workspaceId);
  if (!ws || ws.length === 0) {
    return NextResponse.redirect(
      new URL(`/dashboard?error=workspace_not_found&provider=${providerId}`, request.url)
    );
  }

  try {
    const { origin } = new URL(request.url);
    const redirectUri = `${origin}/api/integrations/callback/${providerId}`;

    await completeOAuthFlow(provider, code, redirectUri, ws[0].id);

    return NextResponse.redirect(
      new URL(
        `/dashboard?success=integration&provider=${providerId}&name=${encodeURIComponent(provider.name)}`,
        request.url
      )
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth flow failed";
    console.error(`[INTEGRATIONS] OAuth callback failed for ${providerId}:`, message);
    return NextResponse.redirect(
      new URL(
        `/dashboard?error=oauth_failed&provider=${providerId}`,
        request.url
      )
    );
  }
}
