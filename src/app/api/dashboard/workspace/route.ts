import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceById, getWorkspaceStats, checkWorkspaceUsageLimit, getWorkspaceMembers } from "@/lib/db";
import { getWorkspaceIntegrations } from "@/lib/integrations/store";

// GET /api/dashboard/workspace — returns workspace info from cookie
export async function GET(request: NextRequest) {
  const workspaceId = request.cookies.get("klawhub_workspace_id")?.value;

  if (!workspaceId) {
    return NextResponse.json({ workspace: null });
  }

  try {
    const ws = await getWorkspaceById(workspaceId);
    if (!ws || ws.length === 0) {
      return NextResponse.json({ workspace: null });
    }

    const workspace = ws[0];

    const [stats, usage, members, integrations] = await Promise.all([
      getWorkspaceStats(workspaceId),
      checkWorkspaceUsageLimit(workspaceId),
      getWorkspaceMembers(workspaceId),
      getWorkspaceIntegrations(workspaceId),
    ]);

    return NextResponse.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        domain: workspace.domain,
        plan: workspace.plan,
        isActive: workspace.isActive,
        installedAt: workspace.installedAt,
        memberCount: stats.activeMembers,
      },
      stats,
      usage,
      members: members.map((m) => ({
        id: m.id,
        slackUserId: m.slackUserId,
        slackUserName: m.slackUserName,
        isWorkspaceAdmin: m.isWorkspaceAdmin,
        lastActiveAt: m.lastActiveAt,
      })),
      integrations: integrations.map((i) => ({
        id: i.id,
        provider: i.provider,
        status: i.status,
        externalAccountName: i.externalAccountName,
        externalAccountEmail: i.externalAccountEmail,
        scope: i.scope,
        lastUsedAt: i.lastUsedAt,
        createdAt: i.createdAt,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch workspace";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
