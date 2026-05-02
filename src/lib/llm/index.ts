type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
};

class LLMClient {
  private keys: string[];
  private currentIndex: number = 0;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.keys = [process.env.OLLAMA_API_KEY_1!, process.env.OLLAMA_API_KEY_2!].filter(
      (k): k is string => !!k
    );
    this.baseUrl = process.env.OLLAMA_BASE_URL || "https://api.ollama.com/v1";
    this.model = process.env.OLLAMA_MODEL || "gemma4:31b-cloud";

    if (this.keys.length === 0) {
      throw new Error("No Ollama API keys configured");
    }
  }

  async chat(messages: Message[], options: ChatOptions = {}) {
    const key = this.keys[this.currentIndex % this.keys.length];
    this.currentIndex++;

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
        // If rate limited, try next key
        if (response.status === 429 && this.keys.length > 1) {
          console.warn(`Key rate limited, failing over...`);
          return this.chat(messages, options);
        }
        throw new Error(`LLM error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      return data.choices[0].message.content as string;
    } catch (error) {
      // Network error fallback
      if (this.keys.length > 1) {
        console.warn(`Key failed, trying next...`);
        return this.chat(messages, options);
      }
      throw error;
    }
  }
}

export const llm = new LLMClient();
