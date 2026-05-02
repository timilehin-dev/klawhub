import { saveMemory, readMemory } from "@/lib/db";

/**
 * Escape SQL LIKE pattern wildcards in user input.
 * Prevents % and _ in user queries from being treated as wildcards.
 */
function escapeLikePattern(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

export async function memoryWrite(
  slackUserId: string,
  content: string,
  category = "general"
): Promise<string> {
  await saveMemory(slackUserId, content.slice(0, 1000), category);
  return "Memory saved.";
}

export async function memoryRead(slackUserId: string, query: string): Promise<string> {
  const rows = await readMemory(slackUserId, query);
  if (rows.length === 0) return "";
  return rows.map((r: { content: string }) => r.content).join("\n");
}

export { escapeLikePattern };
