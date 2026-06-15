# Scope: Implementation of Backend Fixes, OAuth Flows, and Dashboard Tabs

## Architecture
- Next.js frontend handles pages, dashboard UI, and middleware routes.
- Go OAuth service manages authorization redirection and callback tokens.
- FastAPI/Python backend serves workflows via Inngest and queries PostgreSQL via `asyncpg`.
- PostgreSQL (Supabase) holds workspace configuration, user session tokens, and data.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| 1 | Python Import & DB Pooling | Resolve inngest.fast_api import error; implement asyncpg pool lifespan in FastAPI. | None | IN_PROGRESS |
| 2 | Slack OAuth & Session | Admin login, cookie/JWT persistent session, workspace_id mapping, middleware guard. | M1 | PLANNED |
| 3 | Google & GitHub OAuth | Google Workspace (Drive, Gmail, Calendar) & GitHub consent, AES-256-GCM integration token storage. | M2 | PLANNED |
| 4 | Real-Data Dashboard Tabs | Populate 8 tabs with database data scoped by workspace_id (Overview, Skills, Schedules, Tasks, etc.). | M2, M3 | PLANNED |
| 5 | System Verification & E2E | Run E2E test suite (Tiers 1-4), Adversarial Coverage (Tier 5), and Forensic auditing. | M4 | PLANNED |

## Interface Contracts
### Next.js ↔ FastAPI / Go (OAuth)
- Endpoint `/api/oauth/slack` redirects admin to Slack login.
- Endpoint `/api/oauth/callback` processes code, signs JWT cookie, redirects to `/dashboard`.
- Middleware checks cookie on `/dashboard` and subpaths, redirects to `/` if missing or invalid.
- API endpoints read workspace_id from session context or request header.

### Python Backend ↔ Postgres (Supabase)
- Database queries use `get_pool()` from `src/db/client.py`.
- Integrations tokens encrypted using AES-256-GCM (see `src/core/security/encryptor.py`).
