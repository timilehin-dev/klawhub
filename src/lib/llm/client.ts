import { logUsage } from "@/lib/db";

type Message = { role: "system" | "user" | "assistant"; content: string };
type ChatOptions = { temperature?: number; maxTokens?: number };
type ChatResult = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

class LLMClient {
  private keys: string[];
  private currentKeyIndex = 0;
  private baseUrl: string;
  private model: string;
  private _maxRetries = 2;
  private initialized = false;

  constructor() {
    this.keys = [];
    this.baseUrl = "";
    this.model = "";
    this._maxRetries = 2;
  }

  private init() {
    if (this.initialized) return;
    this.keys = [process.env.OLLAMA_API_KEY_1, process.env.OLLAMA_API_KEY_2].filter(
      (k): k is string => !!k
    );
    this.baseUrl = process.env.OLLAMA_BASE_URL || "https://api.ollama.com/v1";
    this.model = process.env.OLLAMA_MODEL || "gemma4:31b-cloud";
    this._maxRetries = this.keys.length || 1;
    this.initialized = true;

    if (this.keys.length === 0) {
      throw new Error("No OLLAMA_API_KEY_1 or OLLAMA_API_KEY_2 configured");
    }
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    const result = await this.chatWithUsage(messages, options);
    return result.content;
  }

  async chatWithUsage(
    messages: Message[],
    options: ChatOptions = {},
    meta?: { agentName?: string; slackUserId?: string; runId?: string; taskId?: string }
  ): Promise<ChatResult> {
    this.init();

    const startTime = Date.now();
    let lastError: Error | null = null;
    let usage: ChatResult["usage"];

    for (let attempt = 0; attempt < this._maxRetries; attempt++) {
      const key = this.keys[(this.currentKeyIndex + attempt) % this.keys.length];

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 131072,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 && attempt < this._maxRetries - 1) {
            console.warn(`[LLM] Key ${attempt + 1} rate limited, rotating...`);
            continue;
          }
          throw new Error(`LLM ${response.status}: ${errorText.slice(0, 200)}`);
        }

        const data = await response.json();
        this.currentKeyIndex = (this.currentKeyIndex + attempt + 1) % this.keys.length;

        const content = data.choices?.[0]?.message?.content as string || "";
        const rawUsage = data.usage;

        if (rawUsage) {
          usage = {
            promptTokens: rawUsage.prompt_tokens || 0,
            completionTokens: rawUsage.completion_tokens || 0,
            totalTokens: rawUsage.total_tokens || 0,
          };
        }

        // Log usage in background (non-blocking)
        const durationMs = Date.now() - startTime;
        logUsage({
          slackUserId: meta?.slackUserId,
          agentName: meta?.agentName || "unknown",
          provider: "ollama",
          model: this.model,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          durationMs,
          success: true,
          runId: meta?.runId,
          taskId: meta?.taskId,
        }).catch(() => {});

        return { content, usage };
      } catch (error) {
        lastError = error as Error;
        if (attempt < this._maxRetries - 1) {
          console.warn(`[LLM] Key ${attempt + 1} failed: ${(error as Error).message.slice(0, 100)}, rotating...`);
          continue;
        }
      }
    }

    // Log failure
    const durationMs = Date.now() - startTime;
    logUsage({
      slackUserId: meta?.slackUserId,
      agentName: meta?.agentName || "unknown",
      provider: "ollama",
      model: this.model,
      durationMs,
      success: false,
      errorMessage: lastError?.message?.slice(0, 500),
      runId: meta?.runId,
      taskId: meta?.taskId,
    }).catch(() => {});

    throw lastError || new Error("All LLM API keys exhausted");
  }
}

export const llm = new LLMClient();
