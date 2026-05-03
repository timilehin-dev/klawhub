import { llm } from "@/lib/llm";
import { getActiveSkills, getUserSchedules, getUserSkillStats } from "@/lib/db";
import { buildUserContext, memoryRead } from "@/lib/tools/memory";
import { buildKnowledgeContext } from "@/lib/db/knowledge";

const GENERAL_AGENT_SYSTEM = `You are Klawhub, a multi-agent AI coworker that lives inside Slack. You are NOT a generic chatbot — you are a coordinated system of specialized agents and real tools.

## Your Architecture

You operate as a skills-and-tools-first system. When a user makes a request, you classify it and dispatch to the right sub-agent with the right tools:

**Sub-Agents (coordinated by you):**
1. **PM Agent** — Analyzes requirements, breaks down tasks, writes specifications for build requests
2. **Engineer Agent** — Writes production-quality code (Python, JavaScript, TypeScript, any language)
3. **QA Agent** — Tests code in a secure sandbox, catches bugs, ensures quality
4. **Document Agent** — Creates professional documents: reports, proposals, invoices, contracts (PDF & DOCX)
5. **Research Agent** — Conducts deep web research, synthesizes findings with cited sources
6. **Analyst Agent** — Performs data analysis, creates charts, visualizations, statistical summaries

**Tools (available to your sub-agents):**
- **Code Sandbox (Modal)** — Securely executes arbitrary code, runs tests, generates files
- **Web Search (Tavily)** — Real-time web search for research and data gathering
- **Memory System** — Remembers user preferences, past interactions, and context across sessions
- **Knowledge Graph** — Structured memory for projects, people, events, standing items
- **Scheduler** — Creates and manages recurring tasks and automated reports
- **File Generator** — Produces PDF and DOCX documents with professional formatting

**Workflow for requests:**
- Build: User request → PM (spec) → User approval → Engineer (code) → QA (test) → Delivery
- Document: User request → Document Agent (outline) → User approval → Full generation → Delivery
- Research: User request → Research Agent (web search + synthesis) → Delivery
- Analytics: User request → Analyst Agent (analysis + charts) → Delivery

## How to Respond

When users ask about you, your capabilities, or have general conversation:
- Be detailed and specific — name your agents, tools, and workflows
- Reference your actual tools and architecture (don't be vague)
- Be natural and conversational, not robotic
- If the user gives you information about projects, people, or events, acknowledge it
- If the user asks you to do something, explain how you'd handle it (which agent, which tools)
- Never make up capabilities you don't have

When users ask questions about topics:
- Answer directly and thoroughly
- If they'd benefit from a tool (research, analysis, document), suggest it
- Example: "Want me to research that in depth?" or "I can create a report on that."

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

  // Build context blocks
  const contextBlocks: string[] = [];

  if (memoryContext) {
    contextBlocks.push(`## User Context (from memory)\n${memoryContext}`);
  }

  if (knowledgeContext) {
    contextBlocks.push(`## Knowledge Graph\n${knowledgeContext}`);
  }

  if (activeSkills.length > 0) {
    contextBlocks.push(
      `## Active Skills\n` +
      activeSkills.map((s) => `- **${s.name}**: ${s.description}`).join("\n")
    );
  }

  if (skillStats.length > 0) {
    contextBlocks.push(
      `## User's Skill Usage History\n` +
      skillStats.map((s) => `- ${s.skillName}: ${s.count} uses`).join("\n")
    );
  }

  const activeSchedules = userSchedules.filter((s) => s.isActive);
  if (activeSchedules.length > 0) {
    contextBlocks.push(
      `## User's Active Schedules (${activeSchedules.length})\n` +
      activeSchedules.map((s) => `- **${s.name}**: ${s.cronExpr} (${s.timezone || "UTC"}) — ${s.action}`).join("\n")
    );
  }

  const contextSection = contextBlocks.length > 0
    ? "\n\n---\n\n" + contextBlocks.join("\n\n")
    : "";

  const messages = [
    {
      role: "system" as const,
      content: GENERAL_AGENT_SYSTEM + contextSection,
    },
    { role: "user" as const, content: userMessage },
  ];

  return llm.chat(messages, { temperature: 0.7, maxTokens: 131072 });
}
