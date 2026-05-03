import { runToolUseLoop } from "@/lib/tools/executor";
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
• *Memory System* — Remember user preferences, past interactions, and context across sessions
• *Knowledge Graph* — Structured memory for projects, people, events, standing items

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

Keep responses natural, professional, and helpful. You're a coworker, not a servant.`;

export async function chatAsAgent(
  slackUserId: string,
  userMessage: string
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
    ? "\n\n———\n\n" + contextBlocks.join("\n\n")
    : "";

  const systemPrompt = GENERAL_AGENT_SYSTEM + contextSection;

  return runToolUseLoop(userMessage, {
    systemPrompt,
    tools: generalAgentTools,
    context: { slackUserId },
    maxIterations: 6,
    temperature: 0.7,
  });
}
