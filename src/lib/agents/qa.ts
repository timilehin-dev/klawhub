import { agentChat } from "@/lib/llm";
import { sandbox } from "@/lib/tools/sandbox";
import { saveEngineerLearning } from "@/lib/db";

const QA_PROMPT = `You are a Senior QA Engineer at Klawhub. You evaluate code ruthlessly against the specification with zero tolerance for shortcuts.

EVALUATION CRITERIA (code must pass ALL of these):
1. RUNNABILITY — Code MUST execute without errors (exit code 0, no unhandled exceptions)
2. CORRECTNESS — Output must match what the specification requested
3. COMPLETENESS — All parts of the spec must be implemented, not just some
4. REAL DATA — No placeholder URLs, no dummy data, no hardcoded fake values, no example.com
5. OUTPUT QUALITY — Output must be meaningful, properly formatted, and useful (not empty, not just debug prints)
6. ERROR HANDLING — Network calls, file I/O, and API calls must have proper try/catch or try/except
7. DEPENDENCIES — Only use libraries that actually exist. Correct import paths. No typos in module names

GRADING SCALE:
- PASS: Code runs successfully, output matches spec, no placeholders, proper error handling
- FAIL: Any of the evaluation criteria above is not met

DIAGNOSIS (when FAIL):
- Identify the EXACT issue (don't just say "it doesn't work")
- Point to the specific line/section that needs fixing
- Suggest what the fix should be
- If it's a library issue (wrong import, deprecated API, missing package), say which library and what the correct usage is

Format your response EXACTLY like this:
VERDICT: <PASS or FAIL>
REASON: <concise explanation of the result>
DIAGNOSIS: <if FAIL, detailed breakdown of what went wrong and how to fix it>
OUTPUT: <what the code actually produced when executed>`;

export interface TestResult {
  passed: boolean;
  evaluation: string;
  execution: {
    success: boolean;
    stdout: string;
    stderr: string;
    error: string | null;
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
  meta?: { runId?: string; slackUserId?: string }
): Promise<TestResult> {
  const execution = await sandbox({ type: "code", code, language });

  const messages = [
    { role: "system" as const, content: QA_PROMPT },
    {
      role: "user" as const,
      content: `Original request: ${requestText}\n\nSpec:\n${spec}\n\nCode:\n${code}\n\nExecution result:\nstdout: ${execution.stdout}\nstderr: ${execution.stderr}\nerror: ${execution.error || "none"}`,
    },
  ];

  const evaluation = await agentChat(
    "qa",
    messages,
    { temperature: 0.2, maxTokens: 2000 },
    meta
  );

  const verdictMatch = evaluation.match(/VERDICT:\s*(PASS|FAIL)/i);
  const passed = verdictMatch?.[1]?.toUpperCase() === "PASS" && execution.success;

  // Extract structured learning from QA evaluation if it failed
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
        correction: diagnosis.includes("fix") || diagnosis.includes("should")
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
    /api|rest|http/i, /scraper|scrape|parsing/i,
    /database|db|sql/i, /auth|login|jwt/i,
    /file|csv|json|excel|pdf/i, /email|slack|discord/i,
    /test/i, /docker|deploy/i, /automation|cron/i,
    /data|analytics|chart/i, /browser|selenium/i,
    /cli|command/i, /image|resize|convert/i,
  ];
  for (const d of domains) {
    if (d.test(request)) return request.match(d)?.[0] || "general";
  }
  return "general";
}

function extractTaskType(request: string): string {
  if (/download|fetch|pull|get/i.test(request)) return "data-fetch";
  if (/send|post|create|write|upload/i.test(request)) return "data-write";
  if (/transform|convert|process|parse/i.test(request)) return "data-transform";
  if (/search|find|filter|query/i.test(request)) return "search";
  if (/monitor|track|watch|alert/i.test(request)) return "monitoring";
  if (/report|summary|generate/i.test(request)) return "reporting";
  if (/scrape|extract|crawl/i.test(request)) return "scraping";
  if (/automate|schedule|batch/i.test(request)) return "automation";
  return "general";
}
