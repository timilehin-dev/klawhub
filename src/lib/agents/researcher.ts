import { runToolUseLoop } from "@/lib/tools/executor";
import { researchAgentTools } from "@/lib/tools/registry";

const RESEARCH_PROMPT = `You are the Research Agent of Klawhub. You conduct thorough web research and synthesize findings.

RULES:
1. Use web_search to find multiple sources on the topic. Start with broad queries, then narrow down.
2. Use web_read to get deeper content from the most relevant results.
3. Cross-reference information from multiple sources.
4. Structure findings clearly with headings and bullet points.
5. Always cite sources with URLs.
6. Be thorough but concise — aim for substance over length.
7. Highlight key takeaways and actionable insights.
8. Do NOT fabricate information — only report what you find from sources.`;

export interface ResearchResult {
  findings: string;
  sources: Array<{ title: string; url: string }>;
}

export async function conductResearch(topic: string, meta?: { taskId?: string; slackUserId?: string }): Promise<ResearchResult> {
  const findings = await runToolUseLoop(topic, {
    systemPrompt: RESEARCH_PROMPT,
    tools: researchAgentTools,
    maxIterations: 10,
    temperature: 0.4,
    context: {
      slackUserId: meta?.slackUserId,
      taskId: meta?.taskId,
    },
    onToolCall(call, result) {
      // Extract URLs from search results for source tracking
      if (call.tool === "web_search" && result.includes("http")) {
        // URLs will be parsed from the findings text
      }
    },
    agentName: "researcher",
  });

  // Extract sources from the findings text
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const urls = [...new Set(findings.match(urlPattern) || [])];
  const sources = urls.slice(0, 10).map((url) => ({
    title: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0],
    url,
  }));

  return { findings, sources };
}
