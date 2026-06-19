# KlawHub v2

> **A self-evolving, Slack-native AI coworker** — not a chatbot.

KlawHub autonomously handles research, document creation, financial modeling, code execution, browser automation, data science, and more. It continuously learns from your organization and creates new capabilities on demand.

---

## Architecture

```
Slack Workspace
  │
  ├── Go API Gateway (Vercel) ── HMAC verify + Redis dedupe + Inngest dispatch
  │
  ├── Python Cognitive Worker
  │     ├── General Agent ── intent routing + tool execution
  │     ├── Planner Agent ── multi-step task orchestration
  │     └── QA Agent ── DLP firewall + factual validation
  │
  ├── Modal Sandbox (8–16 GB RAM)
  │     ├── Document processing (WeasyPrint, Pandoc, pdfplumber)
  │     ├── Data science (pandas, scikit-learn, plotly)
  │     ├── Financial modeling (yfinance, FinanceToolkit)
  │     ├── OCR (PaddleOCR, Tesseract)
  │     ├── Browser automation (Lightpanda CDP + Playwright)
  │     └── Self-evolving skill execution
  │
  └── Next.js Admin Dashboard (Vercel)
```

## Stack

| Component            | Technology                                    |
|----------------------|-----------------------------------------------|
| API Gateway          | Go serverless functions (Vercel)              |
| Async Orchestration  | Inngest Cloud (durable queues, step functions)|
| LLM                  | Nemotron (OpenAI-compatible API)              |
| Database             | Supabase (Postgres + pgvector + RLS)          |
| Cache                | Upstash Redis                                 |
| Sandbox              | Modal (isolated containers, 8–16 GB RAM)      |
| Browser              | Lightpanda (Zig CDP) + Playwright fallback    |
| Web Search           | Tavily API                                    |
| Dashboard            | Next.js 14 + Tailwind + Framer Motion         |

## Project Structure

```
klawhub/
├── api/                   # Go serverless endpoints (Vercel)
│   ├── events/events.go   # Slack Events API handler
│   ├── actions/actions.go # Slack interactive actions
│   ├── commands/commands.go # Slack slash commands
│   ├── oauth/oauth.go     # Slack OAuth installation flow
│   ├── health/health.go   # Health check endpoint
│   └── inngest_handler.py # Python Inngest webhook service
├── app/                   # Next.js admin dashboard
│   ├── page.tsx           # Landing page + Add to Slack
│   ├── middleware.ts      # Supabase auth guard
│   └── dashboard/         # Protected admin pages
├── src/                   # Python cognitive worker
│   ├── config.py          # Pydantic settings
│   ├── core/
│   │   ├── agents/        # LangGraph agent nodes
│   │   ├── llm/           # Nemotron async client
│   │   ├── security/      # AST scanner, DLP, AES encryptor
│   │   └── tools/         # Agent tool registry
│   ├── db/                # asyncpg pool + CRUD operations
│   ├── integrations/      # Slack, Tavily clients
│   └── workflows/         # Inngest workflow handlers
├── modal_app.py           # Modal sandbox (19 functions)
├── requirements.txt       # Python dependencies
├── go.mod                 # Go module definition
└── vercel.json            # Vercel build + routing config
```

## Built-in Skills

1. **Document Master** — PDF/DOCX/XLSX/CSV/PPTX creation, parsing, editing
2. **Data Science Lab** — EDA, visualization, ML pipeline
3. **Financial Modeler** — DCF, technical analysis, market data
4. **FullStack Engineer** — code gen, lint, test, deploy
5. **Research Synthesizer** — multi-source deep research
6. **Scheduler & Automation Engine** — crons, tasks, workflows

## Setup

### Prerequisites

- Python 3.12+
- Node.js 18+
- Go 1.22+
- Vercel CLI
- Modal account
- Supabase project
- Slack App configured

### Environment Variables

Copy `.env.example` to `.env` and fill in all required values:

```bash
cp .env.example .env
```

### Install Dependencies

```bash
# Python
pip install -r requirements.txt

# Node.js
npm install

# Go
go mod tidy
```

### Deploy

```bash
# Deploy Modal sandbox
modal deploy modal_app.py

# Deploy to Vercel
vercel deploy --prod
```

## License

Proprietary — All rights reserved.
