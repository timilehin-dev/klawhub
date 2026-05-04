import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceIntegrations, disconnectIntegration } from "@/lib/integrations/store";

// GET /api/integrations/manage?workspaceId=xxx — list active integrations
export async function GET(request: NextRequest) {
  // Prefer the middleware-validated header, fall back to query param
  const validatedId = request.headers.get("x-validated-workspace-id");
  const { searchParams } = new URL(request.url);
  const workspaceId = validatedId || searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const integrations = await getWorkspaceIntegrations(workspaceId);
    // Don't expose encrypted tokens
    const safe = integrations.map((i: { id: string; provider: string; status: string; externalAccountId: string | null; externalAccountName: string | null; externalAccountEmail: string | null; scope: string | null; lastUsedAt: Date | null; createdAt: Date | null }) => ({
      id: i.id,
      provider: i.provider,
      status: i.status,
      externalAccountId: i.externalAccountId,
      externalAccountName: i.externalAccountName,
      externalAccountEmail: i.externalAccountEmail,
      scope: i.scope,
      lastUsedAt: i.lastUsedAt,
      createdAt: i.createdAt,
    }));
    return NextResponse.json({ integrations: safe });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list integrations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/integrations/manage?integrationId=xxx — disconnect an integration
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const integrationId = searchParams.get("integrationId");

  if (!integrationId) {
    return NextResponse.json({ error: "integrationId is required" }, { status: 400 });
  }

  try {
    await disconnectIntegration(integrationId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to disconnect";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
