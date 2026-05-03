import { NextResponse } from "next/server";
import { getWorkspaceStats, getWorkspaceMembers, checkWorkspaceUsageLimit } from "@/lib/db";

// GET /api/dashboard/stats?workspaceId=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

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
