import { runToolUseLoop } from "@/core/tools/executor";
import { generalAgentTools } from "@/core/tools/registry";
import { getActiveSkills, getUserSchedules, getUserSkillStats, getActiveAgents } from "@/db";
import { buildUserContext } from "@/core/tools/memory";
import { buildKnowledgeContext } from "@/db/knowledge";
import { agentChat } from "@/core/llm";
import { getSessionSummary } from "@/core/memory/thread-summary";
import { messageBus } from "@/core/a2a/message-bus";
import { PMAgent } from "./pm-agent";
import { ResearcherAgent } from "./researcher-agent";
import { EngineerAgent } from "./engineer-agent";
import { QAAgent } from "./qa-agent";
import { AnalystAgent } from "./analyst-agent";

const GENERAL_AGENT_SYSTEM = `You are Klawhub, a multi-agent AI coworker. You are the conductor of a high-performance orchestration engine.

CORE PRINCIPLES:
1. *Understand First*: Never jump to conclusions. Use the *sequential_thinking* tool to decompose complex user requests, analyze context, and plan your execution BEFORE calling other agents or tools.
2. *Proactive Insight*: If a user's request is underspecified, look at the thread history, workspace memory, and knowledge base. If you find a pattern, propose a solution instead of asking for clarification.
3. *Seamless Execution*: Your goal is a flawless user experience. Coordinate your specialized agents (PM, Engineer, QA, etc.) to deliver finished results, not just intermediate steps.
4. *The Gatekeeper*: Remember that the QA Agent is the final gatekeeper for code. They test what the Engineer writes and handle any GitHub pushes after human approval.

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

*Email Dispatching Capabilities:*
• *Direct Email sending ('resend_send_email')*: You can send transactional emails (summaries, reports, briefs, alerts) directly to any address using the workspace's native, pre-configured **Resend** connection. This **DOES NOT require any Google Workspace/Gmail connection or OAuth flow**. Use this tool when the user simply asks to "email" or "send a mail" with results, without needing it to come from their personal Gmail account.
• *Gmail sending ('gmail_send_email')*: Sends emails from the *user's personal email* account, which **does require Google Workspace/Gmail connection** in the dashboard. Use this only when they explicitly ask to send via their personal/company Gmail.

*Advanced Capabilities:*
• *Multi-step Reasoning* — For complex requests, you can plan → execute → verify → iterate across multiple steps
• *Browser Automation* — You can browse the web like a human: open pages, click buttons, fill forms, wait for content, and scrape results
• *Integration Tools* — If the workspace has Google Drive or GitHub connected, you can search/read files, repos, issues, and code

*Workflow for requests:*
• Build: User request → dispatch_task(type='build') → PM (spec) → User approval → Engineer (code) → QA (test) → Delivery
• Document: User request → dispatch_task(type='document') → Document Agent (outline) → User approval → Full generation → Delivery
• Research: User request → dispatch_task(type='research') → Research Agent (web search + synthesis) → Delivery
• Analytics: User request → dispatch_task(type='analytics') → Analyst Agent (analysis + charts) → Delivery
• Coordinated: User request → coordinate_agents (A2A) → PM/Researcher/Engineer/QA/Analyst coordinate autonomously → Delivery
  USE coordinate_agents for complex multi-step tasks requiring multiple agent types. Individual agent tools available for specific needs.

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

// A2A Agent Coordination
class AgentCoordinator {
  private agents: Map<string, any> = new Map();
  public workspaceId?: string;

  constructor(workspaceId?: string) {
    this.workspaceId = workspaceId;
    this.initializeAgents();
  }

  private initializeAgents() {
    this.agents.set("pm", new PMAgent(this.workspaceId));
    this.agents.set("researcher", new ResearcherAgent(this.workspaceId));
    this.agents.set("engineer", new EngineerAgent(this.workspaceId));
    this.agents.set("qa", new QAAgent(this.workspaceId));
    this.agents.set("analyst", new AnalystAgent(this.workspaceId));
  }

  async coordinateTask(task: any, requester: string): Promise<any> {
    // Determine which agent should handle this
    const agent = this.selectAgent(task);

    if (agent) {
      return agent.executeTask({ ...task, from: requester });
    }

    return null;
  }

  /**
   * Autonomous A2A Discussion Loop
   * Allows multiple agents to collaborate on a complex request before presenting to the user.
   */
  async discussionLoop(initialRequest: string, agentsToInvolve: string[]): Promise<string> {
    let discussionLog = `Discussion started for: "${initialRequest}"\n\n`;
    let currentTurn = 0;
    const maxTurns = 5;
    let nextAgent = agentsToInvolve[0] || "pm";

    while (currentTurn < maxTurns) {
      const agent = this.agents.get(nextAgent);
      if (!agent) break;

      const prompt = `You are participating in an internal multi-agent discussion.
Context so far:
${discussionLog}

Your role: ${nextAgent.toUpperCase()}
Goal: Contribute your expertise to solve the request.
If you have enough information to conclude, start your message with [DONE].
If you need another agent's input, end your message with [NEXT: agent_name].

Your contribution:`;

      const response = await agentChat(nextAgent, [
        { role: "system", content: `You are the ${nextAgent.toUpperCase()} agent. Collaborate with your colleagues.` },
        { role: "user", content: prompt }
      ], { temperature: 0.7 }, { workspaceId: this.workspaceId });

      discussionLog += `*${nextAgent.toUpperCase()}*: ${response}\n\n`;

      if (response.includes("[DONE]")) break;

      const nextMatch = response.match(/\[NEXT: (\w+)\]/);
      if (nextMatch && this.agents.has(nextMatch[1])) {
        nextAgent = nextMatch[1];
      } else {
        // Round robin if not specified
        const currentIndex = agentsToInvolve.indexOf(nextAgent);
        nextAgent = agentsToInvolve[(currentIndex + 1) % agentsToInvolve.length];
      }

      currentTurn++;
    }

    // Final synthesis by General Agent (or PM)
    const synthesisPrompt = `Synthesize the following multi-agent discussion into a final response for the user:
${discussionLog}`;

    return agentChat("general", [
      { role: "system", content: "Synthesize the discussion into a clear, actionable summary for the team." },
      { role: "user", content: synthesisPrompt }
    ], { temperature: 0.5 }, { workspaceId: this.workspaceId });
  }

  private selectAgent(task: any): any {
    const taskType = task.type || this.inferTaskType(task);

    switch (taskType) {
      case "spec":
      case "requirements":
        return this.agents.get("pm");
      case "research":
      case "investigate":
        return this.agents.get("researcher");
      case "code":
      case "implement":
        return this.agents.get("engineer");
      case "test":
      case "qa":
        return this.agents.get("qa");
      case "analyze":
      case "report":
        return this.agents.get("analyst");
      default:
        return this.agents.get("pm"); // Default to PM for analysis
    }
  }

  private inferTaskType(task: any): string {
    const desc = JSON.stringify(task).toLowerCase();

    if (desc.includes("research") || desc.includes("find") || desc.includes("investigate")) {
      return "research";
    }
    if (desc.includes("code") || desc.includes("implement") || desc.includes("build")) {
      return "code";
    }
    if (desc.includes("test") || desc.includes("qa") || desc.includes("check")) {
      return "test";
    }
    if (desc.includes("analyze") || desc.includes("report") || desc.includes("data")) {
      return "analyze";
    }

    return "spec";
  }

  async broadcastUpdate(eventType: string, payload: any): Promise<void> {
    await messageBus.broadcast({
      from: "general",
      type: eventType,
      payload,
    });
  }

  async getAgentCapabilities(): Promise<Record<string, string[]>> {
    const capabilities: Record<string, string[]> = {};

    for (const [name, agent] of this.agents) {
      capabilities[name] = agent.capabilities || [];
    }

    return capabilities;
  }
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

// The AgentCoordinator should be instantiated per request or per workspace to maintain tenant isolation.
// Instantiating it globally will lead to shared state across different workspaces.
// For now, we'll instantiate it within chatAsAgent to ensure isolation.
// const agentCoordinator = new AgentCoordinator();

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

  // Initialize agent coordinator for this workspace
  const agentCoordinator = new AgentCoordinator(options?.workspaceId);

  // Build the user message with thread history if available
  let fullMessage = userMessage;
  if (options?.threadHistory) {
    fullMessage = `*Previous Conversation in this Thread:*
${options.threadHistory}

---

*User's Current Message:*
${userMessage}`;
  }

  // ── FAST PATH: Simple chat — single LLM call, minimal context ──
  // Covers: greetings, short questions, follow-ups, general conversation
  if (!needsTools(userMessage)) {
    const t0 = Date.now();

    // Gather only essential context (memory + knowledge — parallel, lightweight)
    const [memoryContext, knowledgeContext, sessionSummary] = await Promise.all([
      buildUserContext(slackUserId, userMessage, options?.workspaceId),
      buildKnowledgeContext(slackUserId, userMessage, options?.workspaceId),
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
    buildUserContext(slackUserId, userMessage, options?.workspaceId),
    buildKnowledgeContext(slackUserId, userMessage, options?.workspaceId),
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

  // Check for proactive agent coordination opportunities
  // Ensure agentCoordinator is properly initialized with workspaceId before calling proactive actions
  // This line should be moved after the agentCoordinator is correctly set up for the current workspace.
  // For now, assuming agentCoordinator is correctly handling workspace context.
  // await checkProactiveActions(options?.workspaceId, userMessage);

  const result = await runToolUseLoop(fullMessage, {
    systemPrompt,
    tools: generalAgentTools,
    context: toolContext,
    maxIterations: 5,
    temperature: 0.7,
    maxTokens: 4096,
    agentName: "general",
  });

  // Broadcast workspace update to agents
  await agentCoordinator.broadcastUpdate("workspace_update", {
    user: slackUserId,
    message: userMessage,
    channel: options?.slackChannelId,
  });

  console.log(`[PERF] chatAsAgent TOOL path: ${Date.now() - t1}ms`);
  return result;
}

// Proactive agent coordination
async function checkProactiveActions(workspaceId: string | undefined, userMessage: string): Promise<void> {
  // Check if this is a good time for agents to take initiative
  const activeAgents = await getActiveAgents(workspaceId);

  if (activeAgents.length > 0) {
    const agentCoordinator = new AgentCoordinator(workspaceId);
    // Have agents check their patterns
    await agentCoordinator.broadcastUpdate("workspace_update", {
      trigger: "user_message",
      message: userMessage,
    });
  }
}
