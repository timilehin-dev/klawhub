# E2E Test Suite Analysis and Planning Report

## 1. Executive Summary
This report presents a comprehensive E2E test suite plan for the KlawHub platform. Following a read-only codebase exploration, we analyzed the FastAPI/Inngest backend, the asyncpg database client/operations, the Go OAuth callback, and the Next.js middleware routing. We verified that the existing Python virtual environment (`.venv`) does not contain `pytest` or any other test framework, and the project lacks a test suite.

To ensure production readiness, we recommend a 4-Tier E2E test suite built on `pytest` and `httpx`. The plan maps out coverage for the 5 main features, with deep-dive specifications for **Feature 1 (Lifespan & Imports)** and **Feature 2 (Slack OAuth, Session, & Middleware Redirection)**.

---

## 2. Codebase Architecture & Findings

### 2.1 Backend & Workflow Structure
- **FastAPI / Inngest Entry Point (`api/inngest.py`)**:
  - Acts as the webhook receiver for Inngest.
  - Registers 6 event-driven workflows: `handle_slack_message_event`, `handle_slack_slash_command`, `proactive_schedule_loop`, `install_skill_from_github`, `execute_workflow`, and `handle_workspace_install`.
  - Employs a FastAPI `lifespan` handler that initializes the `asyncpg` connection pool on startup and closes it on shutdown.
  - Uses a single shared `inngest_client` instance imported from `src/core/inngest_client.py` to prevent routing conflicts.
- **Go OAuth Callback Handler (`api/oauth/oauth.go`)**:
  - Handles `GET /api/oauth` (Slack installation callback).
  - Exchanges the code with Slack for a bot token, dispatches a `workspace/install` event to Inngest, and redirects to the Next.js frontend at `/dashboard?install=success`.

### 2.2 Database Layer (`src/db/`)
- **Connection Pooling (`client.py`)**:
  - Implements an async connection pool using `asyncpg.create_pool` with `min_size=2` and `max_size=10`.
  - Prevents Supabase connection exhaustion by caching the pool in module-level global variable `_pool`.
  - Provides `ensure_pool()` for lazy initialization and thread-safe/async retrieval.
- **CRUD Operations (`operations.py`)**:
  - Contains all database CRUD for workspaces, members, agent states, schedules, tasks, workflows, pgvector semantic search (memory/knowledge), skills, and usage telemetry.
  - Protects UPDATE queries via `_build_set_clause` which enforces white-listed columns to prevent SQL injection.

### 2.3 Next.js Middleware & Auth Callback (`app/`)
- **Supabase Auth Middleware (`app/middleware.ts`)**:
  - Intercepts all requests matching `/((?!_next/static|_next/image|favicon.ico|api/).*)`.
  - Protects `/dashboard/*` routes by calling `supabase.auth.getSession()`.
  - Redirects unauthenticated requests to `/?reason=unauthenticated`.
- **OAuth Callback Router (`app/auth/callback/route.ts`)**:
  - Receives authorization codes from Supabase and exchanges them for a session before redirecting to `/dashboard`.

---

## 3. Test Environment Analysis
- **Framework Choice**: Python `pytest` (using `pytest-asyncio` for async database and endpoints, and `httpx` for HTTP request simulation).
- **Current State**:
  - Executed `pip list` in the virtual environment. `pytest` is **not installed**.
  - Run compile check `verify_all_27.py` which compiled 46 Python files successfully.
- **Test Runner Setup Plan**:
  - Create a test requirements file (e.g. `requirements-dev.txt`) containing:
    ```text
    pytest>=8.2.2
    pytest-asyncio>=0.23.7
    pytest-env>=1.1.3
    httpx>=0.27.0
    asgi-lifespan>=2.1.0
    ```
  - Create the `tests/` directory structured according to Layout Compliance (outside `.agents/`):
    ```text
    tests/
    ├── conftest.py          # Shared fixtures (db pool, mock client, FastAPI client)
    ├── e2e/
    │   ├── test_feature1.py  # FastAPI Lifespan & Imports
    │   ├── test_feature2.py  # Slack OAuth & Middleware
    │   ├── test_feature3.py  # Integrations & Encryption
    │   ├── test_feature4.py  # Dashboard CRUD & Workspace Scoping
    │   └── test_feature5.py  # Modal Sandbox & Agentic Workflows
    ```

---

## 4. Proposed E2E Test Suite Plan (4 Tiers for 5 Features)

### 4.1 The 5 Main Features
1. **Feature 1: FastAPI Lifespan & Inngest Client/Imports**
2. **Feature 2: Slack OAuth, Session & Middleware Redirection**
3. **Feature 3: Third-Party OAuth Integrations (Google/GitHub) & Token Encryption**
4. **Feature 4: Real-Data Dashboard Tabs (CRUD & Workspace Scoping)**
5. **Feature 5: Secure Modal Sandbox Execution & Agentic Workflows**

### 4.2 Test Matrix by Tier

| Feature | Tier 1: Feature Coverage (Happy Path) | Tier 2: Boundary & Corner Cases | Tier 3: Cross-Feature Combinations | Tier 4: Real-world Workloads |
| :--- | :--- | :--- | :--- | :--- |
| **F1: Lifespan & Imports** | 1. FastAPI app imports `api/inngest` and compiles without errors.<br>2. Startup initializes database pool.<br>3. Shutdown closes database pool.<br>4. Inngest serve registers exactly 6 workflow functions.<br>5. Client event key is correctly configured. | 1. Startup with missing/malformed DATABASE_URL raises connection error.<br>2. Multiple calls to get_pool() return same pool instance.<br>3. Accessing pool before init raises RuntimeError.<br>4. Inngest client gets fallback None if INNGEST_SIGNING_KEY missing.<br>5. Timeout handling during database query. | 1. Verify database operations succeed during lifespan when pool is active, and fail with pool closed after shutdown. | 1. Simulate server restart while inngest functions are running and assert pool re-initializes gracefully. |
| **F2: Slack OAuth & Middleware** | 1. Go OAuth handler redirects code-less request to landing page.<br>2. Slack code exchange returns success and dispatches workspace event.<br>3. Inngest workspace/install handler registers team.<br>4. Next.js middleware allows auth callback path.<br>5. Next.js middleware redirects /dashboard to landing page for guests. | 1. Go OAuth handler returns error on denied install.<br>2. Workspace installer handles missing team_id/token safely.<br>3. Middleware ignores static assets/api paths.<br>4. JWT session cookie manipulation blocks access.<br>5. Slack OAuth token exchange failure is propagated. | 1. Slack install callback creates workspace -> seeds skills -> admin user logs in -> middleware validates session and grants dashboard access. | 1. Complete multi-tenant installation: Install Slack team A and team B -> verify two separate workspaces created -> verify user A cannot access dashboard of team B. |
| **F3: Integrations & Encryption** | 1. Encrypt token returns Base64 string.<br>2. Decrypt token returns original text.<br>3. Store integration credential in database.<br>4. Retrieve integration credential.<br>5. Decrypt JSON credentials payload. | 1. Invalid hex key length raises ValueError.<br>2. Empty string encryption raises error.<br>3. Decrypting tampered ciphertext raises error.<br>4. Verification of no null-padding (hard ValueError).<br>5. Null values for integration optional tokens. | 1. Slack OAuth bot token is encrypted during install -> stored -> read from DB and decrypted for tool call. | 1. Multi-Integration setup: User sets up Google and GitHub accounts -> encrypts both -> runs integration tasks -> decrypts both successfully. |
| **F4: Dashboard Tabs (CRUD)** | 1. Create a schedule record.<br>2. Retrieve schedules list filtered by workspace.<br>3. Update schedule record.<br>4. Delete schedule record.<br>5. Verify whitelisted columns for updates. | 1. Querying with invalid UUID format returns error.<br>2. Update request with blacklisted columns ignores those columns.<br>3. Empty name on schedule creation.<br>4. Querying non-existent workspace ID returns empty list.<br>5. Double deletion check. | 1. Custom skill registration in dashboard creates database entry -> verify it shows in skills tab -> verify it can be updated. | 1. Manager populates dashboard: Creates 3 tasks, 2 schedules, and 1 workflow -> lists them -> updates 1 task to "completed" -> verifies usage logs are populated. |
| **F5: Modal Sandbox & Agents** | 1. Run safe Python code in sandbox.<br>2. AST scan allows safe pandas/numpy code.<br>3. Agent general node invokes general tool.<br>4. LangGraph executes planner loop.<br>5. Playwright CDP task connects to Lightpanda. | 1. AST scan blocks `import os`.<br>2. AST scan blocks `eval()` and `exec()`.<br>3. AST scan blocks dangerous dunders (e.g. `__globals__`).<br>4. Agent loop recursion limit protects against infinite loops.<br>5. Playwright CDP handling on browser crash. | 1. Event trigger executes workflow step -> runs registered skill -> executes inside Modal sandbox with AST security gate. | 1. Autonomous agent run: Slack message event -> triggers General agent -> agent writes python script -> script scanned by AST -> runs in Modal -> results logged to usage table. |

---

## 5. Focus Area Deep-Dive Specifications

### 5.1 Feature 1: FastAPI Lifespan, Inngest Imports & Client Configuration
The goal is to test the integration of the FastAPI runner, Inngest SDK, and connection pool lifespan.

*   **Imports Check**: Verification that all 6 handlers in `api/inngest.py` are loaded dynamically and bound to the shared `inngest_client`.
*   **Lifespan Lifecyle**:
    *   Using `asgi-lifespan`, start the FastAPI app instance.
    *   Assert that `src.db.client._pool` is not `None` and holds an active `asyncpg.Pool` connection pool.
    *   Verify pool configuration parameters (e.g. `min_size=2`, `max_size=10`).
    *   Stop the FastAPI app.
    *   Assert that `src.db.client._pool` has been set back to `None` and connection is terminated gracefully.

### 5.2 Feature 2: Slack OAuth, Session & Middleware Redirection
This focuses on validating the authorization sequence and security boundaries.

*   **OAuth Callback Verification**:
    *   Simulate a redirect callback to `GET /api/oauth` with a mock auth code.
    *   Mock the external `https://slack.com/api/oauth.v2.access` endpoint (using `pytest-httpx` or a custom mock client) to return a mock Slack bot token and team ID.
    *   Verify the Go handler dispatches the Inngest event `workspace/install` to `https://event.inngest.com/e/...`.
    *   Verify the client is redirected to `/dashboard?install=success`.
*   **Inngest Workspace Installer**:
    *   Send a mock `workspace/install` event payload directly to the Python handler `handle_workspace_install`.
    *   Assert the workspace is created in the database.
    *   Assert the bot token is stored in **encrypted** form (`workspaces` table).
    *   Assert the 6 built-in skills are seeded in the database.
*   **Middleware Guard & Redirection**:
    *   Simulate Next.js routing request to `/dashboard` without a session cookie.
    *   Assert the response is a redirect (HTTP 307/302) to `/?reason=unauthenticated`.
    *   Simulate request with a valid Supabase session token/cookie and assert HTTP 200/Next.js pass-through.
    *   *Planned Custom JWT Integration*: Mock JWT generation using `settings.HMAC_SECRET` (containing user claims and `workspace_id`), append to request header, and assert middleware successfully decodes the JWT and maps the user to their workspace.
