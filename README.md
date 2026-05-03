# Klawhub Build Squad

A multi-agent system that builds small software tools for you — all in Slack.

## Stack
- **Next.js 15** + TypeScript (Vercel)
- **Supabase** Postgres + Auth
- **Drizzle ORM**
- **Inngest** (async workflows)
- **Ollama Cloud** (Gemma 4 31B)
- **Tavily** (web search)
- **Modal** (code sandbox)
- **Slack API**

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/timilehin-dev/klawhub.git
cd klawhub
npm install
```

### 2. Environment Variables
Copy `.env.local.example` to `.env.local` and fill in all values.

### 3. Database Setup
```bash
npx drizzle-kit push
```

### 4. Deploy Modal Sandbox
```bash
modal deploy modal_app.py
```
Copy the deployed URL to `MODAL_FUNCTION_URL` in `.env.local`.

### 5. Run Locally
```bash
npm run dev
```

### 6. Expose Local Server (for Slack Socket Mode)
```bash
npx ngrok http 3000
```
Copy the HTTPS URL and update Slack Event Subscriptions / Interactivity URLs.

### 7. Deploy to Vercel
```bash
vercel --prod
```

## How It Works

1. User messages `@Klawhub` or uses `/klawhub [request]`
2. **General Agent** receives the request
3. **PM Agent** writes a technical spec
4. **Engineer Agent** writes the code
5. **QA Agent** tests it in a Modal sandbox
6. If it fails, Engineer fixes it once
7. Final code is delivered in the Slack thread

## File Structure
```
src/
├── lib/
│   ├── db/           # Drizzle schema + connection
│   ├── llm/          # Ollama Cloud client (2-key rotation)
│   ├── tools/        # 5 tools: search, memory, code, update
│   ├── agents/       # PM, Engineer, QA, General configs
│   ├── slack/        # Slack Web API client
│   └── inngest/      # Async workflow engine
└── app/
    └── api/
        ├── slack/    # Events, actions, commands
        └── inngest/  # Inngest function server
```

## Agent Team

| Agent | Role |
|-------|------|
| **General** | Router + coordinator |
| **PM** | Writes technical specs |
| **Engineer** | Writes code |
| **QA** | Tests code in sandbox |

## License
MIT
