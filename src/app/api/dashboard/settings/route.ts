import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceById, updateWorkspace } from "@/db";
import { verifyWorkspaceId } from "@/utils/session";

// GET /api/dashboard/settings — returns customization settings for the current workspace
export async function GET(request: NextRequest) {
  const validatedId = request.headers.get("x-validated-workspace-id");
  const rawCookie = request.cookies.get("kh_auth_session")?.value;
  const workspaceId = validatedId || (rawCookie ? await verifyWorkspaceId(rawCookie) : null);

  if (!workspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ws = await getWorkspaceById(workspaceId);
    if (!ws || ws.length === 0) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const workspace = ws[0];
    return NextResponse.json({
      agentName: workspace.agentName || "Klawhub",
      agentPersonality: workspace.agentPersonality || "",
      monthlyRunLimit: workspace.monthlyRunLimit,
      isActive: workspace.isActive,
      domain: workspace.domain,
      plan: workspace.plan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/dashboard/settings — updates customization settings for the current workspace
export async function POST(request: NextRequest) {
  const validatedId = request.headers.get("x-validated-workspace-id");
  const rawCookie = request.cookies.get("kh_auth_session")?.value;
  const workspaceId = validatedId || (rawCookie ? await verifyWorkspaceId(rawCookie) : null);

  if (!workspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { agentName, agentPersonality, monthlyRunLimit, isActive } = body;

    const updates: Record<string, any> = {};

    if (typeof agentName === "string" && agentName.trim().length > 0) {
      updates.agentName = agentName.trim();
    }
    if (typeof agentPersonality === "string") {
      updates.agentPersonality = agentPersonality.trim();
    }
    if (typeof monthlyRunLimit === "number" && monthlyRunLimit > 0) {
      updates.monthlyRunLimit = monthlyRunLimit;
    }
    if (typeof isActive === "boolean") {
      updates.isActive = isActive;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    await updateWorkspace(workspaceId, updates);

    return NextResponse.json({ success: true, updates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
