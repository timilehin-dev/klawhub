import { getDb } from "./connection";
import { mcpServers } from "./schema";
import { eq, and } from "drizzle-orm";

export async function addMcpServer(data: typeof mcpServers.$inferInsert) {
  return getDb().insert(mcpServers).values(data).returning();
}

export async function getMcpServers(workspaceId: string) {
  return getDb().select().from(mcpServers).where(eq(mcpServers.workspaceId, workspaceId));
}

export async function deleteMcpServer(id: string) {
  return getDb().delete(mcpServers).where(eq(mcpServers.id, id));
}

export async function upsertMcpServer(workspaceId: string, name: string, data: Partial<typeof mcpServers.$inferInsert>) {
  const existing = await getDb()
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.name, name)))
    .limit(1);

  if (existing.length > 0) {
    return getDb()
      .update(mcpServers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mcpServers.id, existing[0].id))
      .returning();
  } else {
    return getDb()
      .insert(mcpServers)
      .values({ 
        workspaceId, 
        name, 
        url: data.url!, 
        authConfig: data.authConfig || null,
        status: data.status || "active" 
      })
      .returning();
  }
}

export async function updateMcpServerToolsSchema(id: string, toolsSchema: any) {
  return getDb()
    .update(mcpServers)
    .set({ toolsSchema, updatedAt: new Date() })
    .where(eq(mcpServers.id, id));
}
