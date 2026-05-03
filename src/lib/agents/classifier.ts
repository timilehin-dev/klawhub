import { llm } from "@/lib/llm";
import { getActiveSkills } from "@/lib/db";
import type { ClassificationResult, Intent } from "@/types";

const CLASSIFIER_PROMPT = `You are a fast intent classifier for Klawhub, a Slack AI coworker. Your ONLY job is to classify the user's message into one intent. Do NOT generate responses.

Return EXACTLY ONE line:
- BUILD: [extracted request]
- DOCUMENT: [extracted request with format if specified]
- RESEARCH: [extracted topic]
- ANALYTICS: [extracted analysis request]
- CHAT: [copy the user message verbatim]
- UNCLEAR: [one short clarifying question]

Classification rules:
- BUILD: code, scripts, apps, tools, automations, APIs
- DOCUMENT: reports, proposals, invoices, contracts, any file generation (PDF/DOCX)
- RESEARCH: web research, finding information, "what is/are", "latest trends"
- ANALYTICS: data analysis, charts, visualizations, statistics
- CHAT: greetings, self-introduction, questions about Klawhub, conversation, anything that doesn't fit above
- UNCLEAR: genuinely ambiguous requests

Be fast and decisive. Never explain. Never combine categories.`;

async function buildClassifierPrompt(): Promise<string> {
  let skillSection = "";
  try {
    const activeSkills = await getActiveSkills();
    if (activeSkills.length > 0) {
      skillSection = "\n\nActive skills to match against:\n" +
        activeSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    }
  } catch { /* non-critical */ }
  return CLASSIFIER_PROMPT + skillSection;
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

  const response = await llm.chat([
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ], { temperature: 0.0, maxTokens: 100 });

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

  // Fallback: chat
  return { type: "chat", response: userMessage };
}
