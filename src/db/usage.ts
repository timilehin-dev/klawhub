import { getDb } from "./connection";
import { usageLogs } from "./schema";
import { desc, sql, count, sum, avg, and, eq, gte } from "drizzle-orm";

export interface UsageLogInsert {
  workspaceId?: string;
  slackUserId?: string;
  agentName: string;
  provider?: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
  runId?: string;
  taskId?: string;
}

export function logUsage(data: UsageLogInsert) {
  return getDb().insert(usageLogs).values(data);
}

export interface UsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalDurationMs: number;
}

export async function getUsageStats(
  slackUserId?: string,
  since?: Date
): Promise<UsageStats> {
  const conditions = [];
  if (slackUserId) conditions.push(eq(usageLogs.slackUserId, slackUserId));
  if (since) conditions.push(gte(usageLogs.createdAt, since));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await getDb()
    .select({
      totalCalls: count(),
      successfulCalls: sql<number>`COUNT(*) FILTER (WHERE success = true)`.as("successful_calls"),
      failedCalls: sql<number>`COUNT(*) FILTER (WHERE success = false)`.as("failed_calls"),
      totalTokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`.as("total_tokens"),
      totalDurationMs: sql<number>`COALESCE(SUM(${usageLogs.durationMs}), 0)`.as("total_duration_ms"),
    })
    .from(usageLogs)
    .where(where);

  const row = rows[0];
  return {
    totalCalls: row?.totalCalls || 0,
    successfulCalls: Number(row?.successfulCalls) || 0,
    failedCalls: Number(row?.failedCalls) || 0,
    totalTokens: Number(row?.totalTokens) || 0,
    totalDurationMs: Number(row?.totalDurationMs) || 0,
  };
}

export function getRecentUsageLogs(slackUserId?: string, limit = 20) {
  const where = slackUserId ? eq(usageLogs.slackUserId, slackUserId) : undefined;
  return getDb()
    .select()
    .from(usageLogs)
    .where(where)
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit);
}

export function getAgentUsageBreakdown(slackUserId?: string, since?: Date) {
  const conditions = [];
  if (slackUserId) conditions.push(eq(usageLogs.slackUserId, slackUserId));
  if (since) conditions.push(gte(usageLogs.createdAt, since));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return getDb()
    .select({
      agentName: usageLogs.agentName,
      calls: count(),
      tokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`.as("tokens"),
      avgDurationMs: sql<number>`COALESCE(AVG(${usageLogs.durationMs}), 0)`.as("avg_duration_ms"),
      failures: sql<number>`COUNT(*) FILTER (WHERE success = false)`.as("failures"),
    })
    .from(usageLogs)
    .where(where)
    .groupBy(usageLogs.agentName)
    .orderBy(desc(count()));
}
