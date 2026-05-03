import { getDb } from "./connection";
import { workspaces, workspaceMembers, runs, tasks } from "./schema";
import { eq, and, desc, sql, count } from "drizzle-orm";

// ── Workspace CRUD ──

export function createWorkspace(values: typeof workspaces.$inferInsert) {
  return getDb().insert(workspaces).values(values).returning();
}

export function getWorkspaceByTeamId(teamId: string) {
  return getDb().select().from(workspaces).where(eq(workspaces.slackTeamId, teamId)).limit(1);
}

export function getWorkspaceById(id: string) {
  return getDb().select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
}

export function updateWorkspace(id: string, updates: Partial<typeof workspaces.$inferInsert>) {
  return getDb().update(workspaces).set({ ...updates, updatedAt: new Date() }).where(eq(workspaces.id, id));
}

// ── Workspace Members ──

export function upsertWorkspaceMember(
  workspaceId: string,
  slackUserId: string,
  data: { slackUserName?: string; slackUserEmail?: string; isWorkspaceAdmin?: boolean }
) {
  return getDb()
    .insert(workspaceMembers)
    .values({
      workspaceId,
      slackUserId,
      ...data,
    })
    .onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.slackUserId],
      set: {
        ...data,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export function touchMemberActivity(workspaceId: string, slackUserId: string) {
  return getDb()
    .update(workspaceMembers)
    .set({ lastActiveAt: new Date() })
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.slackUserId, slackUserId)
    ));
}

export function getWorkspaceMembers(workspaceId: string) {
  return getDb()
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(desc(workspaceMembers.lastActiveAt));
}

export function getWorkspaceMemberCount(workspaceId: string): Promise<number> {
  return getDb()
    .select({ cnt: count() })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .then((rows) => rows[0]?.cnt || 0);
}

// ── Workspace Stats (for dashboard) ──

export interface WorkspaceStats {
  totalRuns: number;
  runsByStatus: Record<string, number>;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  activeMembers: number;
  totalSchedules: number;
  activeSchedules: number;
}

export async function getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats> {
  // We aggregate by looking at workspace member IDs since runs/tasks store slackUserId
  const members = await getWorkspaceMembers(workspaceId);
  const memberIds = members.map((m) => m.slackUserId);

  if (memberIds.length === 0) {
    return {
      totalRuns: 0,
      runsByStatus: {},
      totalTasks: 0,
      tasksByStatus: {},
      activeMembers: 0,
      totalSchedules: 0,
      activeSchedules: 0,
    };
  }

  // Get runs count by status for these users
  const runRows: { status: string | null; cnt: number }[] = await getDb()
    .select({ status: runs.status, cnt: count() })
    .from(runs)
    .where(sql`${runs.slackUserId} IN ${sql.raw(`(${memberIds.map((id) => `'${id}'`).join(",")})`)}`)
    .groupBy(runs.status);

  const taskRows: { status: string | null; cnt: number }[] = await getDb()
    .select({ status: tasks.status, cnt: count() })
    .from(tasks)
    .where(sql`${tasks.slackUserId} IN ${sql.raw(`(${memberIds.map((id) => `'${id}'`).join(",")})`)}`)
    .groupBy(tasks.status);

  const runsByStatus: Record<string, number> = {};
  let totalRuns = 0;
  for (const r of runRows) {
    const key = r.status || "unknown";
    runsByStatus[key] = r.cnt;
    totalRuns += r.cnt;
  }

  const tasksByStatus: Record<string, number> = {};
  let totalTasks = 0;
  for (const t of taskRows) {
    const key = t.status || "unknown";
    tasksByStatus[key] = t.cnt;
    totalTasks += t.cnt;
  }

  // Count schedules for these users
  const scheduleRows: { cnt: number }[] = await getDb()
    .select({ cnt: count() })
    .from(schedules)
    .where(sql`${schedules.slackUserId} IN ${sql.raw(`(${memberIds.map((id) => `'${id}'`).join(",")})`)}`)
    .then((r) => r);

  const activeScheduleRows: { cnt: number }[] = await getDb()
    .select({ cnt: count() })
    .from(schedules)
    .where(sql`${schedules.slackUserId} IN ${sql.raw(`(${memberIds.map((id) => `'${id}'`).join(",")})`)} AND ${schedules.isActive} = true`)
    .then((r) => r);

  return {
    totalRuns,
    runsByStatus,
    totalTasks,
    tasksByStatus,
    activeMembers: memberIds.length,
    totalSchedules: scheduleRows[0]?.cnt || 0,
    activeSchedules: activeScheduleRows[0]?.cnt || 0,
  };
}

// Need schedules import at top level — reimport for this function
import { schedules } from "./schema";

// ── Usage Limit Check ──

export interface UsageLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function checkWorkspaceUsageLimit(workspaceId: string): Promise<UsageLimitResult> {
  const ws = await getWorkspaceById(workspaceId);
  if (!ws || ws.length === 0) {
    return { allowed: true, used: 0, limit: 50 }; // Default free tier
  }

  const workspace = ws[0];
  const limit = workspace.monthlyRunLimit || 50;

  const members = await getWorkspaceMembers(workspaceId);
  const memberIds = members.map((m) => m.slackUserId);

  if (memberIds.length === 0) {
    return { allowed: true, used: 0, limit };
  }

  // Count runs + tasks this calendar month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const runCount: { cnt: number }[] = await getDb()
    .select({ cnt: count() })
    .from(runs)
    .where(sql`${runs.slackUserId} IN ${sql.raw(`(${memberIds.map((id) => `'${id}'`).join(",")})`)} AND ${runs.createdAt} >= ${monthStart.toISOString()}`)
    .then((r) => r);

  const taskCount: { cnt: number }[] = await getDb()
    .select({ cnt: count() })
    .from(tasks)
    .where(sql`${tasks.slackUserId} IN ${sql.raw(`(${memberIds.map((id) => `'${id}'`).join(",")})`)} AND ${tasks.createdAt} >= ${monthStart.toISOString()}`)
    .then((r) => r);

  const used = (runCount[0]?.cnt || 0) + (taskCount[0]?.cnt || 0);

  return {
    allowed: used < limit,
    used,
    limit,
  };
}
