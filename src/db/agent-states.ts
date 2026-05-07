import { eq, and } from "drizzle-orm";
import { getDb } from "./connection";
import { agentStates } from "./schema";
import type { AgentMessage } from "@/core/a2a/message-bus";

const db = getDb();

export async function saveAgentState(
  workspaceId: string | undefined,
  agentName: string,
  state: Record<string, any>
): Promise<void> {
  const whereClause = workspaceId
    ? and(
        eq(agentStates.workspaceId, workspaceId),
        eq(agentStates.agentName, agentName as any)
      )
    : eq(agentStates.agentName, agentName as any);

  const existing = await db
    .select()
    .from(agentStates)
    .where(whereClause)
    .limit(1);

  if (existing && existing.length > 0) {
    await db
      .update(agentStates)
      .set({
        state,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentStates.id, existing[0].id));
  } else {
    await db
      .insert(agentStates)
      .values({
        workspaceId,
        agentName: agentName as any,
        state,
        lastActiveAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }
}

export async function getAgentState(
  workspaceId: string | undefined,
  agentName: string
): Promise<Record<string, any> | null> {
  const whereClause = workspaceId
    ? and(
      eq(agentStates.workspaceId, workspaceId as string),
      eq(agentStates.agentName, agentName as any)
    )
    : eq(agentStates.agentName, agentName as any);

  const result = await db
    .select()
    .from(agentStates)
    .where(whereClause)
    .limit(1);

  return result[0]?.state || null;
}

export async function updateAgentState(
  workspaceId: string | undefined,
  agentName: string,
  updates: Record<string, any>
): Promise<void> {
  const currentState = await getAgentState(workspaceId, agentName) || {};
  const newState = { ...currentState, ...updates };
  await saveAgentState(workspaceId, agentName, newState);
}

export async function getActiveAgents(workspaceId?: string): Promise<string[]> {
  const result = await db
    .select({ agentName: agentStates.agentName })
    .from(agentStates);

  return result.map(r => r.agentName);
}