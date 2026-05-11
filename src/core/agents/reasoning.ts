import { agentChat } from "@/core/llm";
import {
  type ToolDefinition,
  type ToolCall,
  type ToolContext,
  formatToolDescriptions,
} from "@/core/tools/registry";

type Message = { role: "system" | "user" | "assistant"; content: string };

const TOOL_CALL_PATTERN = /\[TOOL:(\w+)\]([\s\S]*?)\[\/TOOL\]/g;

import { PERFORMANCE_LOGIC_MODULE } from "./performance-logic";

interface ReasoningStep {
  stepNumber: number;
  action: string;
  tool?: string;
  params?: Record<string, unknown>;
  reasoning: string;
  status: "pending" | "in_progress" | "done" | "error";
  result?: string;
}

interface ReasoningPlan {
  goal: string;
  steps: ReasoningStep[];
  expectedOutcome: string;
}

interface ChainResult {
  goal: string;
  plan: ReasoningPlan;
  steps: ReasoningStep[];
  finalAnswer: string;
  totalIterations: number;
}

/**
 * Multi-step reasoning chain — enhances the standard tool-use loop with:
 * 1. Planning: LLM creates an explicit step-by-step plan before executing
 * 2. Execution: Each step is executed with its own tool context
 * 3. Verification: After each step, the LLM verifies the result meets expectations
 * 4. Adaptation: If verification fails, the LLM can replan remaining steps
 * 5. Iteration: Process continues until all steps are complete or max iterations reached
 */

const PLANNER_SYSTEM_PROMPT = `You are a strategic planning agent. Given a user's request, create a detailed step-by-step plan to accomplish it.

${PERFORMANCE_LOGIC_MODULE}

Your plan must:
1. Break the request into concrete, ordered steps. For complex tasks, STEP 1 should often be calling **sequential_thinking** to finalize the technical strategy.
2. For each step, specify which tool to use (if any) and what parameters. PRIORITIZE FAST TOOLS (Polars, lxml, Crawl4AI).
3. Think about dependencies between steps
4. Consider potential failure points

Respond with your plan in this EXACT format:
[PLAN]
GOAL: <one sentence describing the goal>
OUTCOME: <what the final result should look like>
STEP 1: <action description> | tool: <tool_name or "none"> | params: <JSON or "none">
REASONING: <why this step and why this order. Mention performance benefits of chosen tools.>
STEP 2: <action description> | tool: <tool_name or "none"> | params: <JSON or "none">
REASONING: <why>
STEP 3: ...
[/PLAN]

Keep plans focused — maximum 6 steps. Each step should be concrete and verifiable.
`;

const EXECUTOR_SYSTEM_PROMPT = `You are executing step {step_number} of a plan: "{goal}"

Step {step_number}: {step_action}
{tool_instruction}

Execute this step precisely. Use the available tools if needed. Then verify the result meets the step's objective.

Respond with:
1. Your reasoning for the approach
2. [TOOL:tool_name]{params}[/TOOL] if you need a tool
3. A summary of what you found/did`;

const VERIFIER_SYSTEM_PROMPT = `You are a verification agent. Review the execution result and determine if it meets the step's objective.

Step: {step_action}
Result: {step_result}

Respond with EXACTLY one of:
[VERIFIED] The step is complete. Brief explanation.
[RETRY] The step needs to be retried. Explanation of what went wrong.
[REPLAN] The overall plan needs adjustment. Explanation.`;

const SYNTHESIZER_SYSTEM_PROMPT = `You are a synthesis agent. Given the complete execution trace of a multi-step reasoning chain, produce the final answer to the user's original request.

Original request: {goal}
Plan: {plan_summary}

Execution results:
{step_results}

Synthesize all findings into a clear, comprehensive response. Reference specific data from the steps.`;

function parsePlan(response: string): ReasoningPlan | null {
  const planMatch = response.match(/\[PLAN\]([\s\S]*?)\[\/PLAN\]/);
  if (!planMatch) return null;

  const planText = planMatch[1].trim();
  const goalMatch = planText.match(/GOAL:\s*(.+)/);
  const outcomeMatch = planText.match(/OUTCOME:\s*(.+)/);

  const goal = goalMatch?.[1]?.trim() || "Unknown";
  const expectedOutcome = outcomeMatch?.[1]?.trim() || "Complete the request";

  const stepMatches = [...planText.matchAll(/STEP (\d+):\s*(.+?)\s*\|\s*tool:\s*(\w+|none)\s*\|\s*params:\s*([\s\S]*?)(?=\nSTEP \d+:|\[\/PLAN\]|$)/gi)]; // Adjusted regex for params and next step boundary
  const reasoningMatches = [...planText.matchAll(/REASONING:\s*([\s\S]*?)(?=\nSTEP \d+:|\[\/PLAN\]|$)/gi)]; // Adjusted regex for next step boundary

  const steps: ReasoningStep[] = stepMatches.map((match, i) => {
    let params: Record<string, unknown> | undefined;
    const rawParams = match[4].trim();
    if (rawParams !== "none") {
      try {
        params = JSON.parse(rawParams);
      } catch (e) {
        console.warn(`[Reasoning] Failed to parse params for step ${match[1]}: ${rawParams}. Error: ${e instanceof Error ? e.message : String(e)}`);
        // Fallback to treating as a string if JSON parsing fails, or set to undefined
        params = { raw: rawParams }; // Or just `undefined` if no fallback is desired
      }
    }

    return {
      stepNumber: parseInt(match[1]),
      action: match[2].trim(),
      tool: match[3] === "none" ? undefined : match[3],
      params: params,
      reasoning: reasoningMatches[i]?.[1]?.trim() || "",
      status: "pending" as const,
    };
  });

  return { goal, expectedOutcome, steps };
}

function parseVerification(response: string): { verdict: "verified" | "retry" | "replan"; reason: string } {
  if (response.includes("[VERIFIED]")) {
    const reason = response.replace(/.*\[VERIFIED\]\s*/i, "").trim().slice(0, 200);
    return { verdict: "verified", reason };
  }
  if (response.includes("[RETRY]")) {
    const reason = response.replace(/.*\[RETRY\]\s*/i, "").trim().slice(0, 200);
    return { verdict: "retry", reason };
  }
  if (response.includes("[REPLAN]")) {
    const reason = response.replace(/.*\[REPLAN\]\s*/i, "").trim().slice(0, 200);
    return { verdict: "replan", reason };
  }
  // Default: assume verified if no explicit marker
  return { verdict: "verified", reason: response.slice(0, 200) };
}

function parseToolCalls(response: string): ToolCall[] | null {
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;
  TOOL_CALL_PATTERN.lastIndex = 0;
  while ((match = TOOL_CALL_PATTERN.exec(response)) !== null) {
    try {
      calls.push({ tool: match[1], params: JSON.parse(match[2].trim()) });
    } catch (e) {
      console.warn(`[Reasoning] Failed to parse JSON params for tool '${match[1]}': ${match[2].trim()}. Error: ${e instanceof Error ? e.message : String(e)}`);
      // Fallback to input, but log the error for debugging LLM output issues.
      calls.push({ tool: match[1], params: { input: match[2].trim() } });
    }
  }
  return calls.length > 0 ? calls : null;
}

function stripToolCalls(response: string): string {
  return response.replace(TOOL_CALL_PATTERN, "").trim();
}

async function executeToolCall(
  call: ToolCall,
  tools: ToolDefinition[],
  context: ToolContext
): Promise<string> {
  const toolDef = tools.find((t) => t.name === call.tool);
  if (!toolDef) return `[ERROR] Unknown tool "${call.tool}"`;
  try {
    return await toolDef.execute(call.params, context);
  } catch (err) {
    return `[ERROR] ${(err as Error).message.slice(0, 300)}`;
  }
}

export interface ReasoningChainOptions {
  tools: ToolDefinition[];
  context?: ToolContext;
  maxSteps?: number;
  maxRetriesPerStep?: number;
  temperature?: number;
  onStepComplete?: (step: ReasoningStep) => void;
  systemPrompt?: string;
}

/**
 * Run a multi-step reasoning chain.
 * 1. Plan the approach
 * 2. Execute each step with tools
 * 3. Verify results
 * 4. Adapt if needed
 * 5. Synthesize final answer
 */
export async function runReasoningChain(
  userMessage: string,
  options: ReasoningChainOptions
): Promise<string> {
  const {
    tools,
    context = {},
    maxSteps = 10,
    maxRetriesPerStep = 3,
    temperature = 0.5,
    onStepComplete,
  } = options;

  const toolDescriptions = formatToolDescriptions(tools);
  const meta = {
    slackUserId: context.slackUserId,
    runId: context.runId,
    taskId: context.taskId,
  };

  // ── Phase 1: Plan ──
  const planningResponse = await agentChat("reasoning-planner", [
    { role: "system", content: PLANNER_SYSTEM_PROMPT + "\n\n" + toolDescriptions },
    { role: "user", content: userMessage },
  ], { temperature, maxTokens: 8192 }, meta);

  const plan = parsePlan(planningResponse);
  if (!plan || plan.steps.length === 0) {
    // Fallback: if planning fails, just use the standard tool-use loop
    const { runToolUseLoop } = await import("@/core/tools/executor");
    console.warn("[Reasoning] Planner failed to generate a valid plan. Falling back to direct tool use loop.");
    return runToolUseLoop(userMessage, {
      systemPrompt: options.systemPrompt || PLANNER_SYSTEM_PROMPT, // Use original system prompt if available, or a more specific fallback
      tools,
      context,
      maxIterations: 15,
      temperature,
      agentName: "reasoning-fallback",
    });
  }

  // Trim to max steps
  const steps = plan.steps.slice(0, maxSteps);
  const stepResults: string[] = [];

  // ── Phase 2: Execute each step ──
  for (const step of steps) {
    let retries = 0;
    let result = "";
    let verified = false;

    while (!verified && retries <= maxRetriesPerStep) {
      retries++;

      // Build the tool instruction
      const toolInstruction = step.tool && step.tool !== "none"
        ? `Available tool: ${step.tool}${step.params ? ` with params: ${JSON.stringify(step.params)}` : ""}. Use it with [TOOL:${step.tool}]{params}[/TOOL] format.`
        : "No tool needed — reason through this step using the information available.";

      // Execute step
      const executorPrompt = EXECUTOR_SYSTEM_PROMPT
        .replace("{step_number}", String(step.stepNumber))
        .replace("{goal}", plan.goal)
        .replace("{step_action}", step.action)
        .replace("{tool_instruction}", toolInstruction);

      const contextInfo = stepResults.length > 0
        ? `\n\nPrevious step results:\n${stepResults.map((r, i) => `Step ${i + 1}: ${r.slice(0, 500)}`).join("\n")}`
        : "";

      const executionResponse = await agentChat("reasoning-executor", [
        { role: "system", content: executorPrompt + "\n\n" + toolDescriptions },
        { role: "user", content: userMessage + contextInfo },
      ], { temperature, maxTokens: 16384 }, meta);

      // Execute any tool calls in the response
      const toolCalls = parseToolCalls(executionResponse);
      let toolResultText = "";
      if (toolCalls) {
        const results = await Promise.all(
          toolCalls.map((call) => executeToolCall(call, tools, context))
        );
        toolResultText = results.join("\n\n");
      }

      result = stripToolCalls(executionResponse) + (toolResultText ? `\n\n[TOOL RESULTS]\n${toolResultText}` : "");
      step.result = result;
      
      // ── Phase 3: Verify ──
      const isSubstantialOutput = result.length >= 100 && !result.includes("[ERROR]");
      
      // Skip verifier if we're on the last retry and output looks okay
      if (retries > maxRetriesPerStep && isSubstantialOutput) {
        verified = true;
        step.status = "done";
      } else {
        const verifyResponse = await agentChat("reasoning-verifier", [
          {
            role: "system",
            content: VERIFIER_SYSTEM_PROMPT
              .replace("{step_action}", step.action)
              .replace("{step_result}", result.slice(0, 2000)),
          },
        ], { temperature: 0.3, maxTokens: 512 }, meta);

        const verification = parseVerification(verifyResponse);

        if (verification.verdict === "verified") {
          verified = true;
          step.status = "done";
        } else if (verification.verdict === "retry") {
          step.status = "pending";
          // continue while loop
        } else { // replan
          step.status = "done";
          stepResults.push(`${step.action}: ${result.slice(0, 500)} (Replanned: ${verification.reason})`);
          onStepComplete?.(step);
          break; // break while loop
        }
      }

      if (verified) {
        stepResults.push(`${step.action}: ${result.slice(0, 500)}`);
        onStepComplete?.(step);
      }
    }
  }

// ── Phase 4: Synthesize ──
const planSummary = steps.map((s) => `${s.stepNumber}. ${s.action}`).join("\n");
const stepResultsText = stepResults.map((r, i) => `Step ${i + 1}: ${r}`).join("\n\n");

const synthesizedResponse = await agentChat("reasoning-synthesizer", [
  {
    role: "system",
    content: SYNTHESIZER_SYSTEM_PROMPT
      .replace("{goal}", plan.goal)
      .replace("{plan_summary}", planSummary)
      .replace("{step_results}", stepResultsText),
  },
], { temperature: 0.5, maxTokens: 16384 }, meta);

return synthesizedResponse;
}
