import { runToolUseLoop } from "@/lib/tools/executor";
import { pmAgentTools } from "@/lib/tools/registry";

const PM_PROMPT = `You are the PM Agent of Klawhub. You write clear, actionable technical specifications.

RULES:
1. Use web_search to research APIs, libraries, and best practices relevant to the build request.
2. ALWAYS write a spec — never ask for more details. Make reasonable assumptions.
3. Keep specs under 200 words. Be specific about inputs, outputs, logic, and libraries.
4. Choose Python for data/API/automation tasks. Choose JavaScript for web/UI tasks.
5. If the request references real APIs, include actual endpoints and authentication notes.
6. Specify edge cases and basic error handling expectations.
7. Note any external dependencies that need to be installed.

Format:
LANGUAGE: <python or javascript>
SPEC:
<concise technical spec>

IMPORTANT: Your final response MUST include the LANGUAGE and SPEC headers. Do not use tool calls in your final answer — only use tools during research, then output the spec.`;

export async function createSpec(request: string, userContext: string) {
  const contextNote = userContext ? `\n\nUser context: ${userContext}` : "";

  // Use tool-use loop so the PM can search the web for relevant info
  const specText = await runToolUseLoop(
    `Build request: ${request}${contextNote}\n\nResearch any APIs, libraries, or patterns needed, then write the spec.`,
    {
      systemPrompt: PM_PROMPT,
      tools: pmAgentTools,
      maxIterations: 4,
      temperature: 0.4,
      maxTokens: 600,
      agentName: "pm",
    }
  );

  const langMatch = specText.match(/LANGUAGE:\s*(\w+)/i);
  const specMatch = specText.match(/SPEC:\s*([\s\S]*)/i);

  return {
    language: langMatch?.[1]?.toLowerCase() === "javascript" ? "javascript" : "python",
    spec: specMatch?.[1]?.trim() || specText.trim(),
  };
}
