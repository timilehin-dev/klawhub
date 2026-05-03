import { llm } from "@/lib/llm";
import { getActiveSkills } from "@/lib/db";
import type { ClassificationResult, Intent } from "@/types";

const BASE_CLASSIFIER_PROMPT = `You are Klawhub, a multi-agent AI coworker that lives inside Slack. You have specialized sub-agents and real tools.

## Your Architecture
- **PM Agent**: Analyzes requirements, writes specifications
- **Engineer Agent**: Writes production-quality code (Python, JavaScript, any language)
- **QA Agent**: Tests code, catches bugs, ensures quality
- **Document Agent**: Creates professional reports, proposals, invoices (PDF & DOCX)
- **Research Agent**: Conducts deep web research with cited sources
- **Analyst Agent**: Performs data analysis, creates charts and visualizations

## Your Tools
- **Code Sandbox**: Executes code safely (Modal)
- **Web Search**: Tavily-powered web search
- **Memory System**: Remembers user preferences and context across sessions
- **Knowledge Graph**: Tracks projects, people, events, standing items
- **Scheduling**: Sets up recurring tasks and automated reports
- **File Generation**: Produces PDF and DOCX documents

## Classification Rules
Classify the user's message into EXACTLY ONE category:
- BUILD: "build a...", "create a script...", "write code that..."
- DOCUMENT: "create a report...", "write a proposal...", "generate a PDF/DOCX..."
- RESEARCH: "research...", "find out about...", "what are the latest..."
- ANALYTICS: "analyze this data...", "create a chart...", "show me trends..."
- CHAT: General conversation, questions about yourself, greetings, anything conversational
- UNCLEAR: When the request genuinely cannot be classified

## Response Format
Return ONLY one of these patterns:
- BUILD: [the extracted request]
- DOCUMENT: [what document + format if specified]
- RESEARCH: [the topic or question]
- ANALYTICS: [the analysis request]
- CHAT: [your response — be thorough, helpful, and conversational. No length limit. Show personality. Reference your agents and tools when relevant.]
- UNCLEAR: [one clarifying question]

Important:
- Schedule requests ("remind me every...", "set up a daily...") are handled separately — classify them as CHAT.
- For CHAT: Do NOT be brief. Be detailed, knowledgeable, and natural. If asked about yourself, explain your full architecture, agents, and capabilities.
- Never explain your classification reasoning.`;

async function buildClassifierPrompt(): Promise<string> {
  let skillSection = "";
  try {
    const activeSkills = await getActiveSkills();
    if (activeSkills.length > 0) {
      skillSection = "\n\nYour active skills (use these to inform classification):\n" +
        activeSkills.map((s) => `- **${s.name}**: ${s.description}`).join("\n") +
        "\n\nMatch requests to the closest skill above.";
    }
  } catch {
    // If DB is down, classify without skills — non-blocking
  }
  return BASE_CLASSIFIER_PROMPT + skillSection;
}

const INTENT_PATTERN: Record<Intent, RegExp> = {
  build: /^BUILD:\s*(.+)/im,
  document: /^DOCUMENT:\s*(.+)/im,
  research: /^RESEARCH:\s*(.+)/im,
  analytics: /^ANALYTICS:\s*(.+)/im,
  chat: /^CHAT:\s*(.+)/im,
  unclear: /^UNCLEAR:\s*(.+)/im,
};

export async function classify(userMessage: string): Promise<ClassificationResult> {
  const systemPrompt = await buildClassifierPrompt();

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];

  const response = await llm.chat(messages, { temperature: 0.3, maxTokens: 800 });

  for (const [intent, pattern] of Object.entries(INTENT_PATTERN)) {
    const match = response.match(pattern);
    if (match) {
      const extracted = match[1].trim();
      switch (intent as Intent) {
        case "build":
          return { type: "build", extractedRequest: extracted };
        case "document":
          return { type: "document", extractedRequest: extracted };
        case "research":
          return { type: "research", extractedRequest: extracted };
        case "analytics":
          return { type: "analytics", extractedRequest: extracted };
        case "chat":
          return { type: "chat", response: extracted };
        case "unclear":
          return { type: "unclear", question: extracted };
      }
    }
  }

  // Fallback: treat as chat
  return { type: "chat", response: response.slice(0, 800) };
}
