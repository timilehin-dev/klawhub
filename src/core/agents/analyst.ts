import { agentChat } from "@/core/llm";
import { sandbox } from "@/core/tools/sandbox";
import type { SandboxResponse } from "@/types";

const ANALYST_PROMPT = `You are the Data Analyst Agent of Klawhub. You write Python analysis code and generate business-grade visualizations.

RULES:
1. Write Python code using pandas, matplotlib, and seaborn as needed.
2. Always set matplotlib.use('Agg') before importing pyplot.
3. Save charts as PNG files to /tmp/ with descriptive filenames (use timestamp to avoid collisions).
4. Include statistical insights: trends, outliers, correlations.
5. Keep code under 100 lines. Focus on actionable insights.
6. Print summary statistics and key findings to stdout.
7. Return ONLY the Python code inside a markdown code block.
8. Clean up any /tmp files from previous runs before saving new ones.`;

const INTERPRET_PROMPT = `You interpret data analysis results and provide business insights.

Given the analysis output below, provide:
1. Key Findings (bullet points)
2. Trends & Patterns
3. Actionable Recommendations

Keep it concise and business-focused. No more than 200 words.`;

export async function analyzeData(request: string, data?: string, meta?: { taskId?: string; slackUserId?: string }) {
  const messages = [
    { role: "system" as const, content: ANALYST_PROMPT },
    {
      role: "user" as const,
      content: `Analysis request: ${request}${data ? `\n\nData (CSV):\n${data.slice(0, 5000)}` : ""}`,
    },
  ];

  const codeResponse = await agentChat("analyst", messages, { temperature: 0.3, maxTokens: 2000 }, meta);
  const codeMatch = codeResponse.match(/```(?:python)?\n?([\s\S]*?)```/);
  let code = codeMatch?.[1]?.trim();
  if (!code) {
    // Fallback: if no markdown block, assume the entire response is code, but log a warning
    console.warn("[Analyst Agent] LLM did not return code in markdown block. Assuming full response is code.");
    code = codeResponse.trim();
  }

  const execution = (await sandbox({ type: "analytics", code })) as SandboxResponse & {
    output_file?: string;
    filename?: string;
  };

  // Interpret results
  const interpMessages = [
    { role: "system" as const, content: INTERPRET_PROMPT },
    {
      role: "user" as const,
      content: `Request: ${request}\n\nOutput:\n${execution.stdout || ""}\n${execution.stderr ? `Errors: ${execution.stderr}` : ""}`,
    },
  ];
  const insights = await agentChat("analyst", interpMessages, { temperature: 0.4, maxTokens: 800 }, meta);

  return { code, execution, insights };
}
