import { agentChat } from "@/core/llm";
import {
  type ToolDefinition,
  type ToolCall,
  type ToolContext,
  formatToolDescriptions,
} from "@/core/tools/registry";

type Message = { role: "system" | "user" | "assistant"; content: string };

const TOOL_CALL_PATTERN = /\[TOOL:(\w+)\]([\s\S]*?)(?:\[\/TOOL\]|$)/gi;
const METADATA_PATTERN = /<(?:tool_call|tool_result|thought|internal|call|\/tool_call|\/tool_result|\/thought|\|assistant\||\|end\||\|user\|)\|?[^>]*>/gi;
const JSON_BLOCK_PATTERN = /^\s*\{\s*"thought":[\s\S]*?\}\s*$/gm;
const DOUBLE_ASTERISK_PATTERN = /\*\*([^*]+)\*\*/g;

/** Maximum ms a single tool call is allowed to run before being timed out */
const TOOL_CALL_TIMEOUT_MS = 30_000;

/**
 * Parse tool calls from an LLM response.
 * Returns an array of {tool, params} objects.
 * If no tool calls are found, returns null.
 */
function parseToolCalls(response: string): ToolCall[] | null {
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  TOOL_CALL_PATTERN.lastIndex = 0;
  while ((match = TOOL_CALL_PATTERN.exec(response)) !== null) {
    const toolName = match[1];
    const rawParams = match[2].trim();

    try {
      const params = JSON.parse(rawParams);
      calls.push({ tool: toolName, params });
    } catch {
      // Try to salvage — treat as single string param
      calls.push({ tool: toolName, params: { input: rawParams } });
    }
  }

  return calls.length > 0 ? calls : null;
}

/**
 * Remove [TOOL:...][\\/TOOL] blocks from a response, keeping surrounding text.
 */
export function stripToolCalls(response: string): string {
  return response
    .replace(TOOL_CALL_PATTERN, "")
    .replace(METADATA_PATTERN, "")
    .replace(JSON_BLOCK_PATTERN, "")
    .replace(/```json\s*\{\s*"thought":[\s\S]*?\}\s*```/gi, "")
    .replace(DOUBLE_ASTERISK_PATTERN, "*$1*")
    .trim();
}

export interface ToolUseOptions {
  maxIterations?: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  context?: ToolContext;
  maxTokens?: number;
  temperature?: number;
  onToolCall?: (call: ToolCall, result: string) => void;
  /** Agent name for usage logging (defaults to "tool-executor") */
  agentName?: string;
  /** Optional trace ID for correlated logging across agent steps */
  traceId?: string;
}

/**
 * Run a tool-use loop: send messages to the LLM, parse tool calls,
 * execute them, feed results back, repeat until a final answer is produced.
 *
 * - Each tool call has a 30s hard timeout to prevent hanging on slow external services.
 * - Uses Promise.allSettled so one failing tool does NOT cancel other parallel calls.
 * - All log lines include the traceId for production debuggability.
 */
export async function runToolUseLoop(
  userMessage: string,
  options: ToolUseOptions
): Promise<string> {
  const {
    maxIterations = 8,
    systemPrompt,
    tools,
    context = {},
    maxTokens = 8192,
    temperature = 0.7,
    onToolCall,
    agentName = "tool-executor",
    traceId,
  } = options;

  const tag = traceId ? `[${agentName}][${traceId}]` : `[${agentName}]`;
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolSection = formatToolDescriptions(tools);

  const messages: Message[] = [
    { role: "system", content: systemPrompt + toolSection },
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    const response = await agentChat(agentName, messages, { temperature, maxTokens }, {
      slackUserId: context.slackUserId,
      runId: context.runId,
      taskId: context.taskId,
    });

    const toolCalls = parseToolCalls(response);

    // No tool calls — this is the final answer
    if (!toolCalls) {
      const cleaned = stripToolCalls(response);
      return cleaned || response;
    }

    messages.push({ role: "assistant", content: response });

    // Execute all tool calls with individual timeouts, using allSettled so one
    // failure never cancels the results of other successfully completed tools.
    const settled = await Promise.allSettled(
      toolCalls.map(async (call) => {
        const toolDef = toolMap.get(call.tool);
        if (!toolDef) {
          return `[ERROR] Unknown tool "${call.tool}". Available: ${[...toolMap.keys()].join(", ")}`;
        }
        try {
          const result = await Promise.race([
            toolDef.execute(call.params, context),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Tool "${call.tool}" timed out after ${TOOL_CALL_TIMEOUT_MS / 1000}s`)),
                TOOL_CALL_TIMEOUT_MS
              )
            ),
          ]);
          onToolCall?.(call, result);
          return `[RESULT] ${result}`;
        } catch (err) {
          const errorMsg = (err as Error).message?.slice(0, 500) || "Unknown error";
          console.error(`${tag} Tool "${call.tool}" failed: ${errorMsg}`);
          return `[ERROR] ${errorMsg}`;
        }
      })
    );

    // Map settled results — fulfilled = value, rejected = error message
    const results = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : `[ERROR] Tool "${toolCalls[i].tool}" threw unexpectedly: ${(s as PromiseRejectedResult).reason?.message || "unknown"}`
    );

    const toolResultsText = results.map((r, i) => `Tool "${toolCalls[i].tool}":\n${r}`).join("\n\n");
    messages.push({ role: "user", content: toolResultsText });
  }

  // Max iterations reached — get a final summary
  messages.push({
    role: "user",
    content:
      "You've used the maximum number of tool calls. Please provide your final answer based on the information gathered so far.",
  });

  const finalResponse = await agentChat(agentName, messages, { temperature, maxTokens }, {
    slackUserId: context.slackUserId,
    runId: context.runId,
    taskId: context.taskId,
  });
  return stripToolCalls(finalResponse) || finalResponse;
}
