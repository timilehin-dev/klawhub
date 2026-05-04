import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceStats, getWorkspaceMembers, checkWorkspaceUsageLimit } from "@/lib/db";
import { verifyWorkspaceId } from "@/lib/session";

// GET /api/dashboard/stats?workspaceId=xxx
export async function GET(request: NextRequest) {
  // Prefer the middleware-validated header, fall back to query param
  const validatedId = request.headers.get("x-validated-workspace-id");
  const { searchParams } = new URL(request.url);
  const workspaceId = validatedId || searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const [stats, members, usage] = await Promise.all([
      getWorkspaceStats(workspaceId),
      getWorkspaceMembers(workspaceId),
      checkWorkspaceUsageLimit(workspaceId),
    ]);

    return NextResponse.json({ stats, members, usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
