# KlawHub Vercel Deployment Guide

> **Replace `https://klawhub.vercel.app`** with your actual Vercel deployment domain throughout this guide.

---

## 1. Vercel Project Setup

1. Push your repository to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your repo
3. Framework preset: **Next.js**
4. Root directory: `./` (default)
5. Build command: `next build` (default)
6. Output directory: `.next` (default)

### Build Configuration (vercel.json — already in repo)
The project already includes `vercel.json` with:
- **Go serverless** for all `/api/*` Slack + OAuth + dashboard handlers
- **Python serverless** for `/api/inngest` (FastAPI + Inngest worker)
- **Next.js** for all frontend routes

No additional Vercel config changes needed.

---

## 2. Environment Variables

Set **all** of the following in **Vercel → Project Settings → Environment Variables**.

### Required — No Default

| Variable | Where to Get It | Used By |
|---|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL | Python backend, Go dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` secret | Python backend, Go dashboard |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` public key | Go dashboard |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` (copy both) | Next.js browser client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` (copy both) | Next.js browser client |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (transaction pooler, port 6543) | Python asyncpg pool |
| `SLACK_BOT_TOKEN` | Slack App → OAuth & Permissions → `xoxb-...` Bot User OAuth Token | Python Slack integration |
| `SLACK_SIGNING_SECRET` | Slack App → Basic Information → Signing Secret | Go Slack handlers (events, actions, commands) |
| `SLACK_CLIENT_ID` | Slack App → Basic Information → App Credentials → Client ID | Go Slack OAuth handler, landing page |
| `SLACK_CLIENT_SECRET` | Slack App → Basic Information → App Credentials → Client Secret | Go Slack OAuth handler |
| `INNGEST_EVENT_KEY` | [Inngest Cloud](https://www.inngest.com) → Dashboard → Event Keys → `Env: Production` | Go dispatch + Python Inngest client |
| `INNGEST_SIGNING_KEY` | Inngest Dashboard → Signing Keys → `signkey-...` | Python Inngest client (auto-verifies webhooks) |
| `MODAL_TOKEN_ID` | Terminal: `modal token new` → Token ID | Python Modal SDK |
| `MODAL_TOKEN_SECRET` | Terminal: `modal token new` → Token Secret | Python Modal SDK |
| `TAVILY_API_KEY` | [tavily.com](https://tavily.com) → API Keys | Python research tools |
| `ENCRYPTION_KEY` | Run: `openssl rand -hex 32` (64 hex chars) | Python Encryptor (AES-256-GCM) |
| `HMAC_SECRET` | Run: `openssl rand -hex 32` (64 hex chars) | Python agent state integrity |
| `NEXT_PUBLIC_APP_URL` | `https://klawhub.vercel.app` (no trailing slash) | OAuth redirect URIs, landing page "Add to Slack" button |
| `UPSTASH_REDIS_REST_URL` | [Upstash Console](https://console.upstash.com) → Redis Database → REST URL | Go Slack events deduplication |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → Redis Database → REST Token | Go Slack events deduplication |
| `UPSTASH_REDIS_URL` | Upstash → Redis Database → `rediss://...` URI | Python Redis client |

### Required — GITHUB_PAT for Private Repo Access (Optional)

| Variable | Where to Get It | Used By |
|---|---|---|
| `GITHUB_PAT` | GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens | `skill_installer.py` private repo auth |

Only needed if you want to install skills from **private** GitHub repos. Public repos work without it.

### Optional — Google OAuth (Calendar, Drive, Gmail)

| Variable | Where to Get It | Used By |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID | Go Google OAuth handler |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials → OAuth 2.0 Client Secret | Go Google OAuth handler |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same as `GOOGLE_CLIENT_ID` (copy both) | Dashboard settings page |

### Optional — GitHub App (Repo Management)

| Variable | Where to Get It | Used By |
|---|---|---|
| `GITHUB_APP_ID` | GitHub → Settings → Developer Settings → GitHub Apps → App ID | Go GitHub OAuth handler |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App → Generate a private key → paste the entire PEM (base64) | Go GitHub OAuth handler |
| `GITHUB_APP_CLIENT_ID` | GitHub App → Client ID | Go GitHub OAuth handler |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App → Client Secret | Go GitHub OAuth handler |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | Same as `GITHUB_APP_CLIENT_ID` (copy both) | Dashboard settings page |

### Optional — LLM

| Variable | Default | Used By |
|---|---|---|
| `OLLAMA_API_KEY` | (none) | Python LLM client |
| `OLLAMA_BASE_URL` | `https://ollama.com/v1` | Python LLM client |
| `NEMOTRON_MODEL` | `nemotron-3-ultra:cloud` | Python LLM client |

### Optional — App Config

| Variable | Default | Used By |
|---|---|---|
| `ENVIRONMENT` | `production` | Python runtime behavior |
| `LOG_LEVEL` | `info` | Python logging verbosity |

### Optional — Database (for local development only)

| Variable | Used By |
|---|---|
| `DIRECT_DATABASE_URL` | Python migrations (direct connection, port 5432) |

---

## 3. Modal Secret

In addition to Vercel env vars, create a **Modal Secret** that the sandbox containers can read:

```bash
modal secret create klawhub-secrets \
  SUPABASE_URL="https://<project>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
```

This is required because Modal containers run outside Vercel and need their own Supabase credentials.

---

## 4. Slack App Configuration

Create or configure your app at [api.slack.com/apps](https://api.slack.com/apps).

### 4a. Basic Information
- **Signing Secret** → copy to `SLACK_SIGNING_SECRET`

### 4b. OAuth & Permissions

**Redirect URL:** (must match exactly)
```
https://klawhub.vercel.app/api/oauth
```

**Bot Token Scopes:**
```
chat:write          Post messages in channels
commands            Respond to slash commands
channels:history    Read channel message history
channels:read       View channel metadata
files:read          Read uploaded files
files:write         Upload files
im:history          Read DM history
im:read             View DM channels
im:write            Send DMs
reactions:write     Add emoji reactions
team:read           Read team name/domain
users:read          View user profiles
users:read.email    Read user email addresses
```

**User Token Scopes:** (none required)

### 4c. Event Subscriptions

**Request URL:**
```
https://klawhub.vercel.app/api/events
```

**Subscribe to bot events:**
```
message.channels    Messages in public channels
message.im          Messages in DMs
app_mention         Bot @mentions
```

**Note:** KlawHub only processes `message` events. All other event types (reaction_added, file_shared, member_joined_channel) are silently ignored by the `/api/events` handler.

### 4d. Slash Commands

**Request URL:**
```
https://klawhub.vercel.app/api/commands
```

| Command | Description |
|---|---|
| `/klaw` | (or any custom command) — Dispatched to Inngest for processing |

Add one or more commands pointing to the same Request URL. The command payload is dispatched to Inngest as a `slack/command` event.

### 4e. Interactivity & Shortcuts

**Request URL:**
```
https://klawhub.vercel.app/api/actions
```

Enable **Interactivity** and point to the URL above. This handles button clicks, modal submissions, and message actions dispatched as `slack/action` events.

---

## 5. OAuth Provider Setup

### 5a. Google OAuth (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application)
3. **Authorized redirect URIs:**
   ```
   https://klawhub.vercel.app/api/oauth/google/callback
   ```
4. Copy **Client ID** → `GOOGLE_CLIENT_ID` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
5. Copy **Client Secret** → `GOOGLE_CLIENT_SECRET`
6. **Scopes requested:**
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/drive.file`

### 5b. GitHub OAuth (Optional)

You can use either a **GitHub OAuth App** or a **GitHub App**:

#### GitHub OAuth App
1. Go to GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App
2. **Authorization callback URL:**
   ```
   https://klawhub.vercel.app/api/oauth/github/callback
   ```
3. Copy **Client ID** → `GITHUB_APP_CLIENT_ID` + `NEXT_PUBLIC_GITHUB_CLIENT_ID`
4. Copy **Client Secret** → `GITHUB_APP_CLIENT_SECRET`
5. Set `GITHUB_APP_ID` to blank or the app ID number

#### GitHub App (with installation)
1. Go to GitHub → Settings → Developer Settings → GitHub Apps → New GitHub App
2. **Callback URL:**
   ```
   https://klawhub.vercel.app/api/oauth/github/callback
   ```
3. Copy **App ID** → `GITHUB_APP_ID`
4. Generate a **private key** (.pem) → paste contents into `GITHUB_APP_PRIVATE_KEY`
5. Copy **Client ID** → `GITHUB_APP_CLIENT_ID` + `NEXT_PUBLIC_GITHUB_CLIENT_ID`
6. Copy **Client Secret** → `GITHUB_APP_CLIENT_SECRET`

---

## 6. Inngest Setup

1. Create an account at [inngest.com](https://www.inngest.com)
2. Create a new app → note the **Event Key** and **Signing Key**
3. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel env vars
4. The Inngest SDK endpoint is: `https://klawhub.vercel.app/api/inngest`
5. No need to configure this URL in Inngest Cloud — the SDK sends events via the Event Key, and the signing key is used to verify webhooks automatically

### Registered Inngest Functions
The following functions auto-register on startup via `api/inngest_handler.py`:
- `workspace/install` — New workspace onboarding
- `skill/install` — GitHub skill installer
- `slack/command` — Slash command processing
- `slack/action` — Interactive action handling
- `slack/event` — Message event processing
- `message/handle` — Cognitive agent message handler
- `proactive/loop` — Scheduled proactive agent
- `workflow/trigger` — Custom workflow execution

---

## 7. Supabase Database Setup

### 7a. Schema Migrations
Run the following SQL in Supabase SQL Editor to create the required tables:

```sql
-- Workspaces
CREATE TABLE workspaces (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_team_id TEXT UNIQUE NOT NULL,
  slack_team_name TEXT,
  bot_token TEXT NOT NULL,
  settings JSONB DEFAULT '{}',
  persona_name TEXT DEFAULT 'Klaw',
  persona_prompt TEXT,
  whitelisted_channels TEXT[] DEFAULT '{}',
  active_skills TEXT[] DEFAULT '{}',
  plan TEXT DEFAULT 'free',
  monthly_run_limit INT DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace Members
CREATE TABLE workspace_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  slack_username TEXT,
  role TEXT DEFAULT 'member',
  email TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, slack_user_id)
);

-- Skills Catalog
CREATE TABLE skills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  skill_type TEXT DEFAULT 'builtin',
  entry_file TEXT,
  code TEXT,
  requirements TEXT,
  documentation TEXT,
  version TEXT DEFAULT '1.0.0',
  created_by TEXT DEFAULT 'system',
  activation_status TEXT DEFAULT 'pending_approval',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, slug, version)
);

-- Schedules
CREATE TABLE schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schedule_type TEXT,
  cron_expr TEXT,
  channel_id TEXT,
  payload JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_by TEXT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks
CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo',
  priority TEXT DEFAULT 'medium',
  payload JSONB DEFAULT '{}',
  created_by TEXT,
  assignee_slack_id TEXT,
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflows
CREATE TABLE workflows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT,
  trigger_config JSONB DEFAULT '{}',
  steps JSONB DEFAULT '[]',
  created_by TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integrations (Google, GitHub tokens)
CREATE TABLE integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, provider)
);

-- Agent States
CREATE TABLE agent_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_ts TEXT NOT NULL,
  channel_id TEXT,
  agent_name TEXT NOT NULL,
  state_payload JSONB,
  hmac_sig TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, thread_ts, agent_name)
);

-- Usage Logs
CREATE TABLE usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_user_id TEXT,
  agent_name TEXT,
  skill_used TEXT,
  sandbox_function TEXT,
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  total_tokens INT GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  latency_ms INT DEFAULT 0,
  status TEXT DEFAULT 'success',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge Base
CREATE TABLE knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT,
  embedding VECTOR(1536),
  source_type TEXT,
  source_url TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Processed Events (deduplication)
CREATE TABLE processed_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pending Actions (admin approval queue)
CREATE TABLE pending_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  title TEXT,
  description TEXT,
  payload JSONB DEFAULT '{}',
  requested_by TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7b. Enable pgvector Extension
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 7c. Enable Row Level Security
```sql
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge ENABLE ROW LEVEL SECURITY;
```

### 7d. Create Indexes
```sql
CREATE INDEX idx_skills_workspace ON skills(workspace_id);
CREATE INDEX idx_schedules_workspace ON schedules(workspace_id);
CREATE INDEX idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
CREATE INDEX idx_integrations_workspace ON integrations(workspace_id, provider);
CREATE INDEX idx_usage_workspace ON usage_logs(workspace_id);
CREATE INDEX idx_knowledge_workspace ON knowledge(workspace_id);
CREATE INDEX idx_agent_states_lookup ON agent_states(workspace_id, thread_ts, agent_name);
```

---

## 8. Upstash Redis Setup (Optional for Deduplication)

1. Create a Redis database at [upstash.com](https://upstash.com)
2. Copy the **REST URL** → `UPSTASH_REDIS_REST_URL`
3. Copy the **REST Token** → `UPSTASH_REDIS_REST_TOKEN`
4. Copy the `rediss://` connection string → `UPSTASH_REDIS_URL`

Without Redis, the Slack events handler still works but skips deduplication (Slack may occasionally retry the same event).

---

## 9. Deployment Steps (Quick Checklist)

```
□  1. Push repo to GitHub
□  2. Import into Vercel (Framework: Next.js)
□  3. Add all required env vars in Vercel → Settings → Environment Variables
□  4. Create Modal Secret:  modal secret create klawhub-secrets SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
□  5. Create Slack App at api.slack.com/apps
□  6. Configure OAuth Redirect:  https://<domain>/api/oauth
□  7. Configure Event Subscription URL:  https://<domain>/api/events
□  8. Configure Slash Command URL:  https://<domain>/api/commands
□  9. Configure Interactivity URL:  https://<domain>/api/actions
□ 10. Install Slack App to workspace
□ 11. Set up Google OAuth (optional): redirect URI https://<domain>/api/oauth/google/callback
□ 12. Set up GitHub App (optional): callback URL https://<domain>/api/oauth/github/callback
□ 13. Run Supabase SQL migrations (Section 7)
□ 14. Deploy on Vercel
□ 15. Verify:  https://<domain>/api/health  →  {"status":"OK","timestamp":"...","version":"2.0.0"}
□ 16. Verify: Slack "Add to Slack" button → OAuth flow → redirect to dashboard
```

---

## 10. URL Reference

All important URLs for reference (replace domain):

```
# Slack App Configuration
OAuth Redirect URL:           https://klawhub.vercel.app/api/oauth
Event Subscription URL:       https://klawhub.vercel.app/api/events
Slash Command URL:            https://klawhub.vercel.app/api/commands
Interactivity Request URL:    https://klawhub.vercel.app/api/actions

# OAuth Callbacks
Google OAuth Redirect URI:    https://klawhub.vercel.app/api/oauth/google/callback
GitHub OAuth Callback URL:    https://klawhub.vercel.app/api/oauth/github/callback

# Inngest
Inngest SDK Endpoint:         https://klawhub.vercel.app/api/inngest

# Health Check
Health Endpoint:              https://klawhub.vercel.app/api/health

# Dashboard (after login)
Console Home:                 https://klawhub.vercel.app/overview
```
