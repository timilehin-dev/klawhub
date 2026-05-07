import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceById, updateWorkspace } from "@/db";
import { verifyWorkspaceId } from "@/utils/session";

// GET /api/dashboard/skills — returns the list of enabled skills for the current workspace
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
      enabledSkills: workspace.enabledSkills || [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch skills";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/dashboard/skills — updates the list of enabled skills for the current workspace
export async function POST(request: NextRequest) {
  const validatedId = request.headers.get("x-validated-workspace-id");
  const rawCookie = request.cookies.get("kh_auth_session")?.value;
  const workspaceId = validatedId || (rawCookie ? await verifyWorkspaceId(rawCookie) : null);

  if (!workspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { enabledSkills } = body;

    if (!Array.isArray(enabledSkills)) {
      return NextResponse.json({ error: "enabledSkills must be an array of strings" }, { status: 400 });
    }

    await updateWorkspace(workspaceId, { enabledSkills });

    return NextResponse.json({ success: true, enabledSkills });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update skills";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
