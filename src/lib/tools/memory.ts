import { saveMemory, readMemory } from "@/lib/db";

export async function memoryWrite(
  slackUserId: string,
  content: string,
  category = "general"
): Promise<string> {
  await saveMemory(slackUserId, content, category);
  return "Memory saved.";
}

export async function memoryRead(slackUserId: string, query: string): Promise<string> {
  const rows = await readMemory(slackUserId, query);
  if (rows.length === 0) return "";
  return rows.map((r: { content: string }) => r.content).join("\n");
}
