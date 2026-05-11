import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/integrations/providers/registry";
import { buildAuthUrl } from "@/integrations/oauth";
import { createSignedOAuthState } from "@/utils/session";

// GET /api/integrations/connect/[provider]?workspaceId=xxx
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);

  if (!provider) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  // Use the validated workspace ID from middleware (x-validated-workspace-id header)
  const workspaceId = request.headers.get("x-validated-workspace-id")
    || searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const { getProviderCredentials } = await import("@/integrations/providers/registry");
    getProviderCredentials(provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider not configured";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // HMAC-signed state with timestamp (prevents forgery + replay)
  const state = createSignedOAuthState(providerId, workspaceId);

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/integrations/callback/${providerId}`;
  const authUrl = buildAuthUrl(provider, state, redirectUri);

  return NextResponse.json({ authUrl, provider: provider.id, providerName: provider.name });
}
