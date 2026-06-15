# Plan - E2E Testing Suite Implementation

## Steps to Implement and Verify

### Step 1: Initialize Pytest Test Environment
- Install test requirements (`pytest`, `pytest-asyncio`, `httpx`, `asgi-lifespan`, `respx` or custom mock structures).
- Create `tests/` and `tests/e2e/` directories.
- Create `tests/conftest.py` containing:
  - Database pool mock/fixture (configuring asyncpg database mock or sandbox client).
  - FastAPI ASGI client fixture (using `asgi-lifespan`).
  - Encryptor test key config.

### Step 2: Implement Tier 1 (Feature Coverage) Tests (25+ tests)
- **F1: FastAPI Imports & Lifespan** (5 tests):
  1. Test that `api/inngest.py` can be imported without compilation errors (validating fix for `inngest.fast_api`).
  2. Test FastAPI lifespan startup calls `init_db_pool()`.
  3. Test FastAPI lifespan shutdown calls `close_db_pool()`.
  4. Test that `serve()` is called with exactly 6 workflow functions.
  5. Test that `inngest_client` is correctly configured with event key.
- **F2: Slack OAuth & Dashboard Redirection** (5 tests):
  1. Test Go handler rejects non-GET methods.
  2. Test Go handler redirects code-less query to landing page with denied reason.
  3. Test Go handler redirects code query to `/dashboard?install=success`.
  4. Test that Inngest `handle_workspace_install` inserts the workspace in the database.
  5. Test that Next.js middleware redirects `/dashboard` requests to `/` if no session is present.
- **F3: Google OAuth & Encryption** (5 tests):
  1. Test AES-256-GCM encryption returns valid base64 payload.
  2. Test decryption restores exact plaintext.
  3. Test Google Workspace connect stores encrypted token in integrations table.
  4. Test Google Workspace tools list/create retrieve and decrypt the token.
  5. Test Google Workspace connect requests Calendar, Drive, and Gmail scopes.
- **F4: GitHub OAuth & Encryption** (5 tests):
  1. Test GitHub connect stores encrypted token in integrations table.
  2. Test GitHub tools list repos, create issues, create PRs retrieve and decrypt the token.
  3. Test GitHub connect handles redirects.
  4. Test encrypting dictionary data structure.
  5. Test decrypting dictionary data structure.
- **F5: Dashboard Scoping & CRUD** (5 tests):
  1. Test creating a schedule record inserts with correct `workspace_id`.
  2. Test retrieving schedules list filters by `workspace_id`.
  3. Test updating a schedule updates real records.
  4. Test deleting a schedule removes the record.
  5. Test listing other dashboard tab records (tasks, workflows, usage logs) is filtered by `workspace_id`.

### Step 3: Implement Tier 2 (Boundary & Corner Cases) Tests (25+ tests)
- **F1 Boundaries** (5 tests): startup with missing db url, multiple pool inits, premature pool accesses, inngest key fallbacks, query timeouts.
- **F2 Boundaries** (5 tests): OAuth callback with corrupted code, workspace installer with empty/missing tokens, middleware static asset pass-through, tampered JWT cookie blocking, OAuth connection timeouts.
- **F3 Boundaries** (5 tests): invalid encryptor key sizes, empty string encryption, decryption of tampered payloads, no null-padding check, null values in database.
- **F4 Boundaries** (5 tests): malformed GitHub token storage, empty/null values for scopes, database connection drops during integration retrieval, decryption failures handling, API HTTP error code propagation.
- **F5 Boundaries** (5 tests): malformed workspace UUIDs, updates with blacklisted fields, creation with empty fields, querying non-existent workspaces, double deletions.

### Step 4: Implement Tier 3 (Cross-Feature Pairwise) Tests (5+ tests)
- Create tests that test workspace installation -> seeding default skills -> settings token connection -> telemetry logging.
- Verify multi-tenant token isolation: check that Tenant A cannot read/decrypt Tenant B's credentials.

### Step 5: Implement Tier 4 (Real-world Workloads) Tests (5+ tests)
- Create 5 high-level workflows representing a complete user session (e.g. user installs slack workspace -> registers 3 tasks & 2 schedules -> runs research script -> checks usage log -> updates settings).

### Step 6: Create Test Runner Script & Publish TEST_READY.md
- Create a test runner script (`run_e2e_tests.ps1` or similar python command).
- Execute the test suite and verify all tests compile and pass.
- Write and publish `TEST_READY.md` containing the E2E Test Suite summary, features checklist, and execution commands.
