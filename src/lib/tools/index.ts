import { db } from "@/lib/db";
import { memory, runs } from "@/lib/db/schema";
import { eq, ilike, and } from "drizzle-orm";

class TavilyClient {
  private keys: string[];
  private currentIndex: number = 0;

  constructor() {
    this.keys = [process.env.TAVILY_API_KEY_1!, process.env.TAVILY_API_KEY_2!].filter(
      (k): k is string => !!k
    );
  }

  async search(query: string, maxResults: number = 5) {
    const key = this.keys[this.currentIndex % this.keys.length];
    this.currentIndex++;

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
      if (response.status === 429 && this.keys.length > 1) {
        return this.search(query, maxResults);
      }
      throw new Error(`Tavily error: ${response.status}`);
    }

    const data = await response.json();
    return data.results as Array<{ title: string; url: string; content: string }>;
  }
}

const tavily = new TavilyClient();

export const tools = {
  // 1. Web search
  web_search: async ({ query }: { query: string }) => {
    const results = await tavily.search(query);
    return results.map((r) => `- ${r.title}: ${r.content}`).join("\n");
  },

  // 2. Read memory
  memory_read: async ({ slackUserId, query }: { slackUserId: string; query: string }) => {
    const rows = await db
      .select()
      .from(memory)
      .where(and(eq(memory.slackUserId, slackUserId), ilike(memory.content, `%${query}%`)))
      .limit(5);
    return rows.map((r) => r.content).join("\n") || "No relevant memory found.";
  },

  // 3. Write memory
  memory_write: async ({
    slackUserId,
    content,
    category,
  }: {
    slackUserId: string;
    content: string;
    category?: string;
  }) => {
    await db.insert(memory).values({ slackUserId, content, category: category || "general" });
    return "Memory saved.";
  },

  // 4. Execute code via Modal
  code_execute: async ({ code, language }: { code: string; language: string }) => {
    const modalUrl = process.env.MODAL_FUNCTION_URL;
    if (!modalUrl) throw new Error("MODAL_FUNCTION_URL not set");

    const response = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      throw new Error(`Modal error: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as {
      passed: boolean;
      stdout: string;
      stderr: string;
      error?: string;
    };
  },

  // 5. Update run status in DB
  update_run: async ({
    runId,
    updates,
  }: {
    runId: string;
    updates: Partial<typeof runs.$inferInsert>;
  }) => {
    await db.update(runs).set(updates).where(eq(runs.id, runId));
    return "Run updated.";
  },
};
