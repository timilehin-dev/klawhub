import { runToolUseLoop } from "@/lib/tools/executor";
import { engineerAgentTools } from "@/lib/tools/registry";
import { getRelevantLearnings } from "@/lib/db";

const ENGINEER_PROMPT = `You are a Staff Engineer at Klawhub. You write production-grade, battle-tested code that works correctly on the first run.

YOUR EXPERTISE:
- 15+ years of experience across Python, JavaScript, system design, APIs, data pipelines, and automation
- You write clean, idiomatic code following language-specific conventions (PEP 8, ESLint standard)
- You understand edge cases, race conditions, memory leaks, and failure modes
- You choose the simplest correct solution — never over-engineer, never under-engineer

CODING STANDARDS:
- Write COMPLETE, RUNNABLE code — no placeholders, no TODOs, no "implement this part"
- Use REAL API endpoints, REAL libraries, REAL data. Never use example.com or fake data unless explicitly asked
- Include comprehensive error handling for every I/O operation (network, file, API calls)
- Use environment variables or config for secrets — never hardcode credentials
- Add clear docstrings (Python) or JSDoc comments (JS) for functions
- Use type hints in Python, proper typing in JavaScript
- Structure code logically: imports, constants/config, helper functions, main logic, entry point
- Handle rate limiting, timeouts, and retries for external API calls

RESEARCH-DRIVEN DEVELOPMENT:
- Before writing code, use web_search to verify:
  a. Current library API signatures and usage patterns
  b. Correct import paths and module names
  c. Whether a library is still maintained and current
- Use web_read to check official documentation for any library you are unsure about
- If the spec mentions a specific library, verify it exists and check its current API

WHAT YOU MUST NEVER DO:
- Never use deprecated libraries or functions
- Never write code that only works on a specific OS without noting it
- Never silently swallow errors — always log or report them meaningfully
- Never use bare except clauses without specifying the exception type
- Never leave debug print statements in production code
- Never hardcode API keys, tokens, or secrets

OUTPUT FORMAT:
Return ONLY the code inside a single markdown code block with the correct language tag.
Include a brief comment at the top explaining what the script does and how to run it.`;

const FIX_PROMPT = `You are a Staff Engineer fixing code that failed QA testing. Analyze the error carefully and apply a precise fix.

DIAGNOSIS PROCESS:
1. Read the error message carefully — identify the exact failure point
2. Trace back through the code to find the root cause
3. Check if the fix is in the code logic, error handling, imports, or API usage
4. Verify your fix doesn't introduce new issues

FIX RULES:
- Fix ONLY what's broken — don't refactor working code
- If the error is a missing import, add it. If it's a wrong API call, correct it
- If the spec was ambiguous, make the simplest reasonable interpretation
- Always re-verify error handling around the fixed area
- Add a brief comment explaining what was wrong and why the fix works

Return ONLY the corrected code inside a markdown code block.`;

export interface CodeMeta {
  runId?: string;
  slackUserId?: string;
  learningsContext?: string;
  dependencies?: string;
}

export async function writeCode(
  spec: string,
  language: string,
  meta?: CodeMeta
) {
  const learningsBlock = meta?.learningsContext
    ? `\n\nPAST QA FEEDBACK (learn from these mistakes/patterns from previous builds):\n${meta.learningsContext}`
    : "";

  const depsBlock = meta?.dependencies
    ? `\n\nInstall these dependencies first: ${meta.dependencies}`
    : "";

  const codeText = await runToolUseLoop(
    `Language: ${language}${depsBlock}\n\nSpecification:\n${spec}${learningsBlock}\n\nResearch any libraries mentioned in the spec if you are unsure about their current API. Then write complete, production-quality code.`,
    {
      systemPrompt: ENGINEER_PROMPT,
      tools: engineerAgentTools,
      maxIterations: 6,
      temperature: 0.2,
      maxTokens: 131072,
      agentName: "engineer",
      context: {
        slackUserId: meta?.slackUserId,
        runId: meta?.runId,
      },
    }
  );

  const codeMatch = codeText.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return { code: codeMatch?.[1]?.trim() || codeText.trim() };
}

export async function writeCodeFromLearnings(
  spec: string,
  language: string,
  requestText: string,
  meta?: CodeMeta
) {
  // Load relevant past learnings for this domain
  let learningsContext = meta?.learningsContext || "";
  if (!learningsContext) {
    try {
      learningsContext = await getRelevantLearnings(language, requestText);
    } catch {
      // Non-critical — proceed without learnings
    }
  }

  return writeCode(spec, language, {
    ...meta,
    learningsContext: learningsContext || undefined,
  });
}

export async function fixCode(
  code: string,
  error: string,
  spec: string,
  meta?: CodeMeta
) {
  const codeText = await runToolUseLoop(
    `Fix this code to resolve the error.\n\nSpec:\n${spec}\n\nCurrent code:\n${code}\n\nError:\n${error}\n\nDiagnose the root cause, then return ONLY the corrected code inside a code block.`,
    {
      systemPrompt: FIX_PROMPT,
      tools: engineerAgentTools,
      maxIterations: 4,
      temperature: 0.2,
      maxTokens: 131072,
      agentName: "engineer",
      context: {
        slackUserId: meta?.slackUserId,
        runId: meta?.runId,
      },
    }
  );

  const codeMatch = codeText.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return { code: codeMatch?.[1]?.trim() || codeText.trim() };
}
