# Original User Request

## Initial Request — 2026-06-15T12:06:43+01:00

Fix critical backend import issues, implement secure multi-tenant Slack/OAuth access control for the landing page and dashboard, set up proper Google Workspace and GitHub OAuth integrations, populate all dashboard tabs with real database data, and verify all tool integrations.

Working directory: c:\Users\HP\klaw\klawhub
Integrity mode: demo

## Requirements

### R1. Vercel Python Import Fix
- Resolve the `ModuleNotFoundError: No module named 'inngest.fastapi'` on Vercel deployment for `api/inngest.py` by correcting the module import path to `inngest.fast_api`.

### R2. Slack-Linked Workspace Access Control
- Implement a Slack OAuth (Sign in with Slack) login flow for the admin dashboard.
- Create a secure, persistent browser session (using JWT/cookie) so users do not have to reconnect or re-authenticate Slack on every reload.
- Securely retrieve and map the authenticated user to their specific Slack workspace ID in the database, allowing access from any device.

### R3. Google & GitHub OAuth Integration
- Replace placeholder connection buttons/prompts with authentic web-based OAuth flows for Google Workspace and GitHub.
- Google Workspace OAuth integration must request and obtain read/write access scopes for Calendar, Drive, and Gmail.
- Safely encrypt all refresh and access tokens in the Supabase database using the existing AES-256-GCM encryption system.

### R4. Real-Data Dashboard Tabs
- Update all 8 dashboard tabs (Overview, Skills Catalog, Schedules & Crons, Workspace Tasks, Automations & Workflows, Knowledge base, Usage & Telemetry, Settings) to display real data queried from Supabase, fully scoped by the user's authenticated Slack workspace ID.
- Ensure all interactive dashboard actions (CRUD operations) modify real database records.

### R5. System & Tool Verification
- Verify and audit all tools (Slack, Google calendar/drive/gmail, GitHub repos/issues/PRs, Tavily search, sandbox runners) and dynamic skills to ensure they are fully operational and correctly wired up.

## Acceptance Criteria

### Authentication & Authorization
- Users can authenticate via Slack OAuth on the landing page and are assigned a persistent session cookie/JWT.
- Accessing `/dashboard` redirects unauthenticated users to the login screen.
- Reloading `/dashboard` preserves the session and does not log the user out.

### Integrations
- Connecting Google Workspace initiates a real OAuth flow with read/write scopes for Calendar, Drive, and Gmail.
- Connecting GitHub initiates a real GitHub OAuth consent flow.
- Retrieved tokens are stored in the `integrations` table in encrypted form.

### Dashboard Functionality
- The Overview tab shows active runs, success rate, monthly budget, and registered skills based on real DB records.
- The Skills Catalog displays active skills from the `skills` table and supports installing custom skills.
- Schedules & Crons, Workspace Tasks, Automations & Workflows, Knowledge base, Usage & Telemetry, and Settings read from and write to their respective database tables.
