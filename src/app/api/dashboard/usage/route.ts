import { NextResponse } from "next/server";
import { getRecentUsageLogs, getAgentUsageBreakdown } from "@/lib/db";

// GET /api/dashboard/usage?memberId=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");

  try {
    const [recentLogs, agentBreakdown] = await Promise.all([
      getRecentUsageLogs(memberId || undefined, 50),
      getAgentUsageBreakdown(memberId || undefined),
    ]);

    return NextResponse.json({ recentLogs, agentBreakdown });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch usage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
