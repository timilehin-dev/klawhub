import { llm } from "@/lib/llm";
import { sandbox } from "@/lib/tools/sandbox";

const QA_PROMPT = `You are the QA Agent of Klawhub. You test code ruthlessly.

RULES:
1. Code MUST run without errors to pass.
2. Code MUST produce meaningful output (not empty, not just "success").
3. If code has placeholder data or dummy URLs, FAIL it.
4. Be concise — one sentence per issue.

Format:
VERDICT: <PASS or FAIL>
REASON: <why>
OUTPUT: <what the code produced>`;

export async function testCode(code: string, language: string, spec: string) {
  const execution = await sandbox({ type: "code", code, language });

  const messages = [
    { role: "system" as const, content: QA_PROMPT },
    {
      role: "user" as const,
      content: `Spec:\n${spec}\n\nCode:\n${code}\n\nExecution:\nstdout: ${execution.stdout}\nstderr: ${execution.stderr}\nerror: ${execution.error || "none"}`,
    },
  ];

  const evaluation = await llm.chat(messages, { temperature: 0.3, maxTokens: 500 });

  const verdictMatch = evaluation.match(/VERDICT:\s*(PASS|FAIL)/i);
  const passed = verdictMatch?.[1]?.toUpperCase() === "PASS" && execution.success;

  return { passed, evaluation, execution };
}
