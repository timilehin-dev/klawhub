import { runToolUseLoop } from "@/core/tools/executor";
import { generalAgentTools, ToolContext } from "@/core/tools/registry";
import { getActiveSkills, getUserSchedules, getUserSkillStats, getMcpServers } from "@/db";
import { buildUserContext } from "@/core/tools/memory";
import { buildKnowledgeContext } from "@/db/knowledge";
import { agentChat } from "@/core/llm";
import { getSessionSummary } from "@/core/memory/thread-summary";
import { mcpManager } from "@/core/tools/mcp-client";
import { updateMessage } from "@/integrations/slack/client";
import { COWORKER_VOICE_MODULE } from "./persona";

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

TOOL AWARENESS RULES (Mapping Intents to Actions):
You serve organizations of ALL types — law firms, hospitals, NGOs, marketing agencies, startups, enterprises. Not every request involves code. Classify intent correctly before dispatching.

*Scheduling:*
• "Schedule this", "Remind me every day", "Run this periodically" → MUST use \`schedule_create\`.
• "Stop/pause/resume schedule" → use \`schedule_list\` then \`schedule_toggle\`.
• "Change the schedule time/action" → use \`schedule_list\` then \`schedule_edit\`.
• "Delete schedule" → use \`schedule_list\` then \`schedule_delete\`.

*Knowledge Work (NO code involved):*
• "Summarize this", "Give me a summary", "TL;DR" → use \`dispatch_task\` (type='assist') or answer directly if short.
• "Draft an email", "Write a message", "Compose a reply" → use \`dispatch_task\` (type='assist').
• "Advise me on", "What do you think about", "Should I..." → answer directly or use \`dispatch_task\` (type='assist').
• "Explain", "What is", "How does X work" → answer directly if you know it; use \`dispatch_task\` (type='research') if deep research is needed.
• "Review this document", "Give feedback on" → use \`dispatch_task\` (type='assist').

*Document Creation:*
• "Write a proposal", "Create a report", "Draft a contract", "Generate an invoice", "Write a plan" → MUST use \`dispatch_task\` (type='document').

*Research:*
• "Research X", "Find out about Y", "What are the latest trends in Z" → use \`dispatch_task\` (type='research') or \`web_search\` directly for quick lookups.

*Data & Analytics:*
• "Analyze this data", "Create a chart", "Visualize", "Run statistics" → use \`dispatch_task\` (type='analytics').

*Software/Automation (Code required):*
• "Build a feature", "Write a script", "Create an app", "Automate this", "Code a tool" → MUST use \`dispatch_task\` (type='build').
• "Research AND build", "Find the best approach and implement it" → use \`dispatch_task\` (type='coordinated').

• Any complex, ambiguous, or multi-step logic → MUST use \`sequential_thinking\` FIRST to plan your approach.

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
• *Web Research (Reliability Tip)* — Always prefer \`web_read\` for basic text extraction and research. It uses the stable Modal sandbox. ONLY use \`browser_*\` tools (like \`browser_interact\` or \`browser_screenshot\`) if you need full visual rendering or interaction. If a browser tool fails with an "unconfigured" error, immediately pivot to \`web_read\`.
• *Integration Tools* — If the workspace has Google Drive or GitHub connected, you can search/read files, repos, issues, and code

*Workflow for requests:*
• Assist: User request → answer directly (short) OR dispatch_task(type='assist') → Research/General Agent synthesizes → Delivery
• Research: User request → dispatch_task(type='research') → Research Agent (web search + synthesis) → Delivery
• Document: User request → dispatch_task(type='document') → Document Agent → Delivery
• Analytics: User request → dispatch_task(type='analytics') → Analyst Agent (analysis + charts) → Delivery
• Build: User request → dispatch_task(type='build') → PM (spec) → User approval → Engineer (code) → QA (test + retry) → Delivery
• Coordinated: User request → dispatch_task(type='coordinated') → Research → PM Spec → Approval → Engineer → QA → Delivery
  USE 'coordinated' when the user explicitly needs research-informed code/automation.

*How to Respond:*

GOLDEN RULE: DO, don't describe. When the user asks you to do something, use the \`dispatch_task\` tool IMMEDIATELY. Never respond with "I'll spin up the PM Agent" or "Let me coordinate the agents". Your job is to ACT, not narrate.

REQUEST DECOMPOSITION:
If a user makes a multi-part request (e.g., "research X and then build a tool for it"):
1. Use \`sequential_thinking\` to break it down.
2. DO NOT try to dispatch both tasks at once if one depends on the other. 
3. Dispatch the first task (e.g., research), and wait for the results in the thread context before proceeding to the next step.

CONTEXT-FIRST DISAMBIGUATION:
CRITICAL: NEVER say "what specifically?" or "could you clarify?" when there is ANY context (thread history, session summary) that makes intent obvious.
1. Check thread history, memory, and knowledge BEFORE asking clarifying questions.
2. If context resolves the ambiguity, ACT on it immediately.
3. If the user says "yes", "go ahead", "do it" — INFER from context what they want and respond accordingly.
4. ONLY ask for clarification when you genuinely have ZERO context to work with.

RESPONSE CALIBRATION:
- Simple question → Answer directly in 1-3 sentences.
- Status check → Use a clear bulleted list.
- Complex analysis → Use structured sections with mrkdwn headers (e.g., *Section Name*). Do not write monolithic essays.

When users ask about you, your capabilities, or have general conversation:
• Be detailed and specific — name your agents, tools, and workflows
• Reference your actual tools and architecture (don't be vague)
• Be natural and conversational, not robotic
• If the user gives you information about projects, people, or events, save it to memory or knowledge
• Never make up capabilities you don't have

When users say "suggest something" or ask you to take initiative:
• Take initiative! Propose a specific task based on context
• If you know the user's projects/goals from memory, suggest relevant work
• Always follow through with execution, not just suggestions

Keep responses natural, professional, and helpful. You're a coworker, not a servant.

${COWORKER_VOICE_MODULE}
`;

export interface ChatOptions {
  workspaceId?: string;
  threadHistory?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  slackTeamId?: string;
  statusMessageTs?: string;
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
    fullMessage = `*Previous Conversation in this Thread:*
${options.threadHistory}

---

*User's Current Message:*
${userMessage}`;
  }

  // ── All messages go through the full tool loop for consistent tool access ──
  const t1 = Date.now();

  // Gather all context in parallel with a 5s independent timeout per fetch.
  // If Supabase cold-starts or any fetch hangs, we proceed with whatever completed,
  // preventing a single slow query from discarding other successful context.
  const DB_CONTEXT_TIMEOUT_MS = 5_000;

  async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timeoutId: any;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutId = setTimeout(() => {
        console.warn(`[general][${slackUserId}] A DB query timed out after ${timeoutMs}ms — falling back`);
        resolve(fallback);
      }, timeoutMs);
    });
    return Promise.race([
      promise.then((res) => {
        clearTimeout(timeoutId);
        return res;
      }),
      timeoutPromise
    ]).catch(() => fallback);
  }

  const [activeSkills, userSchedules, skillStats, memoryContext, knowledgeContext, sessionSummary] =
    await Promise.all([
      withTimeout(getActiveSkills(), DB_CONTEXT_TIMEOUT_MS, []),
      withTimeout(getUserSchedules(slackUserId), DB_CONTEXT_TIMEOUT_MS, []),
      withTimeout(getUserSkillStats(slackUserId), DB_CONTEXT_TIMEOUT_MS, []),
      withTimeout(buildUserContext(slackUserId, userMessage, options?.workspaceId), DB_CONTEXT_TIMEOUT_MS, ""),
      withTimeout(buildKnowledgeContext(slackUserId, userMessage, options?.workspaceId), DB_CONTEXT_TIMEOUT_MS, ""),
      withTimeout(getSessionSummary(slackUserId), DB_CONTEXT_TIMEOUT_MS, ""),
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

  let dynamicTools = [...generalAgentTools];

  if (options?.workspaceId) {
    try {
      const servers = await getMcpServers(options.workspaceId);
      const activeServers = servers.filter((s) => s.status === "active");

      if (activeServers.length > 0) {
        const mcpResults = await Promise.allSettled(
          activeServers.map((srv) =>
            mcpManager.connectAndFetchTools(
              srv.url,
              srv.name,
              srv.authConfig,
              srv.toolsSchema,
              async (schema) => {
                const { updateMcpServerToolsSchema } = await import("@/db");
                await updateMcpServerToolsSchema(srv.id, schema);
              }
            )
          )
        );

        for (const res of mcpResults) {
          if (res.status === "fulfilled" && res.value) {
            dynamicTools.push(...res.value);
          }
        }
      }
    } catch (e) {
      console.error("[general] Failed to load MCP tools:", e);
    }
  }

  const result = await runToolUseLoop(fullMessage, {
    systemPrompt,
    tools: dynamicTools,
    context: toolContext,
    maxIterations: 12,
    temperature: 0.7,
    maxTokens: 4096,
    agentName: "general",
    traceId: slackUserId,  // Trace by user for correlated log lines
  });

  console.log(`[PERF] chatAsAgent TOOL path: ${Date.now() - t1}ms`);
  return result;
}
