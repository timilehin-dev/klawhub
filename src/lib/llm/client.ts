type Message = { role: "system" | "user" | "assistant"; content: string };
type ChatOptions = { temperature?: number; maxTokens?: number };

class LLMClient {
  private keys: string[];
  private currentKeyIndex = 0;
  private baseUrl: string;
  private model: string;
  private _maxRetries = 2;
  private initialized = false;

  constructor() {
    // Don't throw at module level — collect keys lazily
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
    this.init();

    let lastError: Error | null = null;

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
            max_tokens: options.maxTokens ?? 4096,
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
        return data.choices[0].message.content as string;
      } catch (error) {
        lastError = error as Error;
        if (attempt < this._maxRetries - 1) {
          console.warn(`[LLM] Key ${attempt + 1} failed: ${(error as Error).message.slice(0, 100)}, rotating...`);
          continue;
        }
      }
    }

    throw lastError || new Error("All LLM API keys exhausted");
  }
}

export const llm = new LLMClient();
