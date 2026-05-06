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
  await db
    .insert(agentStates)
    .values({
      workspaceId,
      agentName: agentName as any,
      state,
      lastActiveAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [agentStates.workspaceId, agentStates.agentName],
      set: {
        state,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function getAgentState(
  workspaceId: string | undefined,
  agentName: string
): Promise<Record<string, any> | null> {
  const result = await db
    .select()
    .from(agentStates)
    .where(
      and(
        eq(agentStates.workspaceId, workspaceId),
        eq(agentStates.agentName, agentName as any)
      )
    )
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
    .from(agentStates)
    .where(eq(agentStates.workspaceId, workspaceId));

  return result.map(r => r.agentName);
}