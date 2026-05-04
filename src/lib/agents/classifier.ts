import { agentChat } from "@/lib/llm";
import { getActiveSkills } from "@/lib/db";
import type { ClassificationResult, Intent } from "@/types";

// ── Regex pre-check patterns (high-confidence shortcuts — skip LLM) ──

const BUILD_PATTERNS = [
  /\b(build|create|write|generate|make|code|develop|implement|script|program|automate)\b.*(script|app|tool|bot|function|api|endpoint|automation|cli|plugin|service|scraper|crawler|parser|converter|calculator|handler|middleware|pipeline|workflow)\b/i,
  /\b(python|javascript|typescript|node|rust|go|java|ruby)\s+(script|code|program|app|function|class|module)\b/i,
  /\b(write|build|create)\s+a\s+(python|javascript|typescript|node|react|next|express|fastapi|flask)\b/i,
  /\b(build|create|make)\s+me\s+(a\s+)?(script|tool|app|bot|automation|function|api)/i,
  /\b(write|build|create)\s+(a\s+)?(REST|GraphQL|webhook|slack|discord|telegram)\b/i,
];

const DOCUMENT_PATTERNS = [
  /\b(create|write|generate|draft|compose|prepare)\s+(a\s+)?(report|proposal|invoice|contract|document|letter|memo|brief|white.?paper|case study|terms|agreement)\b/i,
  /\b(PDF|DOCX|spreadsheet|powerpoint|presentation|slide)\b/i,
  /\b(document|report|proposal|invoice|contract)\s+(for|about|on)\b/i,
];

const RESEARCH_PATTERNS = [
  /\b(research|investigate|find|look\s+into|explore|study|analyze)\b.*(on|about|into|the)\b/i,
  /\b(what\s+(is|are|was|were)|how\s+does|why\s+(do|is|are|does))\b/i,
  /\b(latest\s+(trends|news|developments|updates|research))\b/i,
  /\b(compare|comparison|versus|vs\.?|differences?\s+between)\b/i,
  /\b(pros?\s+and\s+cons|advantages?\s+and\s+disadvantages)\b/i,
  /\b(find\s+(me\s+)?(information|sources|articles|papers|studies|data))\b/i,
];

const ANALYTICS_PATTERNS = [
  /\b(analyze|analysis|visuali[zs]e|chart|graph|plot|dashboard|statistics|correlat)\b/i,
  /\b(data\s+(analysis|analytics|science|viz|visuali[zs]ation))\b/i,
  /\b(show\s+(me\s+)?(trends|patterns|correlations?|insights))\b/i,
  /\b(calculate|compute|aggregate|summarize|break\s+down)\s+(the\s+)?(data|numbers|metrics|stats)\b/i,
];

const CHAT_PATTERNS = [
  /^(hi|hello|hey|sup|yo|morning|evening|afternoon|gm|gn)\b[.!]?\s*$/i,
  /^(thanks?|thank\s+you|thx|ty|cheers)\b/i,
  /^(how\s+are\s+you|what('?s| is)\s+up|what\s+can\s+you\s+do|who\s+are\s+you|help)\b/i,
  /^(ok|okay|cool|nice|great|awesome|lol|haha|😂|👍|✅|❌)\b[.!]?\s*$/i,
];

interface RegexResult {
  type: Intent;
  extractedRequest: string;
}

function tryRegexClassify(userMessage: string): RegexResult | null {
  const text = userMessage.trim();
  if (!text || text.length < 3) return { type: "chat", extractedRequest: text };

  // Check chat patterns first (cheapest — pure greetings/casual)
  if (CHAT_PATTERNS.some((p) => p.test(text))) {
    return { type: "chat", extractedRequest: text };
  }

  // Check task-specific patterns (most valuable to short-circuit)
  if (BUILD_PATTERNS.some((p) => p.test(text))) {
    return { type: "build", extractedRequest: text };
  }
  if (DOCUMENT_PATTERNS.some((p) => p.test(text))) {
    return { type: "document", extractedRequest: text };
  }
  if (ANALYTICS_PATTERNS.some((p) => p.test(text))) {
    return { type: "analytics", extractedRequest: text };
  }
  if (RESEARCH_PATTERNS.some((p) => p.test(text))) {
    return { type: "research", extractedRequest: text };
  }

  return null; // no regex match — fall through to LLM
}

// ── LLM Classifier (fallback when regex doesn't match) ──

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

async function classifyViaLLM(userMessage: string): Promise<ClassificationResult> {
  const systemPrompt = await buildClassifierPrompt();

  const response = await agentChat("classifier", [
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

/**
 * Classify user intent — regex pre-check first, LLM as fallback.
 * ~40-60% of messages match regex patterns, saving an LLM call each time.
 */
export async function classify(userMessage: string): Promise<ClassificationResult> {
  // Fast path: regex pre-check
  const regexResult = tryRegexClassify(userMessage);
  if (regexResult) {
    const { type, extractedRequest } = regexResult;
    switch (type) {
      case "build":
        return { type: "build", extractedRequest };
      case "document":
        return { type: "document", extractedRequest };
      case "research":
        return { type: "research", extractedRequest };
      case "analytics":
        return { type: "analytics", extractedRequest };
      case "chat":
        return { type: "chat", response: extractedRequest };
    }
  }

  // Slow path: LLM classifier
  return classifyViaLLM(userMessage);
}
