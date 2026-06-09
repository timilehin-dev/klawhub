# KlawHub Core

A persistent, workspace-specific, tool-competent, proactive coworker that executes real work, adapts to organizational context, and improves over time — all in Slack.

**KlawHub is not an AI assistant. It is a hire.**

## Vision & Architecture

KlawHub operates as a **proactive, multi-tenant AI coworker** based on the following principles:
- **Tool-First:** No answer without either Tool usage, Retrieved memory, or Skill execution.
- **Workspace Isolation:** Strict multi-tenant intelligence. Each Slack workspace has its own cognitive environment, memory, and task patterns.
- **Dynamic Skills:** All capabilities are packaged as reusable skills. The system uses an AST-based dynamic skill system (`DynamicSkillRegistry`) that compiles and executes Python source code at runtime.
- **Memory-Grounded:** Uses Episodic, Semantic, and Procedural memory to reduce hallucination and increase reliability.
- **Proactive:** Runs on schedules to monitor tasks, resolve calendar conflicts, and participate in Slack threads unprompted.

## Tech Stack

- **Python 3.x**
- **FastAPI** & **Uvicorn**
- **SQLModel** / **SQLAlchemy** + **asyncpg**
- **PostgreSQL** (with **pgvector** for semantic search)
- **Inngest** (async workflows & scheduling)
- **LangGraph** (multi-agent orchestration)
- **Upstash Redis** (cross-thread context memory)
- **Slack SDK** (UI and communication)
- **Modal** (sandbox environment)

## Golden Rule

> **No dead code.** Every feature, function, or service must have ALL its dependencies wired up before merge — tables in Supabase, env vars in Vercel, Inngest events registered, tools in the registry. If it can't run, it doesn't ship.

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/timilehin-dev/klawhub.git
cd klawhub
pip install -r requirements.txt
```

### 2. Environment Variables
Copy `.env.local.example` to `.env.local` and fill in all values. Key requirements include:
- `UPSTASH_REDIS_REST_URL`
- Supabase connection details
- Slack API tokens

### 3. Database Setup
Ensure your PostgreSQL database (e.g., Supabase) is running and has `pgvector` enabled.
When querying pgvector columns, filters use `.is_not(None)` instead of `!= None` to properly translate to `IS NOT NULL`.

### 4. Running the App
```bash
# Start the FastAPI server
uvicorn api.main:app --reload
```

### 5. Running Tests & Verifications
Testing and verification scripts are located in `src/scripts/`. Execute them with the necessary environment variables:
```bash
PYTHONPATH=. python3 src/scripts/verify_multi_tenant.py
```

## Agent System

- **General Agent:** Interprets intent, selects skills, and coordinates sub-agents.
- **PM Agent:** Task creation, sprint planning, and reporting.
- **Analyst Agent:** Data interpretation and KPI tracking.
- **Research Agent:** Market research and knowledge synthesis.
- **Engineer Agent:** Code assistance, debugging, repo interaction (using Modal sandbox).
- **Operations Agent:** Process automation.

## License
MIT
