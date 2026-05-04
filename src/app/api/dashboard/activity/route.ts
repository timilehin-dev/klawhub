import { NextResponse } from "next/server";
import { getRecentRuns, getRecentTasks, getUserSchedules } from "@/lib/db";

// GET /api/dashboard/activity?memberId=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");

  if (!memberId) {
    return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  }

  try {
    const [recentRuns, recentTasks, userSchedules] = await Promise.all([
      getRecentRuns(memberId, 10),
      getRecentTasks(memberId, 10),
      getUserSchedules(memberId, false),
    ]);

    interface ActivityItem {
      id: string;
      type: "build" | "document" | "research" | "analytics";
      request: string;
      status: string;
      createdAt: string;
    }

    const activities: ActivityItem[] = [
      ...recentRuns.map((r) => ({
        id: r.id,
        type: "build" as const,
        request: r.request,
        status: r.status || "pending",
        createdAt: (r.createdAt || new Date()).toISOString(),
      })),
      ...recentTasks.map((t) => ({
        id: t.id,
        type: t.type as ActivityItem["type"],
        request: t.request,
        status: t.status || "pending",
        createdAt: (t.createdAt || new Date()).toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      activities,
      schedules: userSchedules,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
