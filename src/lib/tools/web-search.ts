import type { WebSearchResult } from "@/types";

class TavilyClient {
  private keys: string[] = [];
  private currentIndex = 0;
  private _maxRetries = 2;
  private initialized = false;

  private init() {
    if (this.initialized) return;
    this.keys = [process.env.TAVILY_API_KEY_1, process.env.TAVILY_API_KEY_2].filter(
      (k): k is string => !!k
    );
    this._maxRetries = this.keys.length || 1;
    this.initialized = true;

    if (this.keys.length === 0) {
      throw new Error("No TAVILY_API_KEY_1 or TAVILY_API_KEY_2 configured");
    }
  }

  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
    this.init();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this._maxRetries; attempt++) {
      const key = this.keys[(this.currentIndex + attempt) % this.keys.length];

      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: key,
            query,
            search_depth: "basic",
            max_results: maxResults,
          }),
        });

        if (!response.ok) {
          if (response.status === 429 && attempt < this._maxRetries - 1) {
            console.warn(`[TAVILY] Key ${attempt + 1} rate limited, rotating...`);
            continue;
          }
          throw new Error(`Tavily error: ${response.status}`);
        }

        const data = await response.json();
        this.currentIndex = (this.currentIndex + attempt + 1) % this.keys.length;
        return data.results as WebSearchResult[];
      } catch (error) {
        lastError = error as Error;
        if (attempt < this._maxRetries - 1) continue;
      }
    }

    throw lastError || new Error("All Tavily API keys exhausted");
  }
}

export const tavily = new TavilyClient();

export async function webSearch(query: string, maxResults = 5): Promise<string> {
  const results = await tavily.search(query, maxResults);
  return results.map((r) => `- **${r.title}** (${r.url}): ${r.content}`).join("\n");
}
