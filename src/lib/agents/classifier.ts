import { llm } from "@/lib/llm";
import { getActiveSkills } from "@/lib/db";
import type { ClassificationResult, Intent } from "@/types";

const BASE_CLASSIFIER_PROMPT = `You are Klawhub, an AI coworker in Slack. Classify the user's message into EXACTLY ONE category:

Rules:
- If BUILD: return ONLY: BUILD: [the request]
- If DOCUMENT: return ONLY: DOCUMENT: [what document + type if specified]
- If RESEARCH: return ONLY: RESEARCH: [the topic or question]
- If ANALYTICS: return ONLY: ANALYTICS: [the analysis request]
- If CHAT: return ONLY: CHAT: [your friendly response, max 2 sentences]
- If UNCLEAR: return ONLY: UNCLEAR: [one clarifying question]

Be decisive. Never explain your reasoning. Never combine categories.`;

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
