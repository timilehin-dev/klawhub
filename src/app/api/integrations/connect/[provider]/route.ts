import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/integrations/providers/registry";
import { buildAuthUrl } from "@/lib/integrations/oauth";
import { getWorkspaceByTeamId } from "@/lib/db";

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
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const ws = await getWorkspaceByTeamId(workspaceId);
  if (!ws || ws.length === 0) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const { getProviderCredentials } = await import("@/lib/integrations/providers/registry");
    getProviderCredentials(provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider not configured";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const nonce = crypto.randomUUID().slice(0, 8);
  const state = `${providerId}:${workspaceId}:${nonce}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectUri = `${appUrl}/api/integrations/callback/${providerId}`;
  const authUrl = buildAuthUrl(provider, state, redirectUri);

  return NextResponse.json({ authUrl, provider: provider.id, providerName: provider.name });
}
