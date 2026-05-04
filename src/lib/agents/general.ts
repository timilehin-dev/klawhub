import { runToolUseLoop } from "@/lib/tools/executor";
import { runReasoningChain } from "@/lib/agents/reasoning";
import { generalAgentTools } from "@/lib/tools/registry";
import { getActiveSkills, getUserSchedules, getUserSkillStats } from "@/lib/db";
import { buildUserContext } from "@/lib/tools/memory";
import { buildKnowledgeContext } from "@/lib/db/knowledge";

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
• Build: User request → PM (spec) → User approval → Engineer (code) → QA (test) → Delivery
• Document: User request → Document Agent (outline) → User approval → Full generation → Delivery
• Research: User request → Research Agent (web search + synthesis) → Delivery
• Analytics: User request → Analyst Agent (analysis + charts) → Delivery

*How to Respond:*

When users ask about you, your capabilities, or have general conversation:
• Be detailed and specific — name your agents, tools, and workflows
• Reference your actual tools and architecture (don't be vague)
• Be natural and conversational, not robotic
• If the user gives you information about projects, people, or events, save it to memory or knowledge
• If the user asks you to do something, explain how you'd handle it (which agent, which tools)
• Never make up capabilities you don't have

When users ask questions about topics:
• Use web_search if you need current information
• Answer directly and thoroughly
• If they'd benefit from a tool (research, analysis, document), suggest it

When users share information:
• Use memory_save to remember important context
• Use knowledge_search to check if you already know about mentioned entities
• Acknowledge what you've learned

When users ask you to do something complex (multi-step research, analysis across multiple sources, comparisons):
• Use your multi-step reasoning capability to plan before executing
• Break the request into steps and verify each step's result

When context from previous conversation is provided:
• Use it to understand what the user is referring to
• Do NOT re-ask questions that are already answered in the context
• Continue the conversation naturally, building on what was already discussed

Keep responses natural, professional, and helpful. You're a coworker, not a servant.`;

/**
 * Determines if a request is complex enough to warrant multi-step reasoning chains.
 */
function isComplexRequest(message: string): boolean {
  const complexitySignals = [
    /\b(compare|comparison|versus|vs\.?)\b/i,
    /\b(analyze|analysis|investigate)\b/i,
    /\b(multi.?step|step.?by.?step|then|after that|finally)\b/i,
    /\b(and then|first|second|third)\b/i,
    /\b(research.*and|find.*and.*compare|gather.*and.*synthesize)\b/i,
    /\b(create.*report|write.*report|build.*dashboard)\b/i,
    /\b(why|how come|what causes|what leads to)\b/i,
    /\b(pros.*cons|advantages.*disadvantages|trade.?offs?)\b/i,
    /\b(before.*after|impact.*of|effect.*on)\b/i,
    /\b(breakdown|break down|deep.?dive)\b/i,
  ];

  const signalCount = complexitySignals.filter((p) => p.test(message)).length;
  const isLongMessage = message.length > 150;

  return signalCount >= 2 || (signalCount >= 1 && isLongMessage);
}

export interface ChatOptions {
  workspaceId?: string;
  threadHistory?: string;
}

export async function chatAsAgent(
  slackUserId: string,
  userMessage: string,
  options?: ChatOptions
): Promise<string> {
  // Gather all user context in parallel
  const [activeSkills, userSchedules, skillStats, memoryContext, knowledgeContext] = await Promise.all([
    getActiveSkills().catch(() => []),
    getUserSchedules(slackUserId).catch(() => []),
    getUserSkillStats(slackUserId).catch(() => []),
    buildUserContext(slackUserId),
    buildKnowledgeContext(slackUserId),
  ]);

  // Build context blocks using Slack mrkdwn
  const contextBlocks: string[] = [];

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

  const toolContext = {
    slackUserId,
    workspaceId: options?.workspaceId,
  };

  // Build the user message with thread history if available
  let fullMessage = userMessage;
  if (options?.threadHistory) {
    fullMessage = `[PREVIOUS CONVERSATION IN THIS THREAD (use this to understand context):\n${options.threadHistory}]\n\n---\n\n[USER'S CURRENT MESSAGE]:\n${userMessage}`;
  }

  // Use multi-step reasoning for complex requests
  if (isComplexRequest(userMessage)) {
    try {
      const result = await runReasoningChain(fullMessage, {
        tools: generalAgentTools,
        context: toolContext,
        maxSteps: 4,
        maxRetriesPerStep: 1,
        temperature: 0.6,
      });
      return result;
    } catch {
      // If reasoning chain fails, fall back to standard loop
    }
  }

  return runToolUseLoop(fullMessage, {
    systemPrompt,
    tools: generalAgentTools,
    context: toolContext,
    maxIterations: 5,
    temperature: 0.7,
    maxTokens: 4096,
    agentName: "general",
  });
}
