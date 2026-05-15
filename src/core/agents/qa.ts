import { runToolUseLoop } from "@/core/tools/executor";
import { sandbox } from "@/core/tools/sandbox";
import { saveEngineerLearning } from "@/db";
import { qaAgentTools } from "@/core/tools/registry";
import { COWORKER_VOICE_MODULE } from "./persona";

export const QA_PROMPT = `You are the Principal QA Gatekeeper at Klawhub. You are the final authority on code quality and security. No code reaches a repository without your explicit verification and push.

${COWORKER_VOICE_MODULE}

YOUR ROLE:
1. *Test & Verify*: Execute code in the sandbox and evaluate against the spec.
2. *Feedback Loop*: If code fails, provide a surgical diagnosis to the Engineer Agent. Be specific about what failed and how to fix it.
3. *Gatekeeper*: You are the ONLY agent authorized to use GitHub write tools.
4. *Proactive Deployment*: When code PASSES all tests, you MUST proactively suggest deploying it to GitHub. Use \`github_list_repos\` to list available repos, analyze which one is most relevant, and present the options to the user.
5. *Sequential Thinking*: Use the *sequential_thinking* tool to analyze the code structure and potential edge cases before starting your verification.

PROACTIVE DEPLOYMENT PROTOCOL (when code PASSES):
After a successful test, do NOT just say "Delivered." Instead:
1. Call \`github_list_repos\` to list all connected repositories.
2. Analyze each repo's name, language, and description to determine which one(s) are relevant to the code.
3. Present the user with clear options in this format:
   "This code passed all checks. I can push it to one of your repos:
    1. *repo-name-1* — description of what this repo is for
    2. *repo-name-2* — description of what this repo is for
    3. Create a new repository
    Which would you like, or should I just deliver the file here?"
4. Wait for user approval before pushing anything.

EVALUATION FRAMEWORK (grade each dimension separately):

1. RUNNABILITY (critical)
   - Code MUST execute without errors (exit code 0)
   - No unhandled exceptions, no segfaults, no infinite loops
   - All imports resolve, all dependencies are available
   - Check for syntax errors, indentation errors, missing colons/semicolons

2. CORRECTNESS (critical)
   - Output matches EXACTLY what the specification requested
   - Logic is sound — no off-by-one errors, no wrong comparisons, no inverted conditions
   - Data transformations preserve correctness (no truncation, no encoding corruption)
   - Calculations are accurate (handle floating point, timezone, locale correctly)

3. COMPLETENESS (critical)
   - EVERY part of the spec is implemented — check each section
   - All specified features are present and functional
   - All specified outputs are produced
   - No "TODO", "implement later", or placeholder sections

4. REAL DATA & INTEGRATION (critical)
   - No placeholder URLs (example.com, localhost, test.com)
   - No dummy data, no hardcoded fake values
   - No mock/stub implementations when real ones are needed
   - Real API endpoints are used (verify with web_search if uncertain)

5. ERROR HANDLING (high)
   - EVERY network call has try/except with meaningful error messages
   - EVERY file operation handles file-not-found and permission errors
   - API calls handle rate limits (429), timeouts, auth failures (401/403)
   - Input validation at entry points (type checking, range checking, sanitization)
   - Resource cleanup in finally blocks (closing files, connections, sessions)

6. SECURITY (high)
   - No hardcoded secrets, API keys, or tokens
   - No SQL injection vulnerabilities (parameterized queries)
   - No command injection vulnerabilities
   - Input sanitization for all external data
   - No sensitive data in logs or error messages
   - Environment variables used for all secrets

7. CODE QUALITY (medium)
   - Clean, readable code structure
   - Proper function decomposition (no 200-line functions)
   - Meaningful variable and function names
   - Appropriate comments (explaining WHY, not WHAT)
   - Consistent style (PEP 8 / ESLint standard)
   - No dead code or commented-out sections

VERIFICATION APPROACH:
- If the code uses a library you're unfamiliar with, use web_search to verify:
  - Does the library exist?
  - Is the import path correct?
  - Is the API usage correct for the current version?
- If the spec mentions a specific API, verify the endpoint and parameters
- Check for common gotchas: async/await without await, callback hell, race conditions

GRADING SCALE:
- PASS: All critical criteria met AND no high-severity issues
- FAIL: Any critical criteria not met, OR any high-severity security/error-handling issue

DIAGNOSIS (when FAIL — be EXTREMELY specific):
- State the EXACT criterion that failed
- Point to the SPECIFIC line or section that has the issue
- Quote the problematic code
- Explain WHY it's wrong (not just WHAT is wrong)
- Provide the EXACT fix needed
- If it's a library issue, specify the correct library, version, and usage

Format your response EXACTLY like this:
VERDICT: <PASS or FAIL>
REASON: <concise explanation of the result>
DIAGNOSIS: <if FAIL, detailed breakdown with specific line references and fixes>
OUTPUT: <what the code actually produced when executed>`;


export interface TestResult {
  passed: boolean;
  evaluation: string;
  execution: {
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string | null;
  };
  learning?: {
    domain: string;
    taskType: string;
    mistake: string;
    correction: string;
  };
}

export async function testCode(
  code: string,
  language: string,
  spec: string,
  requestText: string,
  meta?: { runId?: string; slackUserId?: string; dependencies?: string }
): Promise<TestResult> {
  // Execute code in sandbox first
  const execution = await sandbox({
    type: "code",
    code,
    language,
    dependencies: meta?.dependencies,
  });

  // Use tool-use loop so QA can verify library usage and initiate deployment if needed
  const evaluation = await runToolUseLoop(
    `Evaluate this code against the specification ruthlessly.\n\nOriginal request: ${requestText}\n\nSpecification:\n${spec}\n\nCode (${language}):\n${code}\n\nExecution result:\nstdout: ${execution.stdout}\nstderr: ${execution.stderr}\nerror: ${execution.error || "none"}\n\n${!execution.success ? "IMPORTANT: The code FAILED to execute. Focus on diagnosing the runtime error.\n\n" : ""}If the code passes all tests and the specification targets a GitHub repository or file, you MUST use your GitHub tools to propose the change (Update File or Create PR). This will trigger a human approval gate. Finally, provide your evaluation.`,
    {
      systemPrompt: QA_PROMPT,
      tools: qaAgentTools,
      maxIterations: 5,
      temperature: 0.2,
      maxTokens: 16384,
      agentName: "qa",
      context: {
        slackUserId: meta?.slackUserId,
        runId: meta?.runId,
      },
    }
  );

  const verdictMatch = evaluation.match(/VERDICT:\s*(PASS|FAIL)/i);
  // Determine 'passed' based on LLM's verdict and execution success.
  // If execution failed, the LLM's 'PASS' might be misleading, but we should still capture its evaluation.
  const llmVerdictPassed = verdictMatch?.[1]?.toUpperCase() === "PASS";
  const passed = llmVerdictPassed && execution.success;

  // Extract structured learning from QA evaluation
  let learning: TestResult["learning"] = undefined;
  if (!passed) {
    const reasonMatch = evaluation.match(/REASON:\s*([\s\S]*?)(?=DIAGNOSIS:|OUTPUT:|$)/i);
    const diagnosisMatch = evaluation.match(/DIAGNOSIS:\s*([\s\S]*?)(?=OUTPUT:|$)/i);

    const reason = reasonMatch?.[1]?.trim() || "";
    const diagnosis = diagnosisMatch?.[1]?.trim() || "";

    if (reason || diagnosis) {
      const domain = extractDomain(requestText);
      const taskType = extractTaskType(requestText);

      learning = {
        domain,
        taskType,
        mistake: `${reason} ${diagnosis}`.slice(0, 2000),
        correction: diagnosis.includes("fix") || diagnosis.includes("should") || diagnosis.includes("use")
          ? diagnosis.slice(0, 2000)
          : reason.slice(0, 2000),
      };
    }
  }

  return {
    passed,
    evaluation,
    execution: {
      success: execution.success,
      stdout: execution.stdout,
      stderr: execution.stderr,
      error: execution.error,
    },
    learning,
  };
}

/**
 * Autonomous QA ↔ Engineer retry loop.
 *
 * Executes code in the sandbox. If it fails, the Engineer is called to fix it.
 * Repeats up to MAX_RETRIES times with zero human intervention.
 * Returns the final TestResult (pass or fail after exhausting retries).
 */
const MAX_RETRIES = 3;

export async function runQACycle(
  initialCode: string,
  language: string,
  spec: string,
  requestText: string,
  meta?: { runId?: string; slackUserId?: string; dependencies?: string },
  onRetry?: (attempt: number, error: string) => void
): Promise<TestResult & { finalCode: string; finalDependencies?: string; attempts: number }> {
  const { fixCode } = await import("@/core/agents/engineer");

  let code = initialCode;
  let dependencies = meta?.dependencies;
  let lastResult: TestResult | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await testCode(code, language, spec, requestText, {
      ...meta,
      dependencies,
    });

    lastResult = result;

    if (result.passed) {
      // Persist learning on success
      persistLearning(language, spec, code, result, meta?.runId).catch(() => {});
      return { ...result, finalCode: code, finalDependencies: dependencies, attempts: attempt };
    }

    // On failure, log and optionally notify caller
    const errorSummary = result.execution.error || result.execution.stderr || result.evaluation;
    console.warn(`[QA] Attempt ${attempt}/${MAX_RETRIES} FAILED. Sending back to Engineer.`);
    onRetry?.(attempt, errorSummary || "Unknown error");

    if (attempt < MAX_RETRIES) {
      // Ask the Engineer to fix the code
      try {
        const fixed = await fixCode(code, errorSummary || "Execution failed", spec, {
          runId: meta?.runId,
          slackUserId: meta?.slackUserId,
          dependencies,
        });
        code = fixed.code;
        if (fixed.dependencies) dependencies = fixed.dependencies;
      } catch (fixErr) {
        console.error(`[QA] Engineer fixCode failed on attempt ${attempt}:`, fixErr);
        break; // Engineer itself crashed — stop retrying
      }
    }
  }

  // Exhausted all retries — persist learning and return final failure
  if (lastResult) {
    persistLearning(language, spec, code, lastResult, meta?.runId).catch(() => {});
    return { ...lastResult, finalCode: code, finalDependencies: dependencies, attempts: MAX_RETRIES };
  }

  // Fallback (should never reach here)
  return {
    passed: false,
    evaluation: "QA cycle exhausted all retries with no result.",
    execution: { success: false, error: "Max retries exceeded." },
    finalCode: code,
    finalDependencies: dependencies,
    attempts: MAX_RETRIES,
  };
}

/**
 * Save QA learnings to the database for the engineer to improve.
 * Runs in background — failures are silently ignored.
 */
export async function persistLearning(
  language: string,
  spec: string,
  code: string,
  result: TestResult,
  runId?: string
): Promise<void> {
  if (!result.learning) return;

  try {
    await saveEngineerLearning({
      language,
      domain: result.learning.domain,
      taskType: result.learning.taskType,
      mistake: result.learning.mistake,
      correction: result.learning.correction,
      verdict: result.passed ? "pass" : "fail",
      specSnippet: spec?.slice(0, 1000),
      codeSnippet: code?.slice(0, 1000),
      runId,
    });
  } catch (err) {
    // Non-critical — don't let learning persistence break the pipeline
    console.error("[QA] Failed to persist learning:", err);
  }
}

function extractDomain(request: string): string {
  const domains = [
    /api|rest|http|graphql/i, /scraper|scrape|parsing|crawl/i,
    /database|db|sql|postgres|mysql|mongo|sqlite/i, /auth|login|jwt|oauth/i,
    /file|csv|json|excel|pdf|docx/i, /email|smtp|sendgrid/i,
    /slack|discord|telegram|webhook/i, /test|testing|unit test|integration/i,
    /docker|deploy|ci\/cd|kubernetes/i, /automation|cron|scheduled/i,
    /data|analytics|chart|graph|visualization/i, /browser|selenium|playwright|puppeteer/i,
    /cli|command line|argparse/i, /image|resize|convert|compress|ffmpeg/i,
    /payment|stripe|paypal/i, /ai|ml|machine learning|openai|llm/i,
    /search|filter|sort|elasticsearch/i, /notification|push|sms/i,
  ];
  for (const d of domains) {
    if (d.test(request)) return request.match(d)?.[0] || "general";
  }
  return "general";
}

function extractTaskType(request: string): string {
  if (/download|fetch|pull|get|retrieve|scrape|extract/i.test(request)) return "data-fetch";
  if (/send|post|create|write|upload|submit|publish/i.test(request)) return "data-write";
  if (/transform|convert|process|parse|clean|migrate/i.test(request)) return "data-transform";
  if (/search|find|filter|query|lookup/i.test(request)) return "search";
  if (/monitor|track|watch|alert|notify/i.test(request)) return "monitoring";
  if (/report|summary|generate|dashboard|compile/i.test(request)) return "reporting";
  if (/automate|schedule|batch|pipeline/i.test(request)) return "automation";
  if (/api|endpoint|server|route|handler/i.test(request)) return "api";
  if (/deploy|build|package|release/i.test(request)) return "deployment";
  return "general";
}
