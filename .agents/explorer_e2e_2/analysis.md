# E2E Test Suite Analysis: Google & GitHub OAuth and Token Encryption

## 1. OAuth Consent Flow & Redirection Design

### 1.1 Google OAuth Flow
Google OAuth is designed to grant KlawHub access to Google Calendar and Google Drive APIs on behalf of a specific workspace tenant.

1. **Initiation Endpoint (`GET /api/oauth/google`)**:
   - **Trigger**: User clicks "Connect Google" on the `/dashboard/settings` frontend page.
   - **Parameters**: `workspace_id` (UUID) must be provided (retrieved from the active user's session context).
   - **State Token**: To prevent CSRF and bind the callback to the starting workspace, the handler generates a secure, cryptographically random `state` token. This state is mapped to the `workspace_id` in a transient store (e.g., Upstash Redis with a 15-minute TTL) or encoded in a signed JWT cookie.
   - **Redirection URL**:
     ```
     https://accounts.google.com/o/oauth2/v2/auth
       ?client_id=${GOOGLE_CLIENT_ID}
       &redirect_uri=${APP_URL}/api/oauth/google/callback
       &response_type=code
       &scope=https://www.googleapis.com/auth/calendar.events%20https://www.googleapis.com/auth/drive.readonly
       &state=${STATE}
       &access_type=offline
       &prompt=consent
     ```
     *Note: `access_type=offline` and `prompt=consent` are mandatory parameters to force Google to return a `refresh_token` on the first authorization.*

2. **Callback Endpoint (`GET /api/oauth/google/callback`)**:
   - **Parameters**: `code` (authorization code) and `state` (CSRF/workspace state).
   - **Validation**:
     - The `state` parameter is verified against the transient store. If the state is missing, invalid, or expired, a `400 Bad Request` (CSRF warning) is returned.
     - The corresponding `workspace_id` is retrieved.
   - **Token Exchange**:
     - The handler POSTs to `https://oauth2.googleapis.com/token` with the payload:
       - `code`: The authorization code.
       - `client_id`: `settings.GOOGLE_CLIENT_ID`.
       - `client_secret`: `settings.GOOGLE_CLIENT_SECRET`.
       - `redirect_uri`: `${APP_URL}/api/oauth/google/callback`.
       - `grant_type`: `authorization_code`.
     - The response contains: `access_token`, `refresh_token`, `expires_in`, and `id_token`.
   - **Encryption & Storage**:
     - The `access_token` and `refresh_token` are encrypted via `src/core/security/encryptor.py`.
     - The user's Google email is fetched from `https://www.googleapis.com/oauth2/v2/userinfo` using the new access token.
     - A row is upserted into the `integrations` table in Supabase.
   - **Redirection**: Redirects user back to `/dashboard/settings?google=success`.

### 1.2 GitHub OAuth / App Installation Flow
KlawHub integrates with GitHub via a GitHub App, which provides fine-grained permissions and supports repository installations.

1. **Initiation Endpoint (`GET /api/oauth/github`)**:
   - **Trigger**: User clicks "Connect GitHub" on `/dashboard/settings`.
   - **Parameters**: `workspace_id` (UUID).
   - **State Token**: Cryptographically signed/stored state containing the `workspace_id`.
   - **Redirection URL**:
     - If installing the GitHub App on repositories:
       `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${STATE}`
     - If authenticating users via GitHub OAuth (user access tokens):
       `https://github.com/login/oauth/authorize?client_id=${GITHUB_APP_CLIENT_ID}&state=${STATE}&scope=repo,user`
     *Note: KlawHub's tools (`github_tools.py`) use the token directly for calling API endpoints, indicating user-based OAuth or Installation Access Tokens are stored in the database.*

2. **Callback Endpoint (`GET /api/oauth/github/callback`)**:
   - **Parameters**:
     - OAuth route: `code` and `state`.
     - App Installation route: `installation_id`, `setup_action`, and `state`.
   - **Validation**: Verifies the `state` to extract the `workspace_id` and check CSRF validity.
   - **Token Exchange**:
     - For OAuth: POSTs to `https://github.com/login/oauth/access_token` with `client_id`, `client_secret`, and `code`. Extracts `access_token`.
     - For App Installation: Stores the `installation_id` in metadata. The backend can then dynamically generate installation access tokens using the App ID and Private Key JWT.
   - **Encryption & Storage**:
     - Access tokens are encrypted using `src/core/security/encryptor.py`.
     - Upserts the credentials into the `integrations` table.
   - **Redirection**: Redirects user to `/dashboard/settings?github=success`.

---

## 2. Database Storage & Token Encryption

### 2.1 The `integrations` Table Schema
Credentials are saved in the `integrations` table, which is designed as follows:
- `workspace_id` (UUID, Foreign Key to `workspaces.id`, primary key component)
- `provider` (VARCHAR, e.g., `'google'`, `'github'`, `'slack'`, primary key component)
- `access_token` (TEXT, stores the base64-encoded AES-256-GCM ciphertext payload)
- `metadata` (JSONB, stores auxiliary non-sensitive details like the connected account's `email`, `username`, `expires_at`, and encrypted `refresh_token`)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

### 2.2 Encryption Protocol (`src/core/security/encryptor.py`)
- **Cipher**: AES-256-GCM (Galois/Counter Mode), providing both **confidentiality** and **integrity (authenticated decryption)**.
- **Key Derivation**: `settings.ENCRYPTION_KEY` must be a 64-character hex string representing a 32-byte key. Decoded via `bytes.fromhex(raw)`.
- **Fail-Fast Security**: If `ENCRYPTION_KEY` is missing or not exactly 32 bytes, a hard `ValueError` is raised during class initialization. This prevents the application from starting up or silently degrading to null-padded/weak keys.
- **Payload Format**: The output of `encrypt()` is base64-encoded and structured as:
  `nonce (12 bytes) + GCM tag (16 bytes) + ciphertext (variable bytes)`
- **Decryption Verification**: `decrypt()` extracts the nonce and tag, and calls `cipher.decrypt_and_verify(ciphertext, tag)`. Any corruption of the payload or mismatch in the key raises a verification error (raising `ValueError` or `InvalidTag`).

---

## 3. E2E Test Suite Implementation Plan

This plan organizes testing into 4 distinct Tiers covering the 5 main features, with specialized details for Features 3 & 4.

### 3.1 Test Infrastructure Setup
- **Test Runner**: Python `pytest` with `pytest-asyncio` for async DB operations.
- **API Server Mocking**: Use `pytest-mock` or `respx` to mock external endpoints (Google Token exchange API, Google Calendar API, Google Drive API, GitHub API, Slack OAuth API).
- **Database Fixtures**: Pytest fixtures utilizing `asyncpg` to insert and tear down mock workspace rows, active sessions, and integration tokens directly in the Supabase test database.
- **Run Command**: `python -m pytest tests/e2e/ -v`

### 3.2 Testing Tiers & Features Matrix

| Tier | Feature 1: Lifespan & DB Pool | Feature 2: Slack OAuth & JWT Session | Feature 3: Google OAuth & Encryption | Feature 4: GitHub OAuth & Encryption | Feature 5: Dashboard CRUD & Tools |
|---|---|---|---|---|---|
| **Tier 1: Feature Coverage** | Verify FastAPI starts, DB pool initializes and shuts down cleanly. | Mock Slack callback code exchange; verify cookie set and dashboard access. | Verify Google OAuth redirect URLs, state generation, token encryption, and calendar tool execution. | Verify GitHub OAuth redirect, token exchange, encryption, and repo listing tool execution. | Test CRUD for all 8 tabs scoped by workspace ID. Verify tool registration. |
| **Tier 2: Boundary & Corner Cases** | Verify DB pool connection timeouts and recovery from DB disconnects. | Denied installs, expired JWTs, tampered cookie signatures, missing cookies. | CSRF state mismatch, expired codes, decryption with invalid keys, corrupted payload decryption. | Tampered GitHub state, revoked token API errors (401/403), empty access tokens. | SQL injection inputs, empty dashboard queries, access token deletion while tool runs. |
| **Tier 3: Cross-Feature Combinations** | Verify concurrent DB pooling during massive workspace installation spikes. | Map multiple team members under Slack OAuth to same workspace ID. | Settings tab disconnects Google integration; verify database deletion and UI update. | Connect GitHub, verify tool availability, disconnect GitHub, verify tool fails gracefully. | Multi-tenant isolation: Tenant A cannot view or update Tenant B's data. |
| **Tier 4: Real-world Workloads** | Long-running pool test with periodic query execution to verify liveness. | Complete login-to-dashboard user flow. | End-to-end schedule executing Google Calendar list tool and logging usage. | Agent workflow reacting to Slack message, fetching repos, opening PR, and posting back. | E2E task creator: scheduling task, assigning to member, checking workflow logs. |

---

## 4. Deep Dive: E2E Test Specifications for Features 3 & 4

### 4.1 Feature 3: Google OAuth & Encryption Tests

#### Test 3.1: Google OAuth Redirection (Tier 1)
- **Action**: Call `GET /api/oauth/google?workspace_id={workspace_id}`.
- **Assertion**:
  - Response status is `302 Found`.
  - Location header matches `https://accounts.google.com/o/oauth2/v2/auth`.
  - Query parameters include `client_id`, `access_type=offline`, `prompt=consent`, and a valid `state`.
  - The `state` is stored in the transient cache.

#### Test 3.2: Google Callback & Token Storage (Tier 1)
- **Action**: Mock the token exchange endpoint `https://oauth2.googleapis.com/token` to return a mock access token and refresh token. Send `GET /api/oauth/google/callback?code=mock_code&state={valid_state}`.
- **Assertion**:
  - Response redirects to `/dashboard/settings?google=success`.
  - The database contains a row in `integrations` for the workspace and `provider='google'`.
  - The stored `access_token` is encrypted (not plaintext).
  - Decrypting the database value using `encryptor.decrypt` yields the original mock access token.

#### Test 3.3: Google State CSRF Guard (Tier 2)
- **Action**: Call `GET /api/oauth/google/callback?code=mock_code&state=invalid_or_expired_state`.
- **Assertion**:
  - Response status is `400 Bad Request`.
  - No database insertion occurs.

#### Test 3.4: Invalid Decryption Key Fail-Fast (Tier 2)
- **Action**: Initialize `Encryptor` with an `ENCRYPTION_KEY` that is not 64 hex characters (e.g. empty or 10 characters).
- **Assertion**:
  - A `ValueError` is raised during initialization.
  - Encryption fails to proceed, preventing insecure execution.

#### Test 3.5: GCM Authenticated Tag Tampering (Tier 2)
- **Action**: Encrypt a token, retrieve the ciphertext payload. Tamper with 1 byte of the payload (either tag or ciphertext) and attempt to decrypt.
- **Assertion**:
  - Decryption fails, raising a verification error (`ValueError` or `InvalidTag`).

#### Test 3.6: Google Integration Disconnection (Tier 3)
- **Action**: Seed a Google token in `integrations`. Call settings DELETE endpoint `/api/integrations/google` with authenticated session.
- **Assertion**:
  - Response is `200 OK`.
  - Google token row is deleted from `integrations` table.
  - Running `list_calendar_events_tool` immediately fails with `ValueError` ("Google integration not configured").

#### Test 3.7: Scheduled Google Calendar Workflow (Tier 4)
- **Action**: Seed active Google integration. Create a schedule executing `list_calendar_events_tool`. Trigger schedule execution.
- **Assertion**:
  - Integration is decrypted.
  - Mock Google Calendar endpoint is called with `Authorization: Bearer mock-token`.
  - Usage log is written to `usage_logs` containing `status='success'` and `skill_used='document_master'` or calendar tool detail.

---

### 4.2 Feature 4: GitHub OAuth & Encryption Tests

#### Test 4.1: GitHub App Redirection (Tier 1)
- **Action**: Call `GET /api/oauth/github?workspace_id={workspace_id}`.
- **Assertion**:
  - Redirects to GitHub installation or authorize endpoint with a valid `state`.

#### Test 4.2: GitHub Callback & Token Storage (Tier 1)
- **Action**: Mock `https://github.com/login/oauth/access_token` to return `access_token=github_mock_token`. Call callback endpoint with correct code and state.
- **Assertion**:
  - Redirects to settings with success parameter.
  - Stored `access_token` is successfully encrypted using AES-256-GCM.
  - Running `list_repos_tool` decrypts the token, calls mock GitHub API, and returns repository data.

#### Test 4.3: GitHub State CSRF Guard (Tier 2)
- **Action**: Send callback with invalid state parameter.
- **Assertion**:
  - Request rejected with `400 Bad Request` or appropriate error redirect.

#### Test 4.4: Corrupted GitHub Payload Decryption (Tier 2)
- **Action**: Modify the base64-encoded encrypted token in the database by appending random characters or truncate it, then trigger `list_repos_tool`.
- **Assertion**:
  - Decryption raises a decoding/verification error.
  - The tool returns a clean error message: "Error listing repos: ..." (does not leak raw traceback or credentials).

#### Test 4.5: GitHub Token Revocation Recovery (Tier 2)
- **Action**: Mock the GitHub API to return a `401 Unauthorized` status. Trigger `list_repos_tool`.
- **Assertion**:
  - The system catches the error.
  - An alert or error is logged/returned indicating that the GitHub integration needs re-authentication.

#### Test 4.6: Multi-Tenant Tool Isolation (Tier 3)
- **Action**: Create Workspace A and Workspace B. Seed Google/GitHub integration for Workspace A, but leave Workspace B unconfigured. Call `list_repos_tool` with Workspace B's ID.
- **Assertion**:
  - Tool fails with "GitHub integration not configured for this workspace."
  - Workspace B is unable to read or execute tools using Workspace A's token.

#### Test 4.7: Autonomous Dev-PR Workflow (Tier 4)
- **Action**: Seed active GitHub integration. Trigger an agent planning run that calls `create_pull_request_tool` to open a PR on `owner/repo`.
- **Assertion**:
  - The agent decrypts the GitHub token.
  - Posts to mock GitHub API `https://api.github.com/repos/owner/repo/pulls` with correct JSON body.
  - Returns pull request URL and writes log to `usage_logs`.
