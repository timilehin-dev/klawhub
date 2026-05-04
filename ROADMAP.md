# Klawhub Roadmap — From Broken Prototype to Viktor-Beating AI Coworker

> **Golden Rule**: No dead code. Every feature, function, or service must have ALL its dependencies wired up before merge — tables in Supabase, env vars in Vercel, Inngest events registered, tools in the registry. If it can't run, it doesn't ship.

---

## Current State (May 2026)

| Metric | Value |
|--------|-------|
| Build pipeline success rate | 16% (2/19 runs) |
| Document/Research/Analytics tasks completed | 0 |
| Average LLM response time | 79-131 seconds |
| Integrations connected | 0 out of 2 available |
| Knowledge graph entries | 0 |
| User perception | "Very dull. No memory, no context, no intelligence." |

### Active Bugs
1. **`invalid_blocks` error** — PM spec exceeds Slack's 3000-char block limit, crashes the build pipeline
2. **`${text}` literal string** — process.ts line 319 uses double quotes instead of backticks, showing literal `${text}` in Slack
3. **Classifier too aggressive with "unclear"** — follow-up messages in threads misclassified as unclear when context is obvious
4. **Chat agent can't trigger workflows** — General agent talks ABOUT agents but can't INVOKE them (no tool to dispatch builds/research)
5. **No proactive behavior** — Agent asks "what specifically?" instead of inferring from conversation

---

## Infrastructure (All Free Tier — $0/month)

| Service | Purpose | Free Tier Limit | Status |
|---------|---------|----------------|--------|
| **Supabase** | PostgreSQL DB + Auth | 500MB, 2GB bandwidth | ✅ Active |
| **Vercel** | Hosting + Serverless | 100GB bandwidth, 100hr compute | ✅ Active |
| **Inngest** | Async workflows | 25K events/month | ✅ Active |
| **Slack** | User interface | Unlimited | ✅ Active |
| **Ollama Cloud** | LLM (Gemma 4 31B) | Free tier with API keys | ✅ Active |
| **AIHubMix** | LLM (Kimi K2.6 Code) | Free model tier | ✅ Active |
| **Modal** | Code sandbox | $30/mo free credits | ⚠️ Needs deploy |
| **Tavily** | Web search | 1000 searches/month | ✅ Active |
| **Upstash Redis** | Caching + rate limiting | 10K commands/day | 🔜 To add |

### New Account Needed
- **Upstash** (upstash.com) — Free Redis for conversation context caching, rate limiting, and session state. Sign up → create Redis DB → add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Vercel env vars.

---

## Folder Structure (Target — Modular, Debuggable)

```
src/
├── app/                          # Next.js routes (thin handlers only)
│   └── api/
│       ├── slack/
│       │   ├── events/route.ts        # Verify → dedup → inngest.send → 200
│       │   ├── actions/route.ts       # Button clicks → inngest.send → 200
│       │   └── commands/route.ts      # Slash commands → inngest.send → 200
│       ├── inngest/route.ts           # Inngest serve endpoint
│       └── dashboard/                 # Dashboard APIs
│
├── core/                         # Pure business logic (no framework deps)
│   ├── agents/
│   │   ├── classifier/
│   │   │   ├── index.ts               # classify() export
│   │   │   ├── patterns.ts            # Regex patterns (extracted)
│   │   │   └── llm-classifier.ts      # LLM fallback classifier
│   │   ├── general/
│   │   │   ├── index.ts               # chatAsAgent() export
│   │   │   ├── system-prompt.ts       # System prompt (extracted)
│   │   │   └── context-builder.ts     # Memory/knowledge context assembly
│   │   ├── pm/
│   │   │   ├── index.ts               # createSpec() export
│   │   │   └── system-prompt.ts
│   │   ├── engineer/
│   │   │   ├── index.ts               # writeCode(), fixCode() exports
│   │   │   └── system-prompt.ts
│   │   ├── qa/
│   │   │   ├── index.ts               # testCode(), persistLearning() exports
│   │   │   └── system-prompt.ts
│   │   ├── researcher/
│   │   │   ├── index.ts               # conductResearch() export
│   │   │   └── system-prompt.ts
│   │   ├── documentor/
│   │   │   ├── index.ts               # generateDocument(), generateOutline()
│   │   │   └── system-prompt.ts
│   │   └── analyst/
│   │       ├── index.ts               # analyzeData() export
│   │       └── system-prompt.ts
│   │
│   ├── llm/
│   │   ├── router.ts                  # LLMRouter class (provider selection + retry)
│   │   ├── providers.ts               # Provider configs from env vars
│   │   └── types.ts                   # Message, ChatOptions, ChatResult types
│   │
│   ├── memory/
│   │   ├── store.ts                   # memoryWrite, memoryRead, memoryForget
│   │   ├── knowledge.ts               # Knowledge graph CRUD
│   │   ├── knowledge-extractor.ts     # Auto-extract entities from conversation
│   │   └── context-builder.ts         # Build context strings for agent prompts
│   │
│   └── tools/
│       ├── registry.ts                # Tool definitions + per-agent tool sets
│       ├── executor.ts                # runToolUseLoop (parse → execute → iterate)
│       └── implementations/
│           ├── web-search.ts          # Tavily search
│           ├── web-read.ts            # URL content reader
│           ├── code-exec.ts           # Modal sandbox execution
│           ├── browser.ts             # Puppeteer browse/scrape/interact
│           ├── memory-tools.ts        # memory_save, memory_search
│           ├── knowledge-tools.ts     # knowledge_search, knowledge_save
│           ├── github.ts              # GitHub API tools
│           └── google-drive.ts        # Google Drive API tools
│
├── workflows/                    # Inngest step functions (async pipelines)
│   ├── message-handler.ts             # Slack event → classify → dispatch
│   ├── command-chat.ts                # Slash command deferred chat
│   ├── build-squad.ts                 # PM → Approval → Engineer → QA → Deliver
│   ├── research-task.ts               # Research → Deliver
│   ├── document-task.ts               # Outline → Approval → Generate → Deliver
│   ├── analytics-task.ts              # Analyze → Charts → Deliver
│   ├── schedule-runner.ts             # Cron → dispatch
│   └── heartbeat.ts                   # Health check
│
├── integrations/                 # External service clients
│   ├── slack/
│   │   ├── client.ts                  # WebClient factory + workspace resolution
│   │   ├── blocks.ts                  # Block Kit builders
│   │   ├── verify.ts                  # HMAC signature verification
│   │   └── workspace.ts               # ensureMember, checkUsageLimit
│   ├── browser/
│   │   ├── client.ts                  # Puppeteer CDP connection
│   │   └── actions.ts                 # browse, scrape, interact, screenshot
│   ├── github/
│   │   └── client.ts                  # GitHub API wrapper
│   ├── google-drive/
│   │   └── client.ts                  # Google Drive API wrapper
│   └── modal/
│       └── client.ts                  # Modal sandbox API wrapper
│
├── db/                           # Database layer
│   ├── connection.ts                  # Drizzle + postgres connection
│   ├── schema/
│   │   ├── index.ts                   # Re-exports all schemas
│   │   ├── workspaces.ts             # workspaces, workspace_members
│   │   ├── runs.ts                    # runs (build pipeline)
│   │   ├── tasks.ts                   # tasks (research/doc/analytics)
│   │   ├── memory.ts                  # memory table
│   │   ├── knowledge.ts              # knowledge graph table
│   │   ├── usage.ts                   # usage_logs, skill_usage
│   │   ├── schedules.ts              # schedules table
│   │   ├── integrations.ts           # integrations table
│   │   └── events.ts                  # processed_events (dedup)
│   └── queries/
│       ├── index.ts                   # Re-exports all queries
│       ├── runs.ts                    # createRun, updateRun, getRunByThreadTs...
│       ├── tasks.ts                   # createTask, updateTask...
│       ├── memory.ts                  # saveMemory, readMemory...
│       ├── knowledge.ts              # upsertKnowledge, searchKnowledge...
│       ├── usage.ts                   # logUsage, trackSkillUsage...
│       ├── workspaces.ts             # workspace CRUD
│       └── schedules.ts              # schedule CRUD
│
├── events/                       # Event processing logic
│   ├── process.ts                     # processSlackEvent (classify → dispatch)
│   └── dedup.ts                       # DB-backed event deduplication
│
└── utils/
    ├── thread-context.ts              # Slack thread history fetcher
    └── slack-mrkdwn.ts                # Markdown → Slack mrkdwn converter
```

---

## Phase 0: Critical Bug Fixes (Immediate — Before Anything Else)

### 0.1 Fix `${text}` Literal String Bug
**File**: `src/lib/events/process.ts` line 319
**Bug**: Uses double quotes `"...$\{text}..."` instead of backticks `` `...$\{text}...` ``
**Impact**: User sees literal `${text}` instead of their request text
**Fix**: Change double quotes to backticks

### 0.2 Fix `invalid_blocks` Error (Build Pipeline Crash)
**File**: `src/lib/slack/blocks.ts` → `approvalBlocks()`
**Bug**: PM spec text is passed directly into a Slack block section. Slack has a **3000 character limit** per `text` field in `section` blocks. PM specs are 5,000-15,000+ chars.
**Impact**: `invalid_blocks` error crashes the entire build pipeline
**Fix**:
- Truncate block text to 2900 chars with a "... (truncated)" suffix
- Post the full spec as a **threaded message** or **file upload** alongside the truncated blocks
- Add a `safeBlocks()` utility that validates all block text lengths

### 0.3 Fix Classifier Thread Context
**File**: `src/lib/events/process.ts` → thread reply handling
**Bug**: When user says "suggest a challenge" or "yes, go ahead" in a thread, the classifier sees it in isolation and returns "unclear"
**Impact**: Agent responds with `:thinking: Suggest what specifically?` when context is obvious
**Fix**:
- Always pass thread history to the classifier for thread replies
- Add a "continuation" regex pattern: `/^(yes|go ahead|do it|proceed|try|start|run|execute|sure|ok|continue)/i` → classify as `chat` with thread context

### 0.4 Fix Chat Agent Proactivity
**File**: `src/lib/agents/general.ts` → system prompt
**Bug**: The general agent's system prompt tells it to "explain how you'd handle it" instead of DOING it
**Impact**: Agent says "I'll spin up the PM Agent now" but never actually dispatches anything
**Fix**:
- Give the general agent a `dispatch_task` tool that can trigger build/research/document/analytics workflows
- Update system prompt: "When a user asks you to do something, DO IT. Don't describe what you would do."

### Dependencies for Phase 0:
- No new tables
- No new env vars
- No new services

---

## Phase 1: Intelligence Foundation (Week 1-2)

### 1.1 Conversation Context Window (Upstash Redis)
**Problem**: Every message is processed in isolation. The agent has no memory of what was said 30 seconds ago.
**Solution**: Cache the last N messages per channel/thread in Redis with TTL.

**New files**:
- `src/core/memory/conversation-cache.ts` — Redis-backed sliding window
- Uses `@upstash/redis` (REST-based, works on Vercel serverless)

**Dependencies**:
- **Upstash Redis account** (free tier: 10K commands/day)
- **Env vars**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **npm package**: `@upstash/redis`

### 1.2 Smart Thread Context
**Problem**: Thread replies lose context because `getThreadHistory()` fetches raw Slack messages but doesn't summarize them.
**Solution**:
- On each message, cache a running summary in Redis
- When a thread reply comes in, the agent gets both the summary and last 5 messages
- Summary is updated by the LLM after each response (piggyback on the chat call)

**New files**:
- `src/core/memory/thread-summary.ts` — Automatic thread summarization

**Dependencies**:
- Upstash Redis (from 1.1)

### 1.3 Proactive Agent Routing (dispatch_task tool)
**Problem**: The general agent can only chat. It can't trigger builds, research, or documents.
**Solution**: Add a `dispatch_task` tool to the general agent's toolset.

```typescript
// New tool: dispatch_task
{
  name: "dispatch_task",
  description: "Dispatch a task to a specialized agent. Use this when the user wants something built, researched, documented, or analyzed.",
  parameters: {
    type: "build" | "research" | "document" | "analytics",
    request: "detailed description of what to do"
  }
}
```

When the general agent calls `dispatch_task`, the handler:
1. Creates a run/task in the DB
2. Sends the appropriate Inngest event
3. Posts a confirmation in Slack

**New files**:
- `src/core/tools/implementations/dispatch.ts` — dispatch_task tool implementation

**Dependencies**:
- Tool must be registered in `registry.ts` → `generalAgentTools`
- Needs access to `createRun`, `createTask`, `inngest.send()`

### 1.4 Memory-Aware Responses
**Problem**: Memory system exists (22 entries) but the agent doesn't actively USE it in responses.
**Solution**:
- Before every response, inject relevant memories into the system prompt
- After every response, auto-save important context to memory
- Add "What I know about you" capability — user can ask what the agent remembers

**Modified files**:
- `src/core/agents/general/context-builder.ts` — Enhanced context assembly
- `src/core/memory/store.ts` — Auto-categorization of memories

**Dependencies**:
- Existing `memory` table in Supabase (already exists)

### 1.5 Knowledge Graph Population
**Problem**: Knowledge graph exists (table exists) but has 0 entries.
**Solution**:
- The `extractAndStoreKnowledge()` function exists but may be failing silently
- Add explicit knowledge extraction prompts to the general agent
- When users mention projects, people, companies, or technologies, auto-extract and store

**Modified files**:
- `src/core/memory/knowledge-extractor.ts` — Fix extraction logic
- `src/core/tools/implementations/knowledge-tools.ts` — Better search

**Dependencies**:
- Existing `knowledge` table in Supabase (already exists)

---

## Phase 2: Build Pipeline Reliability (Week 2-3)

### 2.1 Fix Slack Block Limits
**Problem**: PM specs and document outlines exceed Slack's 3000-char block limit.
**Solution**:
- Create a `safeSlackMessage()` utility that:
  - Splits long text into multiple section blocks (max 2900 chars each)
  - Falls back to file upload for very long content
  - Always validates block structure before sending

**New files**:
- `src/integrations/slack/safe-message.ts` — Block-safe message builder

**Dependencies**:
- No new tables or env vars

### 2.2 Modal Sandbox Deployment
**Problem**: `MODAL_FUNCTION_URL` may not be set. Code execution fails.
**Solution**:
- Deploy `modal_app.py` to Modal
- Verify the function URL is reachable
- Add health check endpoint to Modal app
- Add fallback: if Modal is down, use a simple `eval()`-based sandbox for Python (limited but functional)

**Dependencies**:
- **Modal account** (free $30/mo credits)
- **Env vars**: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_FUNCTION_URL`
- **Deploy command**: `modal deploy modal_app.py`

### 2.3 Engineer Learnings Loop
**Problem**: `engineer_learnings` table has 0 entries. The engineer never learns from past failures.
**Solution**:
- After every QA test (pass or fail), persist a structured learning
- Before every code generation, query relevant learnings and inject into prompt
- This creates a feedback loop: failures make future code better

**Dependencies**:
- Existing `engineer_learnings` table in Supabase (already exists)

### 2.4 Better Error Recovery
**Problem**: When the build pipeline fails, the error message is unhelpful.
**Solution**:
- Classify errors into categories (LLM timeout, sandbox failure, Slack API error, etc.)
- Provide actionable error messages: "The code sandbox is unavailable. I'll try again in 30 seconds."
- Add automatic retry with exponential backoff for transient failures

**Dependencies**:
- Inngest retries (already configured, `retries: 2`)

---

## Phase 3: Viktor Feature Parity (Week 3-5)

### 3.1 Scheduled Tasks That Actually Run
**Problem**: Schedule system exists (schema + UI) but 0 schedules ever created.
**Solution**:
- Fix the `heartbeat` Inngest cron function to actually dispatch scheduled tasks
- Add natural language schedule parsing: "every weekday at 9am" → cron expression
- Add schedule management via Slack: `/klawhub schedules`, `/klawhub cancel-schedule`

**Dependencies**:
- Existing `schedules` table in Supabase (already exists)
- Inngest cron already configured

### 3.2 Webhook Integration Bridge
**Problem**: Only 2 integrations (Google Drive + GitHub) vs Viktor's 3,000+
**Solution**:
- Add a generic **webhook connector** tool
- Users can provide any REST API endpoint + auth token
- The agent can call arbitrary APIs: CRMs, payment processors, marketing tools
- Store webhook configs in a new `webhooks` table

**New files**:
- `src/core/tools/implementations/webhook.ts` — Generic HTTP tool
- `src/db/schema/webhooks.ts` — Webhook configuration table

**Dependencies**:
- **New Supabase table**: `webhooks` (id, workspace_id, name, url, method, headers, auth_type, auth_token, created_at)
- No new env vars (user provides their own API keys per webhook)

### 3.3 GitHub PR Workflow
**Problem**: Klawhub can read GitHub repos but can't write code back.
**Solution**:
- Add `github_create_branch`, `github_commit_file`, `github_create_pr` tools
- Engineer agent can push code directly to a feature branch and open PRs
- Requires GitHub App installation with write permissions

**New files**:
- `src/core/tools/implementations/github-write.ts` — GitHub write operations
- `src/integrations/github/pr-workflow.ts` — Branch → commit → PR pipeline

**Dependencies**:
- Existing GitHub OAuth integration (already has `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`)
- Need `contents: write` and `pull_requests: write` permissions on the GitHub App

### 3.4 Email Tool (via Resend Free Tier)
**Problem**: Viktor can send emails. Klawhub can't.
**Solution**:
- Use **Resend** (resend.com) free tier: 100 emails/day, 3000/month
- Add `send_email` tool to the general agent
- Support: plain text, HTML, attachments (generated documents)

**New files**:
- `src/core/tools/implementations/email.ts` — Resend email sender
- `src/integrations/resend/client.ts` — Resend API wrapper

**Dependencies**:
- **Resend account** (free tier: 100 emails/day)
- **Env vars**: `RESEND_API_KEY`
- **npm package**: `resend`
- **DNS**: Add Resend verification records to your domain (optional for custom from address)

### 3.5 Viktor Spaces Equivalent (Persistent Workspaces)
**Problem**: Viktor has persistent cloud workspaces. Klawhub's sandbox is ephemeral.
**Solution**:
- Use Modal's persistent volumes to maintain project state across runs
- Each workspace gets a virtual filesystem that persists between builds
- Agent can reference and modify files from previous runs

**Dependencies**:
- Modal persistent volumes (included in free tier)
- Modify `modal_app.py` to mount workspace-specific volumes

---

## Phase 4: Competitive Advantages Over Viktor (Week 5-8)

### 4.1 Proactive Insights (Viktor doesn't have this)
**Problem**: Viktor reacts. Klawhub should anticipate.
**Solution**:
- Daily digest: Summarize what happened in channels the bot is in
- Anomaly detection: "Your Stripe MRR dropped 15% this week" (when connected)
- Suggestion engine: "Based on your recent research, you might want to also look at..."

**Dependencies**:
- Inngest cron for daily/weekly digests
- Upstash Redis for tracking metrics over time

### 4.2 Multi-Agent Orchestration (Not just pipeline)
**Problem**: Current architecture is a fixed pipeline (PM → Engineer → QA). Viktor uses dynamic orchestration.
**Solution**:
- Add a **Coordinator Agent** that dynamically plans which agents to use
- Support parallel agent execution: Research + PM simultaneously
- Support agent-to-agent communication: QA can ask Engineer for clarification

**New files**:
- `src/core/agents/coordinator/index.ts` — Dynamic task decomposition
- `src/core/agents/coordinator/planner.ts` — Multi-agent execution planner

### 4.3 Learning From Feedback
**Problem**: When a user says "that's wrong" or "try again", the agent doesn't learn WHY.
**Solution**:
- Track user feedback signals (thumbs up/down, "good", "wrong", "fix this")
- Store feedback → outcome pairs in the learnings table
- Use these to adjust future behavior (negative examples are as valuable as positive)

### 4.4 Comparison Pages + Social Proof
**Problem**: Viktor has "vs ChatGPT", "vs Claude in Slack" comparison pages. Klawhub has none.
**Solution**:
- Add `/compare/klawhub-vs-viktor`, `/compare/klawhub-vs-chatgpt` pages
- Add testimonials section to landing page
- Add usage stats: "X tasks completed this month"

---

## Phase 5: Production Hardening (Ongoing)

### 5.1 Rate Limiting (Upstash)
- Rate limit per user, per workspace, per endpoint
- Sliding window: 50 requests/minute per user
- Use Upstash Redis for atomic counters

### 5.2 Error Monitoring
- Structured logging with context (user ID, run ID, agent name)
- Error aggregation dashboard (Vercel logs or free Sentry tier)
- Alert on error rate spikes

### 5.3 Cost Optimization
- LLM response caching in Redis (identical prompts → cached responses)
- Shorter prompts for simple tasks (classifier uses 100 tokens max)
- Batch processing for scheduled tasks

### 5.4 Security
- Input sanitization on all user-provided text
- Rate limiting on LLM calls (prevent abuse)
- Audit log for all tool executions

---

## Execution Priority

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| 🔴 P0 | Fix `${text}` literal bug | High | 5 min |
| 🔴 P0 | Fix `invalid_blocks` crash | High | 1 hour |
| 🔴 P0 | Fix classifier thread context | High | 2 hours |
| 🔴 P0 | Fix chat agent proactivity | High | 3 hours |
| 🟡 P1 | Conversation context cache (Redis) | High | 4 hours |
| 🟡 P1 | dispatch_task tool | High | 2 hours |
| 🟡 P1 | Smart thread context | Medium | 3 hours |
| 🟡 P1 | Memory-aware responses | Medium | 2 hours |
| 🟢 P2 | Slack block limits utility | Medium | 2 hours |
| 🟢 P2 | Modal sandbox deployment | Medium | 1 hour |
| 🟢 P2 | Folder structure refactor | Medium | 4 hours |
| 🔵 P3 | Webhook integration bridge | High | 4 hours |
| 🔵 P3 | GitHub PR workflow | Medium | 4 hours |
| 🔵 P3 | Email tool (Resend) | Medium | 2 hours |
| 🔵 P3 | Scheduled tasks fix | Medium | 3 hours |
| ⚪ P4 | Proactive insights | High | 8 hours |
| ⚪ P4 | Multi-agent orchestration | High | 12 hours |
| ⚪ P4 | Comparison pages | Low | 4 hours |

---

## Dependency Checklist (Per Phase)

### Phase 0 — No new dependencies
- [x] Supabase tables: all exist
- [x] Env vars: all set
- [x] npm packages: all installed

### Phase 1 — Upstash Redis
- [ ] Create Upstash account (upstash.com)
- [ ] Create Redis database (free tier)
- [ ] Add env vars to Vercel: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- [ ] Install npm package: `@upstash/redis`

### Phase 2 — Modal Sandbox
- [ ] Deploy Modal app: `modal deploy modal_app.py`
- [ ] Verify env var in Vercel: `MODAL_FUNCTION_URL`
- [ ] Test sandbox endpoint: `curl $MODAL_FUNCTION_URL/health`

### Phase 3 — Resend Email
- [ ] Create Resend account (resend.com)
- [ ] Add env var to Vercel: `RESEND_API_KEY`
- [ ] Install npm package: `resend`
- [ ] Create `webhooks` table in Supabase (SQL migration provided at implementation time)

---

*This document is the single source of truth for Klawhub's development trajectory. Update it as items are completed or priorities shift.*
