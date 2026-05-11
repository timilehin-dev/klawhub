import { agentChat } from "@/core/llm";
import { getActiveSkills } from "@/db";
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
  // Continuation / affirmative patterns — follow-ups in threads that should NOT be classified as "unclear"
  /^(yes|yep|yeah|yea|sure|go ahead|do it|proceed|try|start|run|execute|continue|go|let'?s go|let'?s do it|sounds good|perfect|exactly|that works)\b/i,
  /^(suggest|recommend|pick|choose|decide|you decide|your choice|up to you|whatever you think|you choose)\b/i,
  /^(what('?s| is) the (status|progress|update))/i,
  /^status\b/i,
];

interface RegexResult {
  type: Intent;
  extractedRequest: string;
}

function tryRegexClassify(userMessage: string): RegexResult | null {
  const text = userMessage.trim();
  if (!text) return { type: "chat", extractedRequest: text }; // Empty message is chat
  if (text.length < 3) return null; // Too short to classify by regex, let LLM handle or default to unclear

  // Check chat patterns first (cheapest — pure greetings/casual)
  // Length guard: Only short-circuit to chat if message is brief.
  // Long messages starting with "yes" or "go ahead" likely contain real instructions
  // and should fall through to the LLM classifier for proper intent detection.
  if (text.length < 80 && CHAT_PATTERNS.some((p) => p.test(text))) {
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

async function classifyViaLLM(userMessage: string, threadHistory?: string): Promise<ClassificationResult> {
  const systemPrompt = await buildClassifierPrompt();

  const fullMessage = threadHistory
    ? `[PREVIOUS CONTEXT]\n${threadHistory}\n\n[USER'S CURRENT MESSAGE]\n${userMessage}\n\nNote: If the message is a short continuation of the context (like "yes", "go ahead", or a minor fix), classify it as CHAT so the conversational agent can handle it.`
    : userMessage;

  const response = await agentChat("classifier", [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: fullMessage },
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
  return { type: "unclear", question: "I couldn't determine the intent of your request. Could you please rephrase or provide more details?" };
}

/**
 * Classify user intent — regex pre-check first, LLM as fallback.
 * ~40-60% of messages match regex patterns, saving an LLM call each time.
 */
export async function classify(userMessage: string, threadHistory?: string): Promise<ClassificationResult> {
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
  return classifyViaLLM(userMessage, threadHistory);
}
