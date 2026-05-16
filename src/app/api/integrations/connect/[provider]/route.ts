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
    const { isComposio } = getProviderCredentials(provider);
    
    if (isComposio) {
      const { getComposioAuthUrl } = await import("@/integrations/composio");
      const { origin } = new URL(request.url);
      const callbackUrl = `${origin}/api/integrations/composio/callback?workspaceId=${workspaceId}&providerId=${providerId}`;
      
      const authData = await getComposioAuthUrl(workspaceId, provider.composioApp || providerId, callbackUrl);
      if (authData?.redirectUrl) {
        return NextResponse.json({ 
          authUrl: authData.redirectUrl, 
          provider: provider.id, 
          providerName: provider.name 
        });
      } else {
        throw new Error("Composio could not generate an authorization URL. Ensure your COMPOSIO_API_KEY is correct.");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider not configured";
    console.error(`[OAuth Connect Error] ${providerId}: ${message}`);
    return NextResponse.json({ 
      error: message, 
      code: "MISSING_CONFIG",
      provider: providerId 
    }, { status: 400 });
  }

  // HMAC-signed state with timestamp (prevents forgery + replay)
  const state = createSignedOAuthState(providerId, workspaceId);

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/integrations/callback/${providerId}`;
  const authUrl = buildAuthUrl(provider, state, redirectUri);

  return NextResponse.json({ authUrl, provider: provider.id, providerName: provider.name });
}
