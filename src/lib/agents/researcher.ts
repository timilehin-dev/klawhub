import { llm } from "@/lib/llm";
import { webSearch } from "@/lib/tools/web-search";
import { sandbox } from "@/lib/tools/sandbox";

const RESEARCH_PROMPT = `You are the Research Agent of Klawhub. You conduct thorough web research and synthesize findings.

RULES:
1. Search for multiple relevant queries to get comprehensive results.
2. Read full pages when URLs are available to get deeper context.
3. Cross-reference information from multiple sources.
4. Structure findings clearly with headings and bullet points.
5. Always cite sources with URLs.
6. Be thorough but concise — aim for substance over length.`;

export async function conductResearch(topic: string) {
  // Step 1: Generate search queries
  const queryMessages = [
    { role: "system" as const, content: "Generate 3 specific search queries for researching this topic. Return ONLY the queries, one per line, no numbering." },
    { role: "user" as const, content: topic },
  ];
  const queriesRaw = await llm.chat(queryMessages, { temperature: 0.3, maxTokens: 200 });
  const queries = queriesRaw.split("\n").map((q: string) => q.trim()).filter(Boolean);

  // Step 2: Execute searches
  const allResults: Array<{ title: string; url: string; content: string }> = [];
  for (const query of queries.slice(0, 3)) {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY_1 || process.env.TAVILY_API_KEY_2,
        query,
        search_depth: "advanced",
        max_results: 5,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      allResults.push(...(data.results || []));
    }
  }

  // Step 3: Read top 3 pages for deeper context
  const pageContents: string[] = [];
  for (const result of allResults.slice(0, 3)) {
    try {
      const pageResult = await sandbox({ type: "web_read", url: result.url });
      if (pageResult.success && pageResult.content) {
        pageContents.push(`--- ${result.title} ---\n${pageResult.content.slice(0, 3000)}`);
      }
    } catch {
      // Skip failed page reads
    }
  }

  // Step 4: Synthesize findings
  const sourcesText = allResults
    .slice(0, 8)
    .map((r) => `- ${r.title}: ${r.content.slice(0, 200)}`)
    .join("\n");

  const pagesText = pageContents.join("\n\n");

  const synthMessages = [
    { role: "system" as const, content: RESEARCH_PROMPT },
    {
      role: "user" as const,
      content: `Research topic: ${topic}\n\nSources found:\n${sourcesText}\n\nDetailed page contents:\n${pagesText || "No detailed pages available."}`,
    },
  ];

  const findings = await llm.chat(synthMessages, { temperature: 0.4, maxTokens: 3000 });

  return {
    findings,
    sources: allResults.slice(0, 8).map((r) => ({ title: r.title, url: r.url })),
  };
}
