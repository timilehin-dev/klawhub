# Handoff Report: E2E Test Suite Design (Features 3 & 4)

## 1. Observation
1. **Token Retrieval and Decryption**:
   - Google Calendar and Drive tools retrieve and decrypt tokens from the `integrations` DB table. In `src/core/tools/google_tools.py` (lines 15-26):
     ```python
     async def _get_google_access_token(workspace_id: str) -> str:
         """Retrieves and decrypts the Google OAuth access token for this workspace."""
         rows = await execute_query(
             "SELECT * FROM integrations WHERE workspace_id = $1::uuid AND provider = 'google' LIMIT 1",
             workspace_id,
         )
         if not rows:
             raise ValueError("Google integration not configured for this workspace.")
         encrypted_token = dict(rows[0]).get("access_token")
         if not encrypted_token:
             raise ValueError("Google access token missing.")
         return encryptor.decrypt(encrypted_token)
     ```
   - GitHub tools retrieve and decrypt tokens from `integrations` in `src/core/tools/github_tools.py` (lines 15-26) using the exact same structure for `provider = 'github'`.

2. **Encryption Mechanism**:
   - `src/core/security/encryptor.py` uses AES-256-GCM. In `__init__` (lines 25-37):
     ```python
     self.key = bytes.fromhex(raw)
     if len(self.key) != 32:
         raise ValueError(
             f"ENCRYPTION_KEY decoded to {len(self.key)} bytes; "
             "must be exactly 32 bytes (64 hex characters)."
         )
     ```
   - Encryption output is `nonce + tag + ciphertext` base64-encoded, in `encrypt()` (lines 49-52):
     ```python
     cipher = AES.new(self.key, AES.MODE_GCM)
     ciphertext, tag = cipher.encrypt_and_digest(plaintext)
     payload = cipher.nonce + tag + ciphertext
     return base64.b64encode(payload).decode("utf-8")
     ```
   - Decryption performs tag validation, in `decrypt()` (lines 60-62):
     ```python
     cipher = AES.new(self.key, AES.MODE_GCM, nonce=nonce)
     plaintext = cipher.decrypt_and_verify(ciphertext, tag)
     ```

3. **Current Redirects and Frontend Mocking**:
   - In `app/dashboard/settings/page.tsx` (lines 52-70), the Google and GitHub connect logic is currently mocked on the client side:
     ```typescript
     const handleConnect = async (provider: string) => {
       const email = window.prompt(`Enter your ${provider} account email to connect:`);
       if (!email) return;
       
       try {
         const { error } = await supabase
           .from("integrations")
           .insert([{
             workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b",
             provider: provider,
             access_token: "mock-token",
             metadata: { email: email }
           }]);
         if (error) throw error;
         loadIntegrations();
       } catch (e) {
         console.log("Connect failed:", e);
       }
     };
     ```
   - In `vercel.json` (lines 17-26), only the Slack OAuth callback `/api/oauth` -> `/api/oauth/oauth.go` is defined:
     ```json
     { "src": "/api/oauth",   "dest": "/api/oauth/oauth.go"   }
     ```
     No endpoints for `/api/oauth/google` or `/api/oauth/github` exist yet in `vercel.json` or `api/`.

4. **Testing Environment**:
   - Executing `python -m pytest --version` returned: `C:\Python314\python.exe: No module named pytest`.
   - `pip list` confirmed that `pytest` is not installed.
   - `package.json` contains no frontend test suites.

## 2. Logic Chain
1. Since `pytest` is not installed, the first step of the implementation plan must be installing `pytest` and `pytest-asyncio`.
2. Since the Google and GitHub OAuth endpoints do not exist in the routing table or backend directory yet, the E2E test runner must mock these OAuth interactions (using mock redirect responses and token exchanges) or tests must verify the frontend client-side insert mock, with a view to switch to real integration tests once the routes are implemented in Milestone 4.
3. Because `src/core/security/encryptor.py` enforces a strict 32-byte key size on line 27, any test verification must verify that using shorter/longer keys causes initialization failure.
4. Because GCM mode includes authentication tag verification on line 61, modifying the base64 string or ciphertext in database rows must trigger a validation error, which must be caught gracefully by the tools.

## 3. Caveats
- Google and GitHub OAuth endpoints (`GET /api/oauth/google`, `GET /api/oauth/github`, and callbacks) are currently not implemented in the backend. Therefore, the E2E test plan is built around the *design specification* of these routes.
- RLS rules on the Supabase database were not directly verified as we do not have direct access to the database configuration files, but we assumed standard workspace-level isolation based on `workspace_id` parameters in all SQL queries.

## 4. Conclusion
- A comprehensive E2E test suite should be built using Python and `pytest`, with tests organized into 4 Tiers.
- Tests for Feature 3 and Feature 4 should mock Google/GitHub API responses, verify state-parameter CSRF protection, and ensure token encryption (AES-256-GCM) integrity via tampering tests.
- Key rotation and multi-tenant token isolation are critical validation targets for Tier 3 and Tier 4.

## 5. Verification Method
To verify the testing environment and proposed specifications:
1. Run `pip install pytest pytest-asyncio respx` to install required test dependencies.
2. Verify you can initialize the encryptor with:
   `ENCRYPTION_KEY=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f python -c "from src.core.security.encryptor import encryptor"` (64 hex characters).
3. Verify that running it with an invalid key raises `ValueError`.
4. Inspect `analysis.md` for the full implementation plan.
