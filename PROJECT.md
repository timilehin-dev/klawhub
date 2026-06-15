# Project: KlawHub Platform Fixes & Enhancements

## Architecture
- Next.js frontend in `app/` (with layouts, pages, middlewares, and routes).
- FastAPI + Inngest backend in `api/inngest.py` and Python modules in `src/`.
- Go oauth callback handler in `api/oauth/oauth.go`.
- Supabase PostgreSQL database managed via client in `src/db/client.py` and operations in `src/db/operations.py`.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | E2E Test Suite | Create comprehensive E2E test infra and test cases | None | IN_PROGRESS |
| 2 | Python Import & DB Pooling | Fix `inngest` import issues on Vercel and set up asyncpg connection pooling | None | IN_PROGRESS |
| 3 | Slack OAuth & Session | Implement secure multi-tenant Slack login, session cookies/JWT, and database mapping | M2 | PLANNED |
| 4 | Google & GitHub OAuth | Connect Google Workspace and GitHub, request scopes, store encrypted tokens | M3 | PLANNED |
| 5 | Real-Data Dashboard Tabs | Wire all 8 tabs to query/write database records filtered by workspace ID | M3, M4 | PLANNED |
| 6 | Adversarial Verification | Run E2E tests, Challenger audits, and Forensic Auditing | M1, M5 | PLANNED |

## Interface Contracts
### Slack OAuth & Session
- Endpoint `GET /api/oauth/slack` redirects to Slack OAuth.
- Endpoint `GET /api/oauth/callback` handles callback, issues JWT session cookie.
- Middleware guards `/dashboard`, checks JWT, retrieves user and maps to `workspace_id`.
- DB `integrations` table stores encrypted tokens.

### Database Operations
- All read/write operations for the 8 dashboard tabs query the respective DB table scoped by `workspace_id`.
