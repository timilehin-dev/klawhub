import {
  saveMemory,
  readMemory,
  getRecentMemories,
  deleteUserMemories,
  autoPruneMemory,
} from "@/db";

/**
 * Build a concise user context string from recent memories.
 * Used by agents to personalize their responses.
 */
export async function buildUserContext(slackUserId: string): Promise<string> {
  try {
    const recentMem = await getRecentMemories(slackUserId, undefined, 15);
    if (recentMem.length === 0) return "";

    const formatted = recentMem
      .map((m) => `[${m.category}] ${m.content}`)
      .join("\n");
    return formatted.slice(0, 2000); // cap to avoid bloating prompts
  } catch {
    return ""; // non-critical
  }
}

export async function memoryWrite(
  slackUserId: string,
  content: string,
  category = "general",
  workspaceId?: string
): Promise<string> {
  await saveMemory(slackUserId, content.slice(0, 1000), category, workspaceId);
  // Auto-prune in background (non-blocking)
  autoPruneMemory(slackUserId, category).catch(() => {});
  return "Memory saved.";
}

export async function memoryRead(slackUserId: string, query: string): Promise<string> {
  const rows = await readMemory(slackUserId, query);
  if (rows.length === 0) return "";
  return rows.map((r: { content: string }) => r.content).join("\n");
}

export async function memoryForget(slackUserId: string): Promise<number> {
  const result = await deleteUserMemories(slackUserId);
  return Array.isArray(result) ? result.length : 0;
}
