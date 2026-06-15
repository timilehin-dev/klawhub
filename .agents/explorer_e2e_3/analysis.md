# E2E Test Suite Analysis & Planning

This document details the analysis of KlawHub's dashboard workspace-scoping issues, tool integration architecture, and outlines a comprehensive 4-Tier E2E test plan.

---

## 1. Dashboard Workspace Scoping (Feature 5)

### Direct Observations & Code Audit
All Next.js frontend pages in `app/dashboard/` currently query and write database records using the anonymous Supabase client without proper workspace boundaries. Specifically:
1. **Overview Dashboard (`app/dashboard/page.tsx`)**:
   - Queries `skills` and `usage_logs` without filtering by `workspace_id`.
   - Returns all logs in the system, violating multi-tenant isolation.
2. **Schedules Manager (`app/dashboard/schedules/page.tsx`)**:
   - Queries `schedules` without filtering by `workspace_id`.
   - Hardcodes `workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b"` on insertions.
   - Updates (`is_active` toggle) and deletes records using only the row `id` without verifying the workspace owner.
3. **Tasks Manager (`app/dashboard/tasks/page.tsx`)**:
   - Queries all `tasks` without filtering.
   - Hardcodes `workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b"` on insertions.
   - Updates status and deletes records using only the row `id`.
4. **Workflows Designer (`app/dashboard/workflows/page.tsx`)**:
   - Queries all `workflows` without filtering.
   - Hardcodes `workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b"` on insertions.
   - Deletes records using only the row `id`.
5. **Knowledge Base (`app/dashboard/knowledge/page.tsx`)**:
   - Queries all `knowledge` without filtering.
   - Hardcodes `workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b"` on insertions.
   - Deletes records using only the row `id`.
6. **Usage Telemetry (`app/dashboard/usage/page.tsx`)**:
   - Queries all `usage_logs` without filtering, aggregating system-wide token volume and latency.
7. **Settings Manager (`app/dashboard/settings/page.tsx`)**:
   - Hardcodes `workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b"` when loading/deleting integrations.
   - Queries `workspaces` table with `.limit(1)` (fetching the first available row) rather than the active user's workspace.
   - Updates workspace settings by hardcoding the mock UUID: `.eq("id", "b3196921-28c3-4cc9-964f-fa775f5b3e6b")`.

### Proposed Fix Strategy
To implement true multi-tenant workspace-scoped CRUD operations:
1. **Workspace Retrieval Context**:
   Create a react context or hook (e.g. `useWorkspace`) that fetches the current authenticated user's workspace metadata. Because `middleware.ts` ensures a valid Supabase Auth session, we can map the authenticated user's email to their workspace ID:
   ```typescript
   const { data: { session } } = await supabase.auth.getSession();
   const email = session?.user?.email;
   const { data } = await supabase
     .from("workspace_members")
     .select("workspace_id, role")
     .eq("email", email)
     .single();
   const workspaceId = data?.workspace_id;
   ```
2. **Apply Filter to Queries**:
   Modify all SELECT queries to filter by `.eq("workspace_id", workspaceId)`.
3. **Scoped Mutations**:
   Ensure all INSERT, UPDATE, and DELETE operations target `workspace_id` dynamically:
   - On inserts: `workspace_id: workspaceId`
   - On updates/deletions: `.eq("id", id).eq("workspace_id", workspaceId)` (verifying workspace ownership before mutation).

---

## 2. Tool Integration Registration & Verification

### Slack
- **Registration**: Handles OAuth installation callback via Go API handler `api/oauth/oauth.go`. The gateway exchanges the OAuth code for a bot access token, then dispatches the `workspace/install` event with Slack team details and tokens to Inngest.
- **Verification**: Inngest workflow handler `handle_workspace_install` (`src/workflows/workspace_installer.py`) encrypts the bot token using `encryptor.encrypt(raw_bot_token)`, upserts a row in the `workspaces` table, seeds the 6 built-in skills, and creates the admin user in `workspace_members`.

### Google & GitHub
- **Registration**: Per-workspace integrations are saved in the `integrations` table with columns `workspace_id`, `provider` ("google" / "github"), `access_token` (encrypted), and `metadata` (JSON).
- **Verification**: Google (`src/core/tools/google_tools.py`) and GitHub (`src/core/tools/github_tools.py`) tools query the `integrations` table for the active `workspace_id` and provider, decrypt the access token using `encryptor.decrypt()`, and invoke their respective REST API clients (Google Calendar/Drive, GitHub Repos/Issues/PRs).

### Tavily
- **Registration**: Configured globally in `.env` using `TAVILY_API_KEY`. No per-workspace registration.
- **Verification**: `search_web_tool` (`src/core/tools/web_search.py`) executes a search using the global API key.

### Modal Sandboxes
- **Registration**: Container images and 18 sandbox functions are declared in `modal_app.py` and deployed under the app `"klawhub-sandbox"`.
- **Verification**: `run_sandbox_function` (`src/core/tools/skill_runner.py`) looks up the app function remotely (`modal.Function.lookup("klawhub-sandbox", func_name)`) and executes it.

---

## 3. E2E Test Suite Implementation Plan

### Test Infrastructure Setup
- **Framework**: Python `pytest` + `pytest-asyncio` + `httpx`.
- **Location**: `tests/e2e/`.
- **Database Fixtures**: Configured to run migrations, setup/teardown test workspaces, insert mock workspace members, and cleanup tables (`workspaces`, `workspace_members`, `schedules`, `tasks`, `workflows`, `knowledge`, `integrations`, `usage_logs`) after each test run.
- **Environment variables**: Use mock keys (`ENCRYPTION_KEY`, `HMAC_SECRET`) and point API urls to the local testing environment.

---

### Tier 1: Feature Coverage (>=5 Tests per Feature)

#### Feature 1: FastAPI Lifespan & Inngest Initialization
1. **`test_fastapi_app_startup`**: Asserts the FastAPI application starts, runs its lifespan context, and initializes the `asyncpg` connection pool.
2. **`test_inngest_handshake`**: Sends a GET request to `/api/inngest` and verifies the Inngest reflection handshake (returns registered functions).
3. **`test_inngest_function_registration`**: Asserts all 6 core handlers (`handle_slack_message_event`, `handle_slack_slash_command`, `proactive_schedule_loop`, `install_skill_from_github`, `execute_workflow`, `handle_workspace_install`) are present in Inngest client registration.
4. **`test_fastapi_app_shutdown`**: Simulates process termination and asserts the connection pool is closed gracefully.
5. **`test_fastapi_invalid_event_rejection`**: Posts an invalid JSON payload to Inngest endpoint and asserts a rejection code.

#### Feature 2: Slack OAuth & Session Management
1. **`test_slack_install_redirect`**: Sends GET to `/api/oauth/slack` and asserts redirect to Slack authorization URL.
2. **`test_slack_oauth_callback`**: Simulates a GET to `/api/oauth` callback with code, asserts it exchanges code and dispatches `workspace/install` event.
3. **`test_middleware_guard_dashboard`**: Sends a request to `/dashboard` without cookies and asserts redirect to `/` with `reason=unauthenticated`.
4. **`test_middleware_allows_authenticated`**: Issues a valid JWT cookie, requests `/dashboard`, and asserts HTTP 200.
5. **`test_denied_installation_redirect`**: Calls callback with `error=access_denied` and asserts redirect to landing page with denied reason.

#### Feature 3: Google Workspace Integration & Encryption
1. **`test_google_integration_storage`**: Inserts a Google integration row, verifies `access_token` is successfully encrypted in database.
2. **`test_google_integration_decryption`**: Decrypts stored Google token and verifies it matches the original token.
3. **`test_list_calendar_events_tool`**: Mock Google API, execute calendar listing tool, and assert correct event extraction.
4. **`test_create_calendar_event_tool`**: Mock calendar event creation, assert tool issues POST to Google and returns success link.
5. **`test_list_drive_files_tool`**: Mock Google Drive list, execute tool, and assert file summaries are returned.

#### Feature 4: GitHub Development Integration & Encryption
1. **`test_github_integration_storage`**: Asserts GitHub access token is encrypted and saved.
2. **`test_github_integration_decryption`**: Verifies exact decryption of GitHub token.
3. **`test_list_github_repos_tool`**: Mock GitHub repo endpoint, execute tool, assert repo names parsed.
4. **`test_create_github_issue_tool`**: Mock issue creation, assert issue URL returned.
5. **`test_create_pull_request_tool`**: Mock PR creation, assert PR URL returned.

#### Feature 5: Scoped Dashboard CRUD Operations
1. **`test_overview_scoped_telemetry`**: Inserts usage logs for workspaces A and B. Fetches overview metrics for workspace A and asserts logs from B are excluded.
2. **`test_schedules_crud_scoping`**: Inserts schedule for workspace A. Asserts workspace B cannot see, update, or delete it.
3. **`test_tasks_crud_scoping`**: Verifies task insertions, updates, and deletions are strictly scoped to the active workspace.
4. **`test_workflows_crud_scoping`**: Verifies workflow designer selects and creates records isolated by workspace ID.
5. **`test_knowledge_crud_scoping`**: Verifies vector database inserts/searches do not leak knowledge between workspaces.

---

### Tier 2: Boundary & Corner Cases (>=5 Tests per Feature)

#### Feature 1: FastAPI / Inngest Edge Cases
1. **`test_db_pool_timeout`**: Simulates database connection timeout and verifies FastAPI health check handles failure gracefully.
2. **`test_inngest_signing_key_validation`**: Posts events with invalid Inngest signatures and asserts HTTP 401.
3. **`test_duplicate_event_deduplication`**: Dispatches the same event ID twice, verifies the second call is skipped via `processed_events`.
4. **`test_fastapi_payload_limit`**: Posts an extremely large event payload and asserts rejection/error logging.
5. **`test_lifespan_multiple_calls`**: Verifies connection pool initialization handles redundant startup calls safely.

#### Feature 2: Slack OAuth Edge Cases
1. **`test_callback_missing_params`**: Calls callback without code/error parameters and asserts HTTP 400.
2. **`test_expired_jwt_cookie`**: Requests `/dashboard` with an expired JWT cookie, verifies redirect to login.
3. **`test_jwt_signature_mismatch`**: Requests `/dashboard` with a tampered JWT signature and asserts rejection.
4. **`test_oauth_state_hijacking`**: Simulates OAuth callback with state token mismatch, asserts auth fails.
5. **`test_installation_db_failure`**: Simulates a database outage during the installation workflow and asserts correct Inngest step retries.

#### Feature 3: Google OAuth Edge Cases
1. **`test_google_missing_integration`**: Attempts to execute Google tools for a workspace without Google integration, asserts ValueError is raised.
2. **`test_google_expired_token`**: Mock Google API returning 401 Unauthorized, assert tool handles token expiration or failure gracefully.
3. **`test_google_malformed_token`**: Attempts to decrypt a corrupted/malformed token payload, asserts decryption failure is raised hard.
4. **`test_google_empty_credentials`**: Attempts integration registration with blank credentials, asserts validation error.
5. **`test_google_api_timeout`**: Mock Google API timeout (slow connection), assert tool fails gracefully without hanging.

#### Feature 4: GitHub OAuth Edge Cases
1. **`test_github_missing_integration`**: Asserts repository list fails with clean exception when GitHub integration is missing.
2. **`test_github_invalid_repo_format`**: Calls issue creation with malformed repo string (e.g. no slash) and asserts ValueError.
3. **`test_github_token_decryption_mismatch`**: Asserts token decryption fails if ENCRYPTION_KEY is changed.
4. **`test_github_api_403_rate_limit`**: Mock GitHub API returning 403 Rate Limit, assert tool formats rate-limit error.
5. **`test_github_empty_token_rejection`**: Verifies that saving an empty access token fails database constraints.

#### Feature 5: Scoped CRUD Edge Cases
1. **`test_cross_workspace_mutation_attack`**: Authenticates user A, attempts POST request to delete schedule belonging to workspace B. Asserts database update is rejected/ignored.
2. **`test_nonexistent_workspace_crud`**: Attempts to query/write records with a non-existent UUID workspace_id, asserts foreign key constraint failure.
3. **`test_dashboard_invalid_uuid`**: Calls CRUD endpoints with a malformed/non-UUID workspace ID, asserts validation rejection.
4. **`test_knowledge_empty_embedding`**: Attempts cataloging knowledge without an embedding vector, asserts rejection.
5. **`test_settings_multiple_integrations`**: Connects multiple Google integrations to the same workspace, asserts settings handles or merges them correctly.

---

### Tier 3: Cross-Feature Pairwise Combinations
1. **Workspace OAuth + Dashboard CRUD**: Verify that completing the Slack OAuth installation flow (Feature 2) immediately allows the newly registered workspace ID to fetch empty lists and insert records in all 8 dashboard tabs (Feature 5).
2. **Workflow Insertion + Sandbox Run**: Insert a new custom workflow (Feature 5) containing a code step, trigger its execution (Feature 1), and verify the workflow executes the script inside the Modal sandbox (Tool validation).
3. **Google/GitHub Integrations + Telemetry**: Store encrypted credentials for Google and GitHub (Features 3/4), execute a tool that queries those APIs, and assert that resource usage and latency are successfully logged to `usage_logs` (Feature 5).
4. **Admin Role Demotion + Dashboard Mutations**: Alter a user's role to "member" in `workspace_members` and verify the middleware or database rules block them from saving settings or deleting integrations (Feature 2 + Feature 5).
5. **Deregistration + Resource Cleanup**: Simulates Slack workspace uninstallation (Feature 2), which disables the workspace and asserts all related schedules, tasks, and integrations are marked inactive or removed (Feature 5).

---

### Tier 4: Real-world Application Scenarios (Workloads)
1. **Workspace Onboarding & Configuration**:
   - Install a workspace via Slack OAuth.
   - Login as admin to the Dashboard.
   - Go to settings, update the AI coworker's persona name and whitelisted channels.
   - Assert workspaces row updates and seeds 6 built-in skills.
2. **Dynamic Skill Pipeline**:
   - Install custom skill from GitHub repository.
   - Trigger Inngest installation queue.
   - Run AST scan to verify safety.
   - Build container and test skill inside the Modal sandbox.
   - Mark skill active, call it via Slack mention event, and assert results return.
3. **Proactive Standup Schedule Loop**:
   - Create standup schedule cron (9:00 AM) in schedules manager.
   - Trigger schedule loop execution.
   - Verify task is spawned, assigned to the cognitive agent, and executed.
   - Verify task completes and logs token usage in database.
4. **Tenant Isolation & Security Audit**:
   - Create two workspaces (Tenant A and Tenant B).
   - Tenant A catalogs sensitive company facts in Knowledge Base.
   - Tenant B attempts a vector similarity search.
   - Verify Tenant B gets 0 results (perfect isolation).
   - Tenant B attempts to call REST endpoints to list Tenant A's tasks. Verify HTTP 403 Forbidden.
5. **Complex Multi-Tool Orchestration**:
   - Connect Google Calendar and GitHub integrations.
   - Send Slack command to check calendar.
   - Cognitive planner runs. Retrieves Google events.
   - Finds event "Fix billing bug", queries GitHub to verify if issue exists.
   - GitHub issue does not exist -> creates issue.
   - Responds to Slack thread with calendar list and the created issue URL.
   - Decrypts both tokens, executes sandbox code, and logs usage correctly.

---

## 4. Mocking Strategy for Integrations

1. **Slack API Mock**:
   - Intercept calls to `https://slack.com/api/oauth.v2.access` and `https://slack.com/api/chat.postMessage`.
   - Return static mock JSON payloads matching success/failure OAuth signatures.
2. **Google REST API Mock**:
   - Intercept requests to Google API endpoints:
     - `GET /calendar/v3/calendars/primary/events`
     - `POST /calendar/v3/calendars/primary/events`
     - `GET /drive/v3/files`
   - Use `httpx.Mock` or `pytest-httpserver` to return mock event lists and file structures.
3. **GitHub API Mock**:
   - Intercept calls to `api.github.com`:
     - `GET /installation/repositories`
     - `POST /repos/{repo}/issues`
     - `POST /repos/{repo}/pulls`
   - Assert authorization headers contain `token mock-token` (decrypted) and return mock repo/issue metadata.
4. **Tavily Search API Mock**:
   - Intercept `https://api.tavily.com/search`.
   - Verify `api_key` payload is populated and return mock search answers/snippets.
5. **Modal Sandbox Mock**:
   - Intercept `modal.Function.lookup` using `unittest.mock.patch` for local E2E runs.
   - The mock function returns a callable that validates AST safety locally and executes scripts using a local python executor, avoiding the network cost and credential requirement of running remote Modal apps.
