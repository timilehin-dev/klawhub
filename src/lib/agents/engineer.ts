import { llm } from "@/lib/llm";

const ENGINEER_PROMPT = `You are the Engineer Agent of Klawhub. You write working code.

RULES:
1. Write MINIMAL working code. No classes or abstractions unless critical.
2. The code MUST work when run. No placeholder URLs or dummy data.
3. Python: use requests, json, sys. JavaScript: use fetch.
4. Include basic error handling.
5. If spec mentions an API, use a REAL public endpoint.
6. Keep under 80 lines. Single script, top-to-bottom.
7. Return ONLY the code inside a markdown code block.`;

export async function writeCode(spec: string, language: string) {
  const messages = [
    { role: "system" as const, content: ENGINEER_PROMPT },
    { role: "user" as const, content: `Language: ${language}\n\nSpecification:\n${spec}` },
  ];
  const response = await llm.chat(messages, { temperature: 0.3, maxTokens: 1500 });
  const codeMatch = response.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return { code: codeMatch?.[1]?.trim() || response.trim() };
}

export async function fixCode(code: string, error: string, spec: string) {
  const messages = [
    { role: "system" as const, content: ENGINEER_PROMPT },
    {
      role: "user" as const,
      content: `Fix this code.\n\nSpec:\n${spec}\n\nCode:\n${code}\n\nError:\n${error}\n\nReturn the corrected code.`,
    },
  ];
  const response = await llm.chat(messages, { temperature: 0.3, maxTokens: 1500 });
  const codeMatch = response.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return { code: codeMatch?.[1]?.trim() || response.trim() };
}
