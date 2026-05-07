import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceById, getWorkspaceStats, checkWorkspaceUsageLimit, getWorkspaceMembers } from "@/db";
import { getWorkspaceIntegrations } from "@/integrations/store";
import { verifyWorkspaceId } from "@/utils/session";

// GET /api/dashboard/workspace — returns workspace info from cookie
export async function GET(request: NextRequest) {
  // Prefer the middleware-validated header, fall back to cookie verification
  const validatedId = request.headers.get("x-validated-workspace-id");
  const rawCookie = request.cookies.get("kh_auth_session")?.value;
  const workspaceId = validatedId || (rawCookie ? await verifyWorkspaceId(rawCookie) : null);

  if (!workspaceId) {
    const cookiesList = request.cookies.getAll().map((c) => `${c.name}=${c.value ? c.value.slice(0, 15) + "..." : "empty"}`).join("; ");
    const sessionSecretPresent = !!process.env.SESSION_SECRET;
    const integrationKeyPresent = !!process.env.INTEGRATION_ENCRYPTION_KEY;
    
    let verifyError: string | null = null;
    let verifySuccessId: string | null = null;
    try {
      if (rawCookie) {
        verifySuccessId = await verifyWorkspaceId(rawCookie);
        if (!verifySuccessId) {
          verifyError = "verifyWorkspaceId returned null (signature mismatch or bad key)";
        }
      } else {
        verifyError = "No kh_auth_session cookie present in request";
      }
    } catch (err) {
      verifyError = err instanceof Error ? err.message : "Error during verification";
    }

    return NextResponse.json({
      workspace: null,
      debug: {
        validatedIdHeader: validatedId || "missing",
        rawCookiePresent: !!rawCookie,
        cookies: cookiesList || "none",
        verifyError,
        verifySuccessId,
        host: request.headers.get("host") || "unknown",
        env: {
          SESSION_SECRET: sessionSecretPresent,
          INTEGRATION_ENCRYPTION_KEY: integrationKeyPresent,
        }
      }
    });
  }

  try {
    const ws = await getWorkspaceById(workspaceId);
    if (!ws || ws.length === 0) {
      return NextResponse.json({
        workspace: null,
        debug: {
          error: "Workspace ID was validated but the record was not found in the database",
          workspaceId,
        }
      });
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
