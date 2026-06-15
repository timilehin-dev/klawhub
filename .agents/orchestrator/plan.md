# Plan: KlawHub Security access controls, OAuth integration, real-data dashboard, and import fixes.

## 1. High-Level Strategy
We will use the Project Pattern with two parallel tracks:
- **E2E Testing Track**: Build a comprehensive E2E test suite covering Slack login, token generation, OAuth consent flows, real-data dashboard CRUD operations, and tools verification.
- **Implementation Track**: Spawn sub-orchestrators to implement:
  - Vercel Python Import Fix (R1)
  - Slack-Linked Workspace Access Control (R2)
  - Google & GitHub OAuth Integration (R3)
  - Real-Data Dashboard Tabs (R4)
  - System & Tool Verification (R5)

## 2. Milestones
1. **Milestone 1: E2E Test Suite and Opaque-Box Test Setup**
   - Goal: E2E Testing Orchestrator builds the test framework and publishes `TEST_READY.md`.
2. **Milestone 2: Vercel Python Import Fix and DB Pool Fix**
   - Goal: Worker fixes the Vercel imports and asyncpg pooling.
3. **Milestone 3: Slack-Linked Workspace Access Control**
   - Goal: Implement Slack OAuth login, session cookie/JWT management, and retrieve/map workspace ID.
4. **Milestone 4: Google & GitHub OAuth integration**
   - Goal: Implement real OAuth consent flows, scope requests, and AES token encryption.
5. **Milestone 5: Real-Data Dashboard Tabs**
   - Goal: Wire all 8 tabs to query real Supabase records scoped by Slack workspace ID.
6. **Milestone 6: Verification & Adversarial Hardening**
   - Goal: Audit and verify tools, perform adversarial testing, run forensic audits, pass E2E tests.

## 3. Success Criteria
- 100% test pass on the E2E test suite.
- Clean Forensic Audit verdict with zero integrity violations.
