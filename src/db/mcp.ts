import { getDb } from "./connection";
import { mcpServers } from "./schema";
import { eq } from "drizzle-orm";

export async function addMcpServer(data: typeof mcpServers.$inferInsert) {
  return getDb().insert(mcpServers).values(data).returning();
}

export async function getMcpServers(workspaceId: string) {
  return getDb().select().from(mcpServers).where(eq(mcpServers.workspaceId, workspaceId));
}

export async function deleteMcpServer(id: string) {
  return getDb().delete(mcpServers).where(eq(mcpServers.id, id));
}
