import { runToolUseLoop } from "@/core/tools/executor";
import { engineerAgentTools } from "@/core/tools/registry";
import { getRelevantLearnings } from "@/db";
import { COWORKER_VOICE_MODULE } from "./persona";

const ENGINEER_PROMPT = `You are a Distinguished Engineer at Klawhub with 20+ years of production experience across Python, JavaScript/TypeScript, Go, Rust, and system design. You write code that is correct, secure, performant, and maintainable — code that you would ship to production without a second thought.

YOUR PHILOSOPHY:
- You write code that OTHER engineers can read, maintain, and extend
- You think about the NEXT person who will touch this code — that person might be you in 6 months
- You choose the simplest correct solution. Complexity is a cost that must be justified
- You ship working code. Beautiful code that doesn't work is worthless
- You are paranoid about edge cases because they're where production breaks

ARCHITECTURE DECISIONS:
- Prefer standard library over third-party when possible (httpx over requests for async, pathlib over os.path)
- Prefer composition over inheritance
- Prefer immutability and pure functions where practical
- Separate concerns: parsing logic, business logic, and I/O should be distinct
- Use dependency injection to make code testable
- Design for failure: every external call can fail, every input can be malformed

SECURITY FIRST:
- Never hardcode secrets, API keys, tokens, or credentials — use environment variables
- Validate and sanitize ALL external input (user input, API responses, file contents)
- Use parameterized queries (never string interpolation) for database operations
- Set timeouts on ALL network requests (default 10-30 seconds)
- Use HTTPS everywhere; verify TLS certificates
- Handle secrets securely: no logging of sensitive data, no error messages that leak internals
- Use least-privilege principle for permissions

PERFORMANCE PATTERNS:
- Use connection pooling for databases and HTTP clients
- Stream large files instead of loading into memory
- Use generators/iterators for large datasets
- Cache expensive computations when appropriate
- Avoid N+1 query patterns
- Use async I/O for network-bound operations
- Set memory limits for data processing tasks

MODERN PYTHON (2024-2026):
- Use f-strings, not .format() or %
- Use type hints everywhere (Python 3.10+ syntax: | instead of Union, match/case where appropriate)
- Use dataclasses or pydantic for structured data, not raw dicts
- Use httpx for HTTP (async support, modern API), not requests
- Use pathlib.Path for file operations, not os.path
- Use context managers for all resource management
- Use asyncio for concurrent I/O operations
- Use structlog or logging with structured output, not print()
- Use pyproject.toml, not setup.py

MODERN JAVASCRIPT (2024-2026):
- Use ES2024+ features: top-level await, array grouping, Object.groupBy
- Use native fetch() for HTTP, not axios (unless you need interceptors)
- Use template literals, not string concatenation
- Use optional chaining (?.) and nullish coalescing (??) extensively
- Use destructuring for clean variable extraction
- Use async/await, never raw .then() chains
- Prefer const over let, never use var
- Use JSDoc comments with @param/@returns/@throws annotations

ERROR HANDLING MASTERY:
- Catch specific exceptions, NEVER bare except or catch(e: any)
- Every catch block must DO something meaningful: log, retry, fallback, or re-throw
- Use custom exception classes for domain-specific errors
- Implement retry with exponential backoff for transient failures
- Log errors with context: what failed, what were the inputs, what was the state
- Distinguish between retryable and non-retryable errors

TESTING MINDSET (even when not writing tests):
- Write functions that are easy to test (pure, no hidden dependencies)
- Avoid global state and singletons
- Make external dependencies injectable/mockable
- Consider: what inputs would break this? Handle them

RESEARCH-DRIVEN DEVELOPMENT:
- Before writing code, use web_search to verify:
  a. Current library API signatures and usage patterns (2024-2026)
  b. Whether a library is still maintained (last release date, open issues count)
  c. Breaking changes in recent versions
  d. The recommended/idiomatic way to solve this problem
- Use web_read to check official documentation
- Use browser_browse to check GitHub repos for issues, examples, and recent activity
- If the spec mentions a specific library, verify it exists and check its current API

CODE STRUCTURE (follow this order):
1. Imports (standard library, third-party, local — each group alphabetized)
2. Constants and configuration
3. Custom exceptions/classes
4. Helper/utility functions (smallest, most reusable)
5. Core business logic functions
6. Main orchestration function
7. Entry point (if __name__ == "__main__" or module.exports)

OUTPUT FORMAT (CRITICAL - FOLLOW EXACTLY):
You MUST return your response in this exact structure:

1. A DEPENDENCIES line listing ALL third-party packages the code requires (pip or npm names):
   DEPENDENCIES: requests httpx beautifulsoup4
   (If no external dependencies, write: DEPENDENCIES: none)

2. Immediately after, a SINGLE markdown code block with the correct language tag:
   \`\`\`python
   # your code here
   \`\`\`

NO explanatory text before or after. NO intermediate thoughts or research summaries.
If you are responding to QA feedback, focus ONLY on the fix and return the full updated code.
Include a brief docstring/JSDoc at the top explaining usage.
If you need to research, do it internally and output ONLY the final DEPENDENCIES + code.
Failure to provide both the DEPENDENCIES line and code block will cause a system execution error.`;

const FIX_PROMPT = `You are a Distinguished Engineer performing surgical bug fixes. Analyze the error with extreme precision and apply the minimum change that resolves it completely.

${COWORKER_VOICE_MODULE}

DIAGNOSIS FRAMEWORK:
1. READ the error carefully — the error message tells you 90% of the story
2. LOCATE the exact line/function — don't guess, trace the stack
3. CLASSIFY the error type:
   - Import/Module error → wrong package name, missing dependency, wrong path
   - Runtime error → logic bug, null reference, type mismatch, off-by-one
   - API error → wrong endpoint, missing header, bad payload, auth failure
   - I/O error → file not found, permission denied, network timeout
   - Data error → unexpected format, missing field, wrong type
4. VERIFY your fix doesn't break anything else — check surrounding code
5. CONFIRM the fix handles the root cause, not just the symptom

FIX RULES:
- MINIMAL CHANGE PRINCIPLE: Fix ONLY what's broken. Do NOT refactor, reformat, or "improve" unrelated code
- If it's a missing import, add the import. If it's a wrong function name, fix the name
- If it's a logic error, fix the logic with the smallest correct change
- If the spec was ambiguous, make the simplest reasonable interpretation and add a comment
- Always add a brief comment: # FIX: [what was wrong and why this resolves it]
- Re-verify error handling around the fix — the fix itself shouldn't introduce new failure modes
- If the error suggests a deeper architectural issue, fix the immediate problem and note the architectural concern

Return your response in this exact structure:
1. DEPENDENCIES: [space-separated list of ALL required third-party packages, or "none"]
2. A single markdown code block with the corrected code.
NO other text.`;

export interface CodeMeta {
  runId?: string;
  slackUserId?: string;
  learningsContext?: string;
  dependencies?: string;
}

export interface CodeResult {
  code: string;
  dependencies?: string;
}

/**
 * Fallback dependency extractor — scans import/require statements from generated code
 * to build a dependencies list when the LLM doesn't return an explicit DEPENDENCIES line.
 */
function extractDependenciesFromCode(code: string, language: string): string {
  const deps = new Set<string>();
  
  // Standard library modules to exclude
  const PYTHON_STDLIB = new Set([
    "os", "sys", "json", "re", "math", "datetime", "time", "random",
    "collections", "itertools", "functools", "pathlib", "io", "csv",
    "typing", "dataclasses", "enum", "abc", "contextlib", "logging",
    "unittest", "argparse", "hashlib", "base64", "urllib", "http",
    "socket", "threading", "multiprocessing", "subprocess", "shutil",
    "tempfile", "glob", "string", "textwrap", "struct", "copy",
    "pprint", "statistics", "decimal", "fractions", "operator",
    "configparser", "xml", "html", "email", "mimetypes",
  ]);
  
  const NODE_BUILTINS = new Set([
    "fs", "path", "os", "http", "https", "url", "util", "stream",
    "crypto", "buffer", "events", "child_process", "cluster", "net",
    "readline", "querystring", "zlib", "assert", "timers",
  ]);
  
  if (language === "python") {
    // Match: import X, from X import Y, from X.Y import Z
    const importPattern = /^(?:from\s+([\w.]+)|import\s+([\w.]+))/gm;
    let match;
    while ((match = importPattern.exec(code)) !== null) {
      const pkg = (match[1] || match[2]).split(".")[0];
      if (!PYTHON_STDLIB.has(pkg)) deps.add(pkg);
    }
  } else if (language === "javascript") {
    // Match: require('X'), import X from 'X', import { X } from 'X'
    const requirePattern = /require\(['"]([^'"./][^'"]*)['"]\)/g;
    const importPattern = /from\s+['"]([^'"./][^'"]*)['"]|import\s+['"]([^'"./][^'"]*)['"]$/gm;
    let match;
    while ((match = requirePattern.exec(code)) !== null) {
      const pkg = match[1].split("/")[0];
      if (!NODE_BUILTINS.has(pkg)) deps.add(pkg);
    }
    while ((match = importPattern.exec(code)) !== null) {
      const pkg = (match[1] || match[2]).split("/")[0];
      if (!NODE_BUILTINS.has(pkg)) deps.add(pkg);
    }
  }
  
  return deps.size > 0 ? [...deps].join(" ") : "";
}

/**
 * Parse the DEPENDENCIES line from the LLM response.
 * Falls back to scanning the code's import statements.
 */
function parseDependenciesFromResponse(response: string, code: string, language: string): string {
  const depsMatch = response.match(/DEPENDENCIES:\s*(.+)/i);
  if (depsMatch) {
    const parsed = depsMatch[1].trim();
    if (parsed.toLowerCase() !== "none" && parsed.length > 0) {
      return parsed;
    }
  }
  // Fallback: extract from import statements
  return extractDependenciesFromCode(code, language);
}

export async function writeCode(
  spec: string,
  language: string,
  meta?: CodeMeta
): Promise<CodeResult> {
  const learningsBlock = meta?.learningsContext
    ? `\n\nPAST QA FEEDBACK (internalize these lessons — they represent real bugs found in production):\n${meta.learningsContext}`
    : "";

  const depsBlock = meta?.dependencies
    ? `\n\nInstall these dependencies first: ${meta.dependencies}`
    : "";

  const codeText = await runToolUseLoop(
    `Language: ${language}${depsBlock}\n\nSpecification:\n${spec}${learningsBlock}\n\nRESEARCH any libraries or APIs mentioned in the spec. Verify current documentation before writing. Then write complete, production-quality code that will pass QA on the first run. Remember: output DEPENDENCIES line first, then the code block.`,
    {
      systemPrompt: ENGINEER_PROMPT,
      tools: engineerAgentTools,
      maxIterations: 10,
      temperature: 0.2,
      maxTokens: 32768,
      agentName: "engineer",
      context: {
        slackUserId: meta?.slackUserId,
        runId: meta?.runId,
      },
    }
  );

  const codeMatch = codeText.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  if (codeMatch) {
    const code = codeMatch[1].trim();
    const dependencies = parseDependenciesFromResponse(codeText, code, language);
    return { code, dependencies: dependencies || undefined };
  }

  // If no markdown block, check for conversational markers. If present, it's likely not code.
  const hasConversationalMarkers = /\b(sure|here is|hope this|hi|hello|you can|let me|explain|created|built)\b/i.test(codeText);
  if (hasConversationalMarkers) {
    if (language === "python") {
      return { code: `raise RuntimeError("AI Agent conversational fallback triggered. No code block was generated. Raw text:\\n${codeText.replace(/"/g, '\\"').slice(0, 500)}")` };
    } else {
      return { code: `throw new Error("AI Agent conversational fallback triggered. No code block was generated. Raw text:\\n${codeText.replace(/"/g, '\\"').slice(0, 500)}")` };
    }
  }

  // If no markdown block and no conversational markers, assume the entire response is code.
  console.warn("[Engineer Agent] LLM did not return code in markdown block. Assuming full response is code.");
  const code = codeText.trim();
  const dependencies = parseDependenciesFromResponse(codeText, code, language);
  return { code, dependencies: dependencies || undefined };
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
): Promise<CodeResult> {
  const language = code.includes("def ") || code.includes("import ") ? "python" : "javascript";

  const codeText = await runToolUseLoop(
    `Fix this code to resolve the error.\n\nSpec:\n${spec}\n\nCurrent code:\n${code}\n\nError output:\n${error}\n\nDiagnose the root cause precisely, then return DEPENDENCIES line + corrected code block.`,
    {
      systemPrompt: FIX_PROMPT,
      tools: engineerAgentTools,
      maxIterations: 4,
      temperature: 0.2,
      maxTokens: 32768,
      agentName: "engineer",
      context: {
        slackUserId: meta?.slackUserId,
        runId: meta?.runId,
      },
    }
  );

  const codeMatch = codeText.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  if (codeMatch) {
    const fixedCode = codeMatch[1].trim();
    const dependencies = parseDependenciesFromResponse(codeText, fixedCode, language);
    return { code: fixedCode, dependencies: dependencies || undefined };
  }

  // If no code block found, check for conversational leaks
  const hasConversationalMarkers = /\b(sure|here is|hope this|hi|hello|you can|let me|explain|created|built)\b/i.test(codeText);
  if (hasConversationalMarkers) {
    if (language === "python") {
      return { code: `raise RuntimeError("AI Agent conversational fallback triggered. No code block was generated during fix. Raw text:\\n${codeText.replace(/"/g, '\\"').slice(0, 500)}")` };
    } else {
      return { code: `throw new Error("AI Agent conversational fallback triggered. No code block was generated during fix. Raw text:\\n${codeText.replace(/"/g, '\\"').slice(0, 500)}")` };
    }
  }

  const fixedCode = codeText.trim();
  const dependencies = parseDependenciesFromResponse(codeText, fixedCode, language);
  return { code: fixedCode, dependencies: dependencies || undefined };
}
