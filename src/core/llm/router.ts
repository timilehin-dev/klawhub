/**
 * LLM Router
 *
 * Selects the correct provider for each agent based on AGENT_PROVIDER_MAP.
 * Handles key rotation, retries, and usage logging.
 */

import { logUsage } from "@/db";
import { getProviders, AGENT_PROVIDER_MAP, DEFAULT_PROVIDER_ID } from "./providers";

export type Message = { role: "system" | "user" | "assistant"; content: string };
export type ChatOptions = { temperature?: number; maxTokens?: number };
export type ChatResult = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export type UsageMeta = {
  workspaceId?: string;
  agentName?: string;
  slackUserId?: string;
  runId?: string;
  taskId?: string;
};

class LLMRouter {
  private providers = getProviders();
  private keyIndexes = new Map<string, number>();

  /** Get provider config for a given agent. Falls back to first provider. */
  private resolveProvider(agentName: string) {
    const assignedId = AGENT_PROVIDER_MAP[agentName] || DEFAULT_PROVIDER_ID;
    let provider = this.providers.find((p) => p.id === assignedId);
    if (!provider) {
      // Fallback to the first available provider if a specific one isn't found or assigned
      provider = this.providers[0];
    }

    if (!provider) {
      throw new Error("No LLM provider configured. Please check your environment variables.");
    }
    return provider;
  }

  /** Get next key for a provider (round-robin). */
  private nextKey(provider: { id: string; keys: string[] }) {
    const idx = (this.keyIndexes.get(provider.id) || 0) % provider.keys.length;
    this.keyIndexes.set(provider.id, idx + 1);
    return provider.keys[idx];
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    const result = await this.chatWithUsage(messages, options);
    return result.content;
  }

  async chatWithUsage(
    messages: Message[],
    options: ChatOptions = {},
    meta?: UsageMeta
  ): Promise<ChatResult> {
    const agentName = meta?.agentName || "unknown";
    const provider = this.resolveProvider(agentName);
    const maxRetries = provider.keys.length;
    console.log(`[LLM] agent=${agentName} provider=${provider.id} model=${provider.model}`);

    const startTime = Date.now();
    let lastError: Error | null = null;
    let usage: ChatResult["usage"];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const key = this.nextKey(provider);

      try {
        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: provider.model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: Math.min(options.maxTokens ?? 8192, 65536),
          }),
          signal: AbortSignal.timeout(300_000), // 5-minute hard timeout per API call
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 && attempt < maxRetries - 1) {
            console.warn(`[LLM:${provider.id}] Key ${attempt + 1} rate limited, rotating...`);
            continue;
          }
          throw new Error(`${provider.id} ${response.status}: ${errorText.slice(0, 200)}`);
        }

        const data = await response.json();

        const content = (data.choices?.[0]?.message?.content as string) || "";
        const rawUsage = data.usage;

        if (rawUsage) {
          usage = {
            promptTokens: rawUsage.prompt_tokens || 0,
            completionTokens: rawUsage.completion_tokens || 0,
            totalTokens: rawUsage.total_tokens || 0,
          };
        }

        const durationMs = Date.now() - startTime;
        logUsage({
          workspaceId: meta?.workspaceId,
          slackUserId: meta?.slackUserId,
          agentName,
          provider: provider.provider,
          model: provider.model,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          durationMs,
          success: true,
          runId: meta?.runId,
          taskId: meta?.taskId,
        }).catch(() => { });

        return { content, usage };
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          console.warn(
            `[LLM:${provider.id}] Key ${attempt + 1} failed: ${(error as Error).message.slice(0, 100)}, rotating...`
          );
          continue;
        }
      }
    }

    // All keys exhausted
    const durationMs = Date.now() - startTime;
    logUsage({
      workspaceId: meta?.workspaceId,
      slackUserId: meta?.slackUserId,
      agentName,
      provider: provider.provider,
      model: provider.model,
      durationMs,
      success: false,
      errorMessage: lastError?.message?.slice(0, 500),
      runId: meta?.runId,
      taskId: meta?.taskId,
    }).catch(() => { });

    throw lastError || new Error(`All ${provider.id} API keys exhausted`);
  }
}

/** Singleton router instance. */
export const llm = new LLMRouter();

/**
 * Agent-scoped chat helper. Routes to the correct provider based on agentName.
 * All agents should use this instead of calling llm.chat() directly.
 */
export async function agentChat(
  agentName: string,
  messages: Message[],
  options: ChatOptions = {},
  meta?: Omit<UsageMeta, "agentName">
): Promise<string> {
  return llm.chatWithUsage(messages, options, { ...meta, agentName }).then((r) => r.content);
}

export async function agentChatWithUsage(
  agentName: string,
  messages: Message[],
  options: ChatOptions = {},
  meta?: Omit<UsageMeta, "agentName">
) {
  return llm.chatWithUsage(messages, options, { ...meta, agentName });
}
