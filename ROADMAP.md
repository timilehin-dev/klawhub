# KlawHub Coworker Agent Roadmap (Refined & Expanded)

> **Golden Rule**: No dead code. Every feature, function, or service must have ALL its dependencies wired up before merge — tables in Supabase, env vars in Vercel, Inngest events registered, tools in the registry. If it can't run, it doesn't ship.

---

## Core Vision

KlawHub is not an AI assistant. **It is a hire.**
A persistent, workspace-specific, tool-competent, proactive coworker that executes real work, adapts to organizational context, and improves over time.

The system must be:
* **Tool-first** (reasoning and execution)
* **Workspace-isolated** (strict multi-tenant separation)
* **Skill-driven** (modular capabilities)
* **Proactive** (not waiting for prompts)
* **Memory-grounded** (minimal hallucination)

AI models are only orchestration layers. Tools, skills, and memory are the foundation.

---

## Current State (May 2026)

*   **Phase 0 & 1 Complete**: Klawhub now possesses foundational autonomy via the `dispatch_task` tool, cross-thread context memory (Upstash Redis), and fully hardened Slack markdown handling. 
*   **Active Infrastructure**: Supabase (PostgreSQL), Vercel (Hosting), Inngest (Workflows), Slack (UI), Ollama (LLMs), Upstash Redis (Context Cache).
*   **Database**: All tables required for multi-tenant memory, orchestrations, and skills are active (`runs`, `tasks`, `memory`, `knowledge`, `schedules`, etc.).

---

## System Architecture Principles

### 1. Tool-First Execution Layer
All meaningful work must be performed via tools, not raw LLM responses.

**Agent flow:**
Perception → Task Structuring → Tool Invocation → Verification → Memory Update

**Categories of tools:**
*   **Communication:** Slack API, email APIs (Resend)
*   **Scheduling:** Google Calendar API
*   **Data:** databases, spreadsheets, analytics APIs
*   **Dev:** GitHub, CI/CD, logs
*   **Research:** search APIs (Tavily), scraping tools (Puppeteer/Browser)
*   **Internal MCP tools:** (task engine, memory retrieval, skill loader)

**Strict rule:**
No answer without either: Tool usage, Retrieved memory, or Skill execution.

### 2. Workspace Isolation (Multi-Tenant Intelligence)
Each Slack workspace is a separate cognitive environment.

**Requirements:**
*   Separate vector memory per workspace (`memory.search_vector` / `knowledge.search_vector`)
*   Separate structured DB per workspace (`workspaces`, `workspace_members`)
*   Separate task graph per workspace
*   Separate embeddings namespace
*   No cross-workspace leakage.

Each workspace builds its own Knowledge base, Communication style, Task patterns, and Organizational structure.

### 3. Skill-Based Capability System
All capabilities must be packaged as reusable skills.

**Skill Structure (`/src/core/skills/<skill_name>/`)**
Required files:
*   `skill.md` (definition: Purpose, When to trigger, Required inputs, Output format, Tools used, Failure handling)
*   `schema.json` (inputs/outputs)
*   `executor.ts` or tool bindings
*   `dependencies.md` / `references.md`

**Examples of Skills:** `task_breakdown`, `meeting_summarization`, `competitor_research`, `sprint_planning`, `slack_thread_analysis`, `bug_triage`, `calendar_conflict_resolution`.
Agents dynamically load and execute skills based on context.

### 4. Memory Architecture
To reduce hallucination and increase reliability.

**Memory types:**
*   **Episodic:** past actions, conversations (Upstash Redis rolling window + `memory` table)
*   **Semantic:** learned facts about workspace (`knowledge` table)
*   **Procedural:** how tasks are performed (`engineer_learnings` and skills evolution)

**Rules:** Always retrieve before reasoning, Write memory after execution, Periodically compress memory.

### 5. Proactive Agent System
A scheduler activates agents every 1–2 hours (via Inngest Cron `schedule-runner`).

**Proactive loops:**
*   **Task Monitoring:** Check incomplete tasks, identify blockers, suggest next steps, escalate overdue items.
*   **Calendar Intelligence:** Detect conflicts, suggest rescheduling, prepare meeting briefs.
*   **Slack Participation:** Monitor joined channels, detect actionable messages, respond when relevant, create tasks from conversations.
*   **Reminder Engine:** Auto-create reminders, follow up on commitments.

### 6. Context Engineering (Small Model Optimization)
Using models like Gemma with large context windows.

**Strategies:**
*   Context packing (tasks + memory + relevant threads)
*   Sliding window memory injection (Redis)
*   Skill-based prompting (structured inputs)
*   Retrieval-first prompting
*   *Avoid dumping raw history or unstructured prompts.*

---

## Agent System Design

### General Orchestrator Agent
**Responsibilities:** Interpret intent, Select skills, Coordinate sub-agents, Manage tool execution.

### Specialized Sub-Agents
*   **Project Manager Agent:** Task creation and assignment, Sprint planning, Deadline tracking, Progress reporting.
*   **Analyst Agent:** Data interpretation, KPI tracking, Dashboard summaries, Insight generation.
*   **Research Agent:** Market research, Competitor analysis, Knowledge synthesis.
*   **Engineer Agent:** Code assistance, Debugging workflows, Repo interaction.
*   **Operations Agent:** Process automation, Workflow optimization.

*All agents use the shared skill system, have role-specific prompts, and operate strictly within workspace memory.*

---

## MCP (Model Context Protocols)
Use free/open MCPs where possible to replace bespoke internal tools.

**Examples:** Search MCP (web search APIs), Slack MCP (event ingestion + actions), Calendar MCP, GitHub MCP, Database MCP.
**Requirements:** All MCPs must be stateless interfaces, return structured outputs, and be easily composable.

---

## Task System (Core Backbone)
Tasks are first-class objects (stored in `tasks` and `runs` tables).

**Each task includes:** Description, Owner, Status, Dependencies, Deadline, Context links (Slack threads, files).
**Task lifecycle:** Create → Plan → Execute → Monitor → Complete → Learn

---

## Proactive Intelligence Features (Coworker-Level)
The agent must behave like a real team member:
*   Notices silence on important threads
*   Follows up without prompting
*   Suggests improvements to workflows
*   Prepares summaries before meetings
*   Identifies inefficiencies

---

## Learning & Adaptation
The system must evolve per workspace:
*   Learn communication tone
*   Learn recurring task patterns
*   Optimize skill usage
*   Store successful workflows

---

## Safety & Reliability
*   Tool execution validation layer
*   Retry + fallback strategies (Inngest automatic retries)
*   Confidence scoring before actions
*   Human-in-the-loop for critical actions (Slack Approval blocks)

---

## Roadmap Phases

### Phase 1: Foundations ✅
*   Redis + task queue (Upstash + Inngest)
*   Slack integration (Events & interactive blocks)
*   Basic memory system (Thread-summary + User context)
*   Core tools (Slack, DB, `dispatch_task`)

### Phase 2: Skill System
*   Skill loader implementation
*   Skill execution engine (`src/core/tools/executor.ts` overhaul)
*   Initial skill library (e.g., `meeting_summarization`, `slack_thread_analysis`)

### Phase 3: Proactive Engine
*   Scheduler refinement (Inngest `heartbeat` & `schedule-runner`)
*   Task monitoring & alerting
*   Slack listener for unprompted action detection

### Phase 4: Multi-Agent System
*   Orchestrator refinement
*   Sub-agents (PM, Analyst, Research, Engineer, Operations)
*   Role specialization logic

### Phase 5: Context Optimization
*   Vector retrieval system (Supabase pgvector implementation for `search_vector`)
*   Advanced Context packing

### Phase 6: Advanced Integrations
*   Google Workspace MCP
*   GitHub MCP
*   External REST API webhook connectors

### Phase 7: Learning Layer
*   Workflow learning
*   Skill refinement & Procedural memory generation

---

## Expected Outcome

KlawHub becomes:
*   A persistent digital employee
*   Capable of independent execution
*   Deeply personalized per workspace
*   Proactive and reliable

**Not a chatbot. A coworker that works.**
