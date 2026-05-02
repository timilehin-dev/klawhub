import { llm } from "@/lib/llm";
import { tavily, webSearch } from "@/lib/tools/web-search";
import { sandbox } from "@/lib/tools/sandbox";

const RESEARCH_PROMPT = `You are the Research Agent of Klawhub. You conduct thorough web research and synthesize findings.

RULES:
1. Cross-reference information from multiple sources.
2. Structure findings clearly with headings and bullet points.
3. Always cite sources with URLs in footnotes.
4. Be thorough but concise — aim for substance over length.
5. Highlight key takeaways and actionable insights.`;

export async function conductResearch(topic: string) {
  // Step 1: Generate search queries
  const queryMessages = [
    {
      role: "system" as const,
      content: "Generate 3 specific search queries for researching this topic. Return ONLY the queries, one per line, no numbering.",
    },
    { role: "user" as const, content: topic },
  ];
  const queriesRaw = await llm.chat(queryMessages, { temperature: 0.3, maxTokens: 200 });
  const queries = queriesRaw
    .split("\n")
    .map((q: string) => q.replace(/^[\d.\-\s]+/, "").trim())
    .filter(Boolean);

  // Step 2: Execute searches using shared Tavily client (with key rotation)
  const allResults: Array<{ title: string; url: string; content: string }> = [];
  for (const query of queries.slice(0, 3)) {
    try {
      const results = await tavily.search(query, 5);
      allResults.push(...results);
    } catch (err) {
      console.warn(`[RESEARCH] Search failed for "${query}":`, (err as Error).message);
    }
  }

  // Step 3: Read top 3 pages for deeper context (parallel)
  const pagesToRead = allResults.slice(0, 3);
  const pageReadPromises = pagesToRead.map(async (result) => {
    try {
      const pageResult = await sandbox({ type: "web_read", url: result.url });
      if (pageResult.success && pageResult.content) {
        return `--- ${result.title} ---\n${pageResult.content.slice(0, 3000)}`;
      }
    } catch {
      // Skip failed page reads
    }
    return null;
  });
  const pageContents = (await Promise.all(pageReadPromises)).filter(
    (c): c is string => c !== null
  );

  // Step 4: Synthesize findings
  const sourcesText = allResults
    .slice(0, 8)
    .map((r) => `- **${r.title}** (${r.url}): ${r.content.slice(0, 200)}`)
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
    sources: allResults
      .slice(0, 8)
      .map((r) => ({ title: r.title, url: r.url })),
  };
}
