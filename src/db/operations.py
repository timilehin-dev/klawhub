"""
Database CRUD operations for KlawHub.

All functions use the shared asyncpg connection pool (via `ensure_pool()`).
This eliminates the per-query TCP reconnect overhead and respects
Supabase's connection limits.
"""
import json
import asyncpg
from typing import Dict, Any, List, Optional
from src.db.client import ensure_pool


# ── Low-level helpers ────────────────────────────────────────────────────────

async def execute_query(query: str, *args) -> List[asyncpg.Record]:
    """Run a SELECT and return all rows."""
    pool = await ensure_pool()
    async with pool.acquire() as conn:
        return await conn.fetch(query, *args)


async def execute_one(query: str, *args) -> Optional[asyncpg.Record]:
    """Run a SELECT and return at most one row."""
    pool = await ensure_pool()
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def execute_statement(query: str, *args) -> str:
    """Run an INSERT / UPDATE / DELETE and return the status string."""
    pool = await ensure_pool()
    async with pool.acquire() as conn:
        return await conn.execute(query, *args)


async def execute_val(query: str, *args) -> Any:
    """Run a query and return a single scalar value (e.g. from RETURNING id)."""
    pool = await ensure_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(query, *args)


# ── processed_events ──────────────────────────────────────────────────────────

async def check_event_processed(event_id: str) -> bool:
    """Checks if event has already been processed (for deduplication)."""
    row = await execute_one("SELECT 1 FROM processed_events WHERE event_id = $1", event_id)
    return row is not None


async def mark_event_processed(event_id: str, workspace_id: Optional[str] = None) -> None:
    """Marks event as processed."""
    await execute_statement(
        "INSERT INTO processed_events (event_id, workspace_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        event_id, workspace_id
    )


# ── workspaces ────────────────────────────────────────────────────────────────

async def get_workspace_by_slack_team_id(slack_team_id: str) -> Optional[Dict[str, Any]]:
    row = await execute_one("SELECT * FROM workspaces WHERE slack_team_id = $1 LIMIT 1", slack_team_id)
    return dict(row) if row else None


async def get_workspace_by_id(workspace_id: str) -> Optional[Dict[str, Any]]:
    row = await execute_one("SELECT * FROM workspaces WHERE id = $1::uuid LIMIT 1", workspace_id)
    return dict(row) if row else None


async def create_workspace(
    slack_team_id: str,
    slack_team_name: str,
    bot_token: str,
    bot_user_id: str,
) -> str:
    """Upserts a workspace record and returns its UUID."""
    wid = await execute_val(
        """
        INSERT INTO workspaces (slack_team_id, slack_team_name, bot_token, settings)
        VALUES ($1, $2, $3, jsonb_build_object('bot_user_id', $4))
        ON CONFLICT (slack_team_id) DO UPDATE
          SET bot_token      = EXCLUDED.bot_token,
              settings       = workspaces.settings || jsonb_build_object('bot_user_id', $4),
              last_active_at = NOW()
        RETURNING id
        """,
        slack_team_id, slack_team_name, bot_token, bot_user_id
    )
    return str(wid)


async def update_workspace(workspace_id: str, updates: Dict[str, Any]) -> None:
    _ALLOWED_WORKSPACE_COLS = {
        "slack_team_name", "bot_token", "persona_name",
        "persona_prompt", "plan", "monthly_run_limit",
        "whitelisted_channels", "active_skills", "settings",
    }
    set_clause, values = _build_set_clause(updates, _ALLOWED_WORKSPACE_COLS, start=2)
    query = f"UPDATE workspaces SET {set_clause}, last_active_at = NOW() WHERE id = $1::uuid"
    await execute_statement(query, workspace_id, *values)


# ── workspace_members ─────────────────────────────────────────────────────────

async def get_workspace_member(workspace_id: str, slack_user_id: str) -> Optional[Dict[str, Any]]:
    row = await execute_one(
        "SELECT * FROM workspace_members WHERE workspace_id = $1::uuid AND slack_user_id = $2 LIMIT 1",
        workspace_id, slack_user_id
    )
    return dict(row) if row else None


async def create_workspace_member(
    workspace_id: str, slack_user_id: str, slack_username: str,
    role: str = "member", email: Optional[str] = None
) -> None:
    await execute_statement(
        """
        INSERT INTO workspace_members (workspace_id, slack_user_id, slack_username, role, email)
        VALUES ($1::uuid, $2, $3, $4, $5)
        ON CONFLICT (workspace_id, slack_user_id) DO UPDATE
          SET slack_username = EXCLUDED.slack_username, last_active_at = NOW()
        """,
        workspace_id, slack_user_id, slack_username, role, email
    )


# ── agent_states ──────────────────────────────────────────────────────────────

async def get_agent_state(workspace_id: str, thread_ts: str, agent_name: str) -> Optional[Dict[str, Any]]:
    row = await execute_one(
        "SELECT * FROM agent_states WHERE workspace_id = $1::uuid AND thread_ts = $2 AND agent_name = $3 LIMIT 1",
        workspace_id, thread_ts, agent_name
    )
    if row:
        record = dict(row)
        if isinstance(record.get("state_payload"), str):
            record["state_payload"] = json.loads(record["state_payload"])
        return record
    return None


async def save_agent_state(
    workspace_id: str, thread_ts: str, channel_id: str,
    agent_name: str, state_payload: Dict[str, Any], hmac_sig: str
) -> None:
    await execute_statement(
        """
        INSERT INTO agent_states (workspace_id, thread_ts, channel_id, agent_name, state_payload, hmac_sig, updated_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (workspace_id, thread_ts, agent_name)
        DO UPDATE SET state_payload = EXCLUDED.state_payload, hmac_sig = EXCLUDED.hmac_sig, updated_at = NOW()
        """,
        workspace_id, thread_ts, channel_id, agent_name, json.dumps(state_payload), hmac_sig
    )


# ── schedules ─────────────────────────────────────────────────────────────────

async def create_schedule(
    workspace_id: str, name: str, schedule_type: str,
    cron_expr: Optional[str], channel_id: Optional[str],
    payload: Dict[str, Any], created_by: Optional[str] = None
) -> str:
    sid = await execute_val(
        """
        INSERT INTO schedules (workspace_id, name, schedule_type, cron_expr, channel_id, payload, created_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
        RETURNING id
        """,
        workspace_id, name, schedule_type, cron_expr, channel_id, json.dumps(payload), created_by
    )
    return str(sid)


async def list_schedules(workspace_id: str) -> List[Dict[str, Any]]:
    rows = await execute_query(
        "SELECT * FROM schedules WHERE workspace_id = $1::uuid ORDER BY created_at DESC",
        workspace_id
    )
    return [dict(r) for r in rows]


async def update_schedule(schedule_id: str, updates: Dict[str, Any]) -> None:
    _ALLOWED = {"name", "schedule_type", "cron_expr", "channel_id", "payload", "is_active", "next_run_at"}
    set_clause, values = _build_set_clause(updates, _ALLOWED, start=2)
    await execute_statement(
        f"UPDATE schedules SET {set_clause} WHERE id = $1::uuid",
        schedule_id, *values
    )


async def delete_schedule(schedule_id: str) -> None:
    await execute_statement("DELETE FROM schedules WHERE id = $1::uuid", schedule_id)


# ── tasks ─────────────────────────────────────────────────────────────────────

async def create_task(
    workspace_id: str, title: str, description: Optional[str],
    status: str, priority: str, payload: Dict[str, Any],
    created_by: Optional[str] = None
) -> str:
    tid = await execute_val(
        """
        INSERT INTO tasks (workspace_id, title, description, status, priority, payload, created_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
        RETURNING id
        """,
        workspace_id, title, description, status, priority, json.dumps(payload), created_by
    )
    return str(tid)


async def list_tasks(workspace_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
    if status:
        rows = await execute_query(
            "SELECT * FROM tasks WHERE workspace_id = $1::uuid AND status = $2 ORDER BY created_at DESC",
            workspace_id, status
        )
    else:
        rows = await execute_query(
            "SELECT * FROM tasks WHERE workspace_id = $1::uuid ORDER BY created_at DESC",
            workspace_id
        )
    return [dict(r) for r in rows]


async def update_task(task_id: str, updates: Dict[str, Any]) -> None:
    _ALLOWED = {"title", "description", "status", "priority", "assignee_slack_id", "due_date", "payload"}
    set_clause, values = _build_set_clause(updates, _ALLOWED, start=2)
    await execute_statement(
        f"UPDATE tasks SET {set_clause}, updated_at = NOW() WHERE id = $1::uuid",
        task_id, *values
    )


async def delete_task(task_id: str) -> None:
    await execute_statement("DELETE FROM tasks WHERE id = $1::uuid", task_id)


# ── workflows ─────────────────────────────────────────────────────────────────

async def create_workflow(
    workspace_id: str, name: str, description: Optional[str],
    trigger_type: str, trigger_config: Dict[str, Any],
    steps: List[Dict[str, Any]], created_by: Optional[str] = None
) -> str:
    wid = await execute_val(
        """
        INSERT INTO workflows (workspace_id, name, description, trigger_type, trigger_config, steps, created_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
        RETURNING id
        """,
        workspace_id, name, description, trigger_type,
        json.dumps(trigger_config), json.dumps(steps), created_by
    )
    return str(wid)


async def list_workflows(workspace_id: str) -> List[Dict[str, Any]]:
    rows = await execute_query(
        "SELECT * FROM workflows WHERE workspace_id = $1::uuid ORDER BY created_at DESC",
        workspace_id
    )
    return [dict(r) for r in rows]


async def get_workflow_by_id(workflow_id: str) -> Optional[Dict[str, Any]]:
    row = await execute_one("SELECT * FROM workflows WHERE id = $1::uuid LIMIT 1", workflow_id)
    if row:
        record = dict(row)
        for col in ("trigger_config", "steps"):
            if isinstance(record.get(col), str):
                record[col] = json.loads(record[col])
        return record
    return None


async def update_workflow(workflow_id: str, updates: Dict[str, Any]) -> None:
    _ALLOWED = {"name", "description", "trigger_type", "trigger_config", "steps", "is_active"}
    set_clause, values = _build_set_clause(updates, _ALLOWED, start=2)
    await execute_statement(
        f"UPDATE workflows SET {set_clause}, updated_at = NOW() WHERE id = $1::uuid",
        workflow_id, *values
    )


async def delete_workflow(workflow_id: str) -> None:
    await execute_statement("DELETE FROM workflows WHERE id = $1::uuid", workflow_id)


# ── memory (pgvector) ─────────────────────────────────────────────────────────

async def add_memory(
    workspace_id: str, slack_user_id: Optional[str],
    content: str, embedding: List[float],
    memory_type: str = "observation",
    source_ts: Optional[str] = None,
    source_channel: Optional[str] = None
) -> None:
    await execute_statement(
        """
        INSERT INTO memory (workspace_id, slack_user_id, content, embedding, memory_type, source_ts, source_channel)
        VALUES ($1::uuid, $2, $3, $4::vector, $5, $6, $7)
        """,
        workspace_id, slack_user_id, content, str(embedding),
        memory_type, source_ts, source_channel
    )


async def search_memory(
    workspace_id: str, query_embedding: List[float],
    limit: int = 5, similarity_threshold: float = 0.7
) -> List[Dict[str, Any]]:
    rows = await execute_query(
        """
        SELECT id, slack_user_id, content, memory_type, source_ts, source_channel, created_at,
               1 - (embedding <=> $1::vector) AS similarity
        FROM   memory
        WHERE  workspace_id = $2::uuid
          AND  1 - (embedding <=> $1::vector) >= $3
        ORDER  BY similarity DESC
        LIMIT  $4
        """,
        str(query_embedding), workspace_id, similarity_threshold, limit
    )
    return [dict(r) for r in rows]


# ── knowledge (pgvector) ──────────────────────────────────────────────────────

async def add_knowledge(
    workspace_id: str, title: Optional[str],
    content: str, embedding: List[float],
    source_url: Optional[str] = None,
    source_type: str = "document",
    tags: Optional[List[str]] = None
) -> None:
    await execute_statement(
        """
        INSERT INTO knowledge (workspace_id, title, content, embedding, source_url, source_type, tags)
        VALUES ($1::uuid, $2, $3, $4::vector, $5, $6, $7)
        """,
        workspace_id, title, content, str(embedding), source_url, source_type, tags
    )


async def search_knowledge(
    workspace_id: str, query_embedding: List[float],
    limit: int = 5, similarity_threshold: float = 0.7
) -> List[Dict[str, Any]]:
    rows = await execute_query(
        """
        SELECT id, title, content, source_url, source_type, tags, created_at,
               1 - (embedding <=> $1::vector) AS similarity
        FROM   knowledge
        WHERE  workspace_id = $2::uuid
          AND  1 - (embedding <=> $1::vector) >= $3
        ORDER  BY similarity DESC
        LIMIT  $4
        """,
        str(query_embedding), workspace_id, similarity_threshold, limit
    )
    return [dict(r) for r in rows]


# ── skills ────────────────────────────────────────────────────────────────────

async def get_skill(workspace_id: str, slug: str) -> Optional[Dict[str, Any]]:
    row = await execute_one(
        "SELECT * FROM skills WHERE workspace_id = $1::uuid AND slug = $2 AND activation_status = 'active' LIMIT 1",
        workspace_id, slug
    )
    return dict(row) if row else None


async def seed_builtin_skills(workspace_id: str) -> None:
    """Seeds the 6 built-in KlawHub skills for a newly registered workspace."""
    BUILTIN_SKILLS = [
        {
            "name": "Document Master",
            "slug": "document_master",
            "description": "Professional document creation, parsing, and editing across all formats (PDF, Word, Excel, PPTX, Markdown).",
            "entry_file": "skill_document_master.py",
            "requirements": "weasyprint==62.3\npypandoc_binary==1.13\njinja2==3.1.4\npdfplumber==0.11.0\npypdf==4.3.1\npython-docx==1.1.2\nopenpyxl==3.1.5\nXlsxWriter==3.2.0\npython-pptx==1.0.2\nreportlab==4.2.0\npolars==0.20.31",
            "code": """def handler(workspace_id: str, inputs: dict) -> dict:
    # Dynamic document processing orchestrator
    import base64
    action = inputs.get("action")
    if action == "render_pdf":
        html = inputs.get("html", "")
        css = inputs.get("css", "")
        import modal
        f = modal.Function.lookup("klawhub-sandbox", "render_pdf")
        return {"pdf_b64": f.remote(html, css)}
    elif action == "convert":
        import modal
        f = modal.Function.lookup("klawhub-sandbox", "convert_text")
        res = f.remote(inputs.get("content", ""), inputs.get("from_format", "markdown"), inputs.get("to_format", "html"))
        return {"converted": res}
    return {"error": f"Unknown action: {action}"}
""",
            "documentation": """# Document Master

Professional document creation, parsing, and editing across all formats.

## Actions

### `render_pdf`
- Inputs: `html` (str), `css` (str)
- Outputs: `pdf_b64` (str)

### `convert`
- Inputs: `content` (str), `from_format` (str), `to_format` (str)
- Outputs: `converted` (str)
"""
        },
        {
            "name": "Data Science Lab",
            "slug": "data_science",
            "description": "End-to-end data analysis, visualization, and machine learning using Pandas, Polars, Numpy, Scikit-Learn.",
            "entry_file": "skill_data_science.py",
            "requirements": "pandas==2.2.2\npolars==0.20.31\nnumpy==1.26.4\nmatplotlib==3.9.0\nseaborn==0.13.2\nplotly==5.22.0\nscikit-learn==1.5.0\nstatsmodels==0.14.2\nscipy==1.13.1\nkaleido==0.2.1",
            "code": """def handler(workspace_id: str, inputs: dict) -> dict:
    import pandas as pd
    import numpy as np
    data = inputs.get("data", [])
    if not data:
        return {"error": "No data provided"}
    df = pd.DataFrame(data)
    desc = df.describe().to_dict()
    return {"description": desc}
""",
            "documentation": """# Data Science Lab

Data analysis and exploratory statistics.

## Inputs
- `data`: List of dicts representing dataset rows

## Outputs
- `description`: Descriptive stats summary
"""
        },
        {
            "name": "Financial Modeler",
            "slug": "financial_modeler",
            "description": "Professional financial analysis, market intelligence, valuation, and scenario modeling.",
            "entry_file": "skill_financial_modeler.py",
            "requirements": "yfinance==0.2.40\npandas-ta==0.3.14b0\nFinanceToolkit==1.6.4\npandas==2.2.2\nnumpy==1.26.4\nplotly==5.22.0\nscipy==1.13.1\nopenpyxl==3.1.5\nXlsxWriter==3.2.0\nweasyprint==62.3\njinja2==3.1.4",
            "code": """def handler(workspace_id: str, inputs: dict) -> dict:
    import yfinance as yf
    ticker = inputs.get("ticker", "AAPL")
    t = yf.Ticker(ticker)
    info = t.info
    metrics = {
        "price": info.get("currentPrice"),
        "pe": info.get("trailingPE"),
        "market_cap": info.get("marketCap"),
        "recommendation": info.get("recommendationKey")
    }
    return {"ticker": ticker, "metrics": metrics}
""",
            "documentation": """# Financial Modeler

Market intelligence and stock fundamental metrics retrieval.

## Inputs
- `ticker`: Stock ticker symbol (default: 'AAPL')

## Outputs
- `ticker`: Symbol
- `metrics`: Dict of financial ratios and valuation pricing
"""
        },
        {
            "name": "FullStack Engineer",
            "slug": "fullstack_engineer",
            "description": "Complete software development helper — scaffolding, linting, formatting, debugging, and testing.",
            "entry_file": "skill_fullstack_engineer.py",
            "requirements": "black==24.4.2\npylint==3.2.2\npytest==8.2.2\nhttpx==0.27.0\ngitpython==3.1.43\ncookiecutter==2.6.0\njinja2==3.1.4\npypandoc_binary==1.13",
            "code": """def handler(workspace_id: str, inputs: dict) -> dict:
    import modal
    action = inputs.get("action")
    if action == "run_command":
        cmd = inputs.get("command")
        args = inputs.get("args", [])
        f = modal.Function.lookup("klawhub-sandbox", "run_shell_command")
        return f.remote(cmd, args)
    return {"error": f"Unknown action: {action}"}
""",
            "documentation": """# FullStack Engineer

Linting, testing, and formatting manager.

## Actions

### `run_command`
- Inputs: `command` (str), `args` (list)
- Outputs: Subprocess output dictionary
"""
        },
        {
            "name": "Research Synthesizer",
            "slug": "research_synthesizer",
            "description": "Deep multi-step web research, fact-checking, literature review, and source ranking.",
            "entry_file": "skill_research_synthesizer.py",
            "requirements": "tavily-python==0.3.8\nmarkitdown==0.1.0\nweasyprint==62.3\njinja2==3.1.4\nreportlab==4.2.0",
            "code": """def handler(workspace_id: str, inputs: dict) -> dict:
    import modal
    query = inputs.get("query")
    f = modal.Function.lookup("klawhub-sandbox", "run_browser_task")
    res = f.remote("document.body.innerText", f"https://www.google.com/search?q={query}")
    return {"research_output": res[:5000]}
""",
            "documentation": """# Research Synthesizer

Multi-step search and literature synthesizer.

## Inputs
- `query`: Research query string

## Outputs
- `research_output`: Cleaned webpage text summary
"""
        },
        {
            "name": "Scheduler & Automation Engine",
            "slug": "automation_engine",
            "description": "Orchestrates multi-step workspaces schedules, tasks, and event-driven automation rules.",
            "entry_file": "skill_automation_engine.py",
            "requirements": "croniter==2.0.5\npydantic==2.7.1",
            "code": """def handler(workspace_id: str, inputs: dict) -> dict:
    action = inputs.get("action")
    return {"status": "success", "action": action}
""",
            "documentation": """# Scheduler & Automation Engine

Automation runner.

## Inputs
- `action`: Name of schedule action to trigger

## Outputs
- `status`: Execution status
"""
        }
    ]

    for s in BUILTIN_SKILLS:
        await execute_statement(
            """
            INSERT INTO skills
              (workspace_id, name, slug, description, skill_type, entry_file, code,
               requirements, documentation, supporting_files, version, created_by, activation_status)
            VALUES ($1::uuid, $2, $3, $4, 'builtin', $5, $6, $7, $8, '', '1.0.0', 'system', 'active')
            ON CONFLICT (workspace_id, slug, version) DO NOTHING
            """,
            workspace_id, s["name"], s["slug"], s["description"],
            s["entry_file"], s["code"], s["requirements"], s["documentation"]
        )


# ── pending_actions ───────────────────────────────────────────────────────────

async def create_pending_action(
    workspace_id: str, action_type: str, title: str,
    payload: Dict[str, Any], description: Optional[str] = None,
    requested_by: Optional[str] = None,
) -> str:
    pid = await execute_val(
        """
        INSERT INTO pending_actions (workspace_id, action_type, title, description, payload, requested_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6)
        RETURNING id
        """,
        workspace_id, action_type, title, description, json.dumps(payload), requested_by
    )
    return str(pid)


async def resolve_pending_action(action_id: str, resolution: str, reviewed_by: Optional[str] = None) -> None:
    await execute_statement(
        "UPDATE pending_actions SET status = $2, reviewed_by = $3, updated_at = NOW() WHERE id = $1::uuid",
        action_id, resolution, reviewed_by
    )


# ── usage_logs ────────────────────────────────────────────────────────────────

async def log_usage(
    workspace_id: str, slack_user_id: Optional[str],
    agent_name: Optional[str], skill_used: Optional[str],
    sandbox_function: Optional[str], prompt_tokens: int,
    completion_tokens: int, latency_ms: int, status: str
) -> None:
    total_tokens = prompt_tokens + completion_tokens
    await execute_statement(
        """
        INSERT INTO usage_logs
          (workspace_id, slack_user_id, agent_name, skill_used, sandbox_function,
           prompt_tokens, completion_tokens, total_tokens, latency_ms, status)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """,
        workspace_id, slack_user_id, agent_name, skill_used, sandbox_function,
        prompt_tokens, completion_tokens, total_tokens, latency_ms, status
    )


# ── workflow_learnings (Removed to prevent DB bloat) ──────────────────────────


# ── Private helpers ───────────────────────────────────────────────────────────

def _build_set_clause(
    updates: Dict[str, Any],
    allowed_cols: set,
    start: int = 2
) -> tuple:
    """
    Builds a safe parameterized SET clause from an updates dict.
    Only columns in `allowed_cols` are permitted — this prevents
    column-name injection attacks.
    """
    set_parts = []
    values = []
    idx = start
    for col, val in updates.items():
        if col not in allowed_cols:
            # Silently skip unknown/disallowed columns
            continue
        if isinstance(val, (dict, list)):
            val = json.dumps(val)
        set_parts.append(f"{col} = ${idx}")
        values.append(val)
        idx += 1

    if not set_parts:
        raise ValueError("No valid update fields provided.")

    return ", ".join(set_parts), values
