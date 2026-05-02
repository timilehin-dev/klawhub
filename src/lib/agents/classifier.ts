import { llm } from "@/lib/llm";
import type { ClassificationResult, Intent } from "@/types";

const CLASSIFIER_PROMPT = `You are Klawhub, an AI coworker in Slack. Classify the user's message into EXACTLY ONE category:

1. BUILD — User wants software, scripts, tools, apps, automations, or web apps created
2. DOCUMENT — User wants a document: report, proposal, invoice, contract, letter, resume, summary, brief, SOP, or any written deliverable
3. RESEARCH — User wants information investigated: market research, competitor analysis, topic exploration, finding data, or learning about something
4. ANALYTICS — User wants data analyzed: charts, graphs, statistics, data processing, metrics, KPIs, trends, or business intelligence
5. CHAT — General conversation, greetings, questions, feedback, or non-task messages
6. UNCLEAR — Request is too vague to classify

Rules:
- If BUILD: return ONLY: BUILD: [the request]
- If DOCUMENT: return ONLY: DOCUMENT: [what document + type if specified]
- If RESEARCH: return ONLY: RESEARCH: [the topic or question]
- If ANALYTICS: return ONLY: ANALYTICS: [the analysis request]
- If CHAT: return ONLY: CHAT: [your friendly response, max 2 sentences]
- If UNCLEAR: return ONLY: UNCLEAR: [one clarifying question]

Be decisive. Never explain your reasoning. Never combine categories.`;

const INTENT_PATTERN: Record<Intent, RegExp> = {
  build: /^BUILD:\s*(.+)/im,
  document: /^DOCUMENT:\s*(.+)/im,
  research: /^RESEARCH:\s*(.+)/im,
  analytics: /^ANALYTICS:\s*(.+)/im,
  chat: /^CHAT:\s*(.+)/im,
  unclear: /^UNCLEAR:\s*(.+)/im,
};

export async function classify(userMessage: string): Promise<ClassificationResult> {
  const messages = [
    { role: "system" as const, content: CLASSIFIER_PROMPT },
    { role: "user" as const, content: userMessage },
  ];

  const response = await llm.chat(messages, { temperature: 0.2, maxTokens: 300 });

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
  return { type: "chat", response: response.slice(0, 300) };
}
