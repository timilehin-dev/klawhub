import { agentChat } from "@/core/llm";
import {
  type ToolDefinition,
  type ToolCall,
  type ToolContext,
  formatToolDescriptions,
} from "@/core/tools/registry";

type Message = { role: "system" | "user" | "assistant"; content: string };

const TOOL_CALL_PATTERN = /\[TOOL:(\w+)\]([\s\S]*?)(?:\[\/TOOL\]|$)/gi;
const METADATA_PATTERN = /<(?:tool_call|thought|internal|call)\|?.*?>/gi;
const JSON_BLOCK_PATTERN = /^\s*\{\s*"thought":[\s\S]*?\}\s*$/gm;

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
 * Remove [TOOL:...][\/TOOL] blocks from a response, keeping surrounding text.
 */
export function stripToolCalls(response: string): string {
  return response
    .replace(TOOL_CALL_PATTERN, "")
    .replace(METADATA_PATTERN, "")
    .replace(JSON_BLOCK_PATTERN, "")
    .replace(/```json\s*\{\s*"thought":[\s\S]*?\}\s*```/gi, "")
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
}

/**
 * Run a tool-use loop: send messages to the LLM, parse tool calls,
 * execute them, feed results back, repeat until a final answer is produced.
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
  } = options;

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

    // Always push the assistant message to the history so the model knows what it did.
    // If it only contained tool calls, content will be empty but the turn is preserved.
    messages.push({ role: "assistant", content: response });

    // Execute all tool calls in parallel
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        const toolDef = toolMap.get(call.tool);
        if (!toolDef) {
          return `[ERROR] Unknown tool "${call.tool}". Available: ${[...toolMap.keys()].join(", ")}`;
        }
        try {
          const result = await toolDef.execute(call.params, context);
          onToolCall?.(call, result);
          return `[RESULT] ${result}`;
        } catch (err) {
          const errorMsg = (err as Error).message?.slice(0, 500) || "Unknown error";
          return `[ERROR] ${errorMsg}`;
        }
      })
    );

    // Feed tool results back as a single user message
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
