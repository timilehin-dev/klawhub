# Context: KlawHub

## Project Overview
KlawHub is an agent swarm framework with a web landing page and dashboard. It uses a Python backend (with FastAPI and Inngest) and Next.js frontend, backed by a Supabase database.

## Critical Issues to Resolve
1. **R1**: Vercel Python import issue with `inngest.fastapi` vs `inngest.fast_api`.
2. **R2**: Slack OAuth login and workspace-based access control.
3. **R3**: Google & GitHub OAuth integrations with AES-256-GCM database token storage.
4. **R4**: Real data integration for 8 dashboard tabs scoped by Slack Workspace ID.
5. **R5**: Audit and verify tools (Slack, Google, GitHub, Tavily, Lightpanda sandbox).

## Database Schema & Code Base
- Main backend files are under `src/` (Python) and `api/` (Go and Python).
- Web frontend files are under `app/`.
- Let's discover the database schemas and existing logic via the Explorer subagent.
