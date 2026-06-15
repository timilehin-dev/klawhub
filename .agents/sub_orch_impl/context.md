# context.md

## Context Analysis: KlawHub Platform Fixes & Enhancements

This document summarizes the current technical context, codebase structure, and details for implementing each requirement.

### 1. Requirements Reference
- **R1: Vercel Python Import Fix & DB Pooling**:
  - `api/inngest.py` has `from inngest.fastapi import serve`, which fails with `ModuleNotFoundError`. Must change to `from inngest.fast_api import serve`.
  - Validate that `asyncpg.create_pool` is properly used inside FastAPI's lifespans, and check `src/db/client.py` and `src/db/operations.py` for client pooling.
- **R2: Slack-Linked Workspace Access Control**:
  - Slack Sign in with Slack OAuth flow.
  - Secure persistent browser session using JWT/cookie.
  - Map authenticated user to Slack workspace ID in the database.
  - Create middleware auth guard to secure `/dashboard`.
- **R3: Google & GitHub OAuth Integration**:
  - Web-based OAuth flow for Google Workspace (Calendar, Drive, Gmail scopes) and GitHub.
  - AES-256-GCM token encryption before saving in `integrations` table in Supabase.
- **R4: Real-Data Dashboard Tabs**:
  - 8 dashboard tabs: Overview, Skills Catalog, Schedules & Crons, Workspace Tasks, Automations & Workflows, Knowledge base, Usage & Telemetry, Settings.
  - Query from Supabase scoped by workspace_id.
  - Interactive CRUD modifications scoped by workspace_id.
- **R5: System & Tool Verification**:
  - Verify and audit all tools (Slack, Google calendar/drive/gmail, GitHub, Tavily, sandbox).

### 2. Codebase Architecture & Structure
- **Frontend (Next.js)**: `app/` (with page routing, middlewares, context).
- **Backend (FastAPI)**: `api/inngest.py` and Python packages in `src/`.
- **OAuth Callback Handler (Go)**: `api/oauth/oauth.go`.
- **Database Client & Operations**: `src/db/client.py` and `src/db/operations.py` (Supabase Postgres client).
- **Integrations**: `src/integrations/` (Slack, Tavily, etc.).
- **Security Tools**: `src/core/security/encryptor.py` contains AES encryption logic.

### 3. Execution Strategy
To avoid violating the **Orchestrator constraints**, all implementation, research, and testing tasks will be dispatched to subagents:
- **Explorer** (`teamwork_preview_explorer`): Read and analyze the codebase for the milestone.
- **Worker** (`teamwork_preview_worker`): Implement the fixes and new features.
- **Reviewer** (`teamwork_preview_reviewer`): Review changes for bugs, design issues, and compliance.
- **Challenger** (`teamwork_preview_challenger`): Run verification scripts and test cases.
- **Auditor** (`teamwork_preview_auditor`): Run forensics integrity checks.
