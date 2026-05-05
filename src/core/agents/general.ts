import { runToolUseLoop } from "@/core/tools/executor";
import { generalAgentTools } from "@/core/tools/registry";
import { getActiveSkills, getUserSchedules, getUserSkillStats } from "@/db";
import { buildUserContext } from "@/core/tools/memory";
import { buildKnowledgeContext } from "@/db/knowledge";
import { agentChat } from "@/core/llm";
import { getSessionSummary } from "@/core/memory/thread-summary";

const GENERAL_AGENT_SYSTEM = `You are Klawhub, a multi-agent AI coworker that lives inside Slack. You are NOT a generic chatbot — you are a coordinated system of specialized agents and real tools.

CRITICAL FORMATTING RULE:
Your responses render in Slack which uses mrkdwn (NOT standard markdown).
- Bold: *text* (single asterisks, NOT **text**)
- Italic: _text_ (underscores)
- Strikethrough: ~text~
- NO headings with # ## ### (they do not render in Slack)
- Use *bold text* for emphasis instead of headings
- Use bullet points with • or numbered lists with 1. 2. 3.

CRITICAL CONTEXT AWARENESS:
When a user sends a message, you may receive previous conversation context from the thread.
Use this context to understand what the user is referring to. If someone says "try again", "fix that",
"make it better", or any vague instruction, look at the context to understand WHAT they mean.
Never say "try what?" or "what do you mean?" if there is context that makes it obvious.
Always infer intent from context before asking for clarification.

Your Architecture:

You operate as a skills-and-tools-first system. When a user makes a request, you classify it and dispatch to the right sub-agent with the right tools.

*Sub-Agents (coordinated by you):*
1. *PM Agent* — Analyzes requirements, breaks down tasks, writes specifications for build requests
2. *Engineer Agent* — Writes production-quality code (Python, JavaScript, TypeScript, any language)
3. *QA Agent* — Tests code in a secure sandbox, catches bugs, ensures quality
4. *Document Agent* — Creates professional documents: reports, proposals, invoices, contracts (PDF and DOCX)
5. *Research Agent* — Conducts deep web research, synthesizes findings with cited sources
6. *Analyst Agent* — Performs data analysis, creates charts, visualizations, statistical summaries

*Tools (available to you directly):*
• *Web Search* — Real-time web search for research and data gathering
• *Web Page Reader* — Read and extract content from URLs
• *Browser Automation* — Browse dynamic pages, scrape with CSS selectors, extract links, interact with forms, take screenshots (requires headless browser)
• *Memory System* — Remember user preferences, past interactions, and context across sessions
• *Knowledge Graph* — Structured memory for projects, people, events, standing items
• *Google Drive* — Search and read files from connected Google Drive
• *GitHub* — Search code, read files, list issues from connected GitHub

*Advanced Capabilities:*
• *Multi-step Reasoning* — For complex requests, you can plan → execute → verify → iterate across multiple steps
• *Browser Automation* — You can browse the web like a human: open pages, click buttons, fill forms, wait for content, and scrape results
• *Integration Tools* — If the workspace has Google Drive or GitHub connected, you can search/read files, repos, issues, and code

*Workflow for requests:*
• Build: User request → dispatch_task(type='build') → PM (spec) → User approval → Engineer (code) → QA (test) → Delivery
• Document: User request → dispatch_task(type='document') → Document Agent (outline) → User approval → Full generation → Delivery
• Research: User request → dispatch_task(type='research') → Research Agent (web search + synthesis) → Delivery
• Analytics: User request → dispatch_task(type='analytics') → Analyst Agent (analysis + charts) → Delivery
• Coordinated: User request → dispatch_task(type='coordinated') → Research Agent + PM Agent IN PARALLEL → Enriched spec → User approval → Engineer → QA → Delivery
  USE 'coordinated' when the task requires BOTH real-time research AND code generation (e.g., "build me a tool using the latest API", "implement something using current best practices")

*How to Respond:*

GOLDEN RULE: DO, don't describe. When the user asks you to do something, use the \`dispatch_task\` tool IMMEDIATELY. Never respond with "I'll spin up the PM Agent" or "Let me coordinate the agents". Your job is to ACT, not narrate.
CRITICAL: NEVER say "what specifically?" or "could you clarify?" when there is ANY context (thread history, previous messages, or conversation flow) that makes intent obvious. If the user says "yes", "go ahead", "do it", "suggest something", or similar — INFER from context what they want and respond accordingly. ONLY ask for clarification when you genuinely have ZERO context to work with.

When users ask about you, your capabilities, or have general conversation:
• Be detailed and specific — name your agents, tools, and workflows
• Reference your actual tools and architecture (don't be vague)
• Be natural and conversational, not robotic
• If the user gives you information about projects, people, or events, save it to memory or knowledge
• Never make up capabilities you don't have

When users ask questions about topics:
• Use web_search if you need current information
• Answer directly and thoroughly
• If they'd benefit from a tool (research, analysis, document), suggest it

When users share information:
• Use memory_save to remember important context
• Use knowledge_search to check if you already know about mentioned entities
• Acknowledge what you've learned

When users say "suggest something" or ask you to take initiative:
• Take initiative! Propose a specific task based on context
• If you know the user's projects/goals from memory, suggest relevant work
• Always follow through with execution, not just suggestions

When users ask you to do something complex (multi-step research, analysis across multiple sources, comparisons):
• Use your multi-step reasoning capability to plan before executing
• Break the request into steps and verify each step's result

When context from previous conversation is provided:
• Use it to understand what the user is referring to
• Do NOT re-ask questions that are already answered in the context
• Continue the conversation naturally, building on what was already discussed
• If user said "yes" or "go ahead", DO the thing that was being discussed

Keep responses natural, professional, and helpful. You're a coworker, not a servant.`;

export interface ChatOptions {
  workspaceId?: string;
  threadHistory?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  slackTeamId?: string;
}

/**
 * Fast path: Single LLM call with minimal context.
 * Used for greetings, short messages, and simple questions that don't need tools.
 */
const FAST_SYSTEM_PROMPT = `You are Klawhub, a multi-agent AI coworker that lives inside Slack. You are NOT a generic chatbot — you are a coordinated system of specialized agents and real tools.

CRITICAL FORMATTING RULE:
Your responses render in Slack which uses mrkdwn (NOT standard markdown).
- Bold: *text* (single asterisks, NOT **text**)
- Italic: _text_ (underscores)
- NO headings with # ## ### (they do not render in Slack)
- Use *bold text* for emphasis instead of headings
- Use bullet points with \u2022 or numbered lists with 1. 2. 3.

GOLDEN RULE: DO, don't describe. Never say "I'll spin up the PM Agent" — ACT, don't narrate.
CRITICAL: NEVER say "what specifically?" when context makes intent clear. INFER from context.

You have specialized sub-agents: PM Agent, Engineer Agent, QA Agent, Document Agent, Research Agent, Analyst Agent.
You have tools: Web Search, Web Page Reader, Browser Automation, Memory System, Knowledge Graph, Google Drive, GitHub.

Be concise, natural, and helpful. You're a coworker, not a servant.`;

/**
 * Detect if a message likely needs tool use (web search, code execution, etc.)
 * vs just a conversational reply.
 */
function needsTools(message: string): boolean {
  const toolSignals = [
    /\b(search|find|look ?up|google|browse|check)\b.*(for|on|about|the|online|web|internet)/i,
    /\b(screenshot|scrape|crawl|extract.*from|read.*url|open.*page)\b/i,
    /\b(https?:\/\/|www\.)\S+/i,
    /\b(execute|run|calculate|compute|convert)\b/i,
    /\b(schedule|remind|cron|recurring|every \d)\b/i,
    /\b(save|remember|store|note)\b.*(this|that|it)/i,
    /\b(github|google drive|drive)\b/i,
    /\b(build|script|code|program|app|automate|analyze|report|document|spec|implement|create|target|task|do it|go ahead|start|execute)\b/i,
  ];
  return toolSignals.some((p) => p.test(message));
}

export async function chatAsAgent(
  slackUserId: string,
  userMessage: string,
  options?: ChatOptions
): Promise<string> {
  const toolContext = {
    slackUserId,
    workspaceId: options?.workspaceId,
    slackChannelId: options?.slackChannelId,
    slackThreadTs: options?.slackThreadTs,
    slackTeamId: options?.slackTeamId,
  };

  // Build the user message with thread history if available
  let fullMessage = userMessage;
  if (options?.threadHistory) {
    fullMessage = `[PREVIOUS CONVERSATION IN THIS THREAD (use this to understand context):\n${options.threadHistory}]\n\n---\n\n[USER'S CURRENT MESSAGE]:\n${userMessage}`;
  }

  // ── FAST PATH: Simple chat — single LLM call, minimal context ──
  // Covers: greetings, short questions, follow-ups, general conversation
  if (!needsTools(userMessage)) {
    const t0 = Date.now();

    // Gather only essential context (memory + knowledge — parallel, lightweight)
    const [memoryContext, knowledgeContext, sessionSummary] = await Promise.all([
      buildUserContext(slackUserId),
      buildKnowledgeContext(slackUserId),
      getSessionSummary(slackUserId),
    ]);

    let systemPrompt = FAST_SYSTEM_PROMPT;
    const contextParts: string[] = [];
    if (sessionSummary) contextParts.push(`*Recent Session Context (cross-thread)*\n${sessionSummary}`);
    if (memoryContext) contextParts.push(`*User Context*\n${memoryContext}`);
    if (knowledgeContext) contextParts.push(`*Knowledge*\n${knowledgeContext}`);
    if (contextParts.length > 0) {
      systemPrompt += "\n\n---\n\n" + contextParts.join("\n\n");
    }

    try {
      const result = await agentChat("general", [
        { role: "system", content: systemPrompt },
        { role: "user", content: fullMessage },
      ], { temperature: 0.7, maxTokens: 2048 }, { slackUserId });

      console.log(`[PERF] chatAsAgent FAST path: ${Date.now() - t0}ms`);
      return result;
    } catch (err) {
      console.error(`[PERF] FAST path failed, falling to tool loop:`, err);
      // Fall through to tool loop
    }
  }

  // ── TOOL PATH: Message needs tools — full context + tool loop ──
  const t1 = Date.now();

  // Gather all context in parallel (only when tools are actually needed)
  const [activeSkills, userSchedules, skillStats, memoryContext, knowledgeContext, sessionSummary] = await Promise.all([
    getActiveSkills().catch(() => []),
    getUserSchedules(slackUserId).catch(() => []),
    getUserSkillStats(slackUserId).catch(() => []),
    buildUserContext(slackUserId),
    buildKnowledgeContext(slackUserId),
    getSessionSummary(slackUserId),
  ]);

  // Build context blocks using Slack mrkdwn
  const contextBlocks: string[] = [];

  if (sessionSummary) {
    contextBlocks.push(`*Recent Session Context (cross-thread)*\n${sessionSummary}`);
  }

  if (memoryContext) {
    contextBlocks.push(`*User Context (from memory)*\n${memoryContext}`);
  }

  if (knowledgeContext) {
    contextBlocks.push(`*Knowledge Graph*\n${knowledgeContext}`);
  }

  if (activeSkills.length > 0) {
    contextBlocks.push(
      `*Active Skills*\n` +
      activeSkills.map((s) => `• *${s.name}*: ${s.description}`).join("\n")
    );
  }

  if (skillStats.length > 0) {
    contextBlocks.push(
      `*User's Skill Usage History*\n` +
      skillStats.map((s) => `• ${s.skillName}: ${s.count} uses`).join("\n")
    );
  }

  const activeSchedules = userSchedules.filter((s) => s.isActive);
  if (activeSchedules.length > 0) {
    contextBlocks.push(
      `*User's Active Schedules (${activeSchedules.length})*\n` +
      activeSchedules.map((s) => `• *${s.name}*: ${s.cronExpr} (${s.timezone || "UTC"}) — ${s.action}`).join("\n")
    );
  }

  const contextSection = contextBlocks.length > 0
    ? "\n\n---\n\n" + contextBlocks.join("\n\n")
    : "";

  const systemPrompt = GENERAL_AGENT_SYSTEM + contextSection;

  const result = await runToolUseLoop(fullMessage, {
    systemPrompt,
    tools: generalAgentTools,
    context: toolContext,
    maxIterations: 5,
    temperature: 0.7,
    maxTokens: 4096,
    agentName: "general",
  });

  console.log(`[PERF] chatAsAgent TOOL path: ${Date.now() - t1}ms`);
  return result;
}
