import { llm } from "@/lib/llm";
import { webSearch } from "@/lib/tools/web-search";

const PM_PROMPT = `You are the PM Agent of Klawhub. You write technical specifications for software tools.

RULES:
1. ALWAYS write a spec. Never ask for more details — make reasonable assumptions.
2. Keep specs under 200 words. Be specific about inputs, outputs, logic, and libraries.
3. Choose Python for data/API tasks, JavaScript for web/UI tasks.
4. If the request references real APIs, include the actual endpoints.

Format:
LANGUAGE: <python or javascript>
SPEC:
<concise technical spec>`;

export async function createSpec(request: string, userContext: string) {
  // Search for relevant API docs or references
  const searchResults = await webSearch(request.split(" ").slice(0, 8).join(" "), 3);

  const messages = [
    { role: "system" as const, content: PM_PROMPT },
    {
      role: "user" as const,
      content: `Build request: ${request}\n\nUser context: ${userContext || "None"}\n\nReference material:\n${searchResults || "None available"}`,
    },
  ];

  const response = await llm.chat(messages, { temperature: 0.4, maxTokens: 600 });

  const langMatch = response.match(/LANGUAGE:\s*(\w+)/i);
  const specMatch = response.match(/SPEC:\s*([\s\S]*)/i);

  return {
    language: langMatch?.[1]?.toLowerCase() === "javascript" ? "javascript" : "python",
    spec: specMatch?.[1]?.trim() || response.trim(),
  };
}
