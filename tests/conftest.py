import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import inngest
if not hasattr(inngest.Function, "__call__"):
    inngest.Function.__call__ = lambda self, *args, **kwargs: self._handler(*args, **kwargs)

# Patch Inngest.create_function to handle concurrency/retries signature differences
_orig_create_function = inngest.Inngest.create_function
def _patched_create_function(self, *args, **kwargs):
    if "concurrency" in kwargs and isinstance(kwargs["concurrency"], int):
        try:
            kwargs["concurrency"] = [inngest.Concurrency(limit=kwargs["concurrency"])]
        except Exception:
            del kwargs["concurrency"]
    return _orig_create_function(self, *args, **kwargs)
inngest.Inngest.create_function = _patched_create_function

import uuid
import json
import re
import jwt
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, Request, Response, HTTPException, Body
from fastapi.responses import RedirectResponse
import pytest
from unittest.mock import patch

# Set mock environment variables before any other imports
os.environ["ENCRYPTION_KEY"] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
os.environ["HMAC_SECRET"] = "mock-hmac-secret-key-12345"
os.environ["DATABASE_URL"] = "postgresql://postgres:postgres@localhost:5432/postgres"
os.environ["SUPABASE_URL"] = "https://mock.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-service-role-key"
os.environ["SUPABASE_ANON_KEY"] = "mock-anon-key"
os.environ["NEXT_PUBLIC_APP_URL"] = "http://localhost:3000"
os.environ["INNGEST_SIGNING_KEY"] = "signkey-mock-key-12345"
os.environ["INNGEST_EVENT_KEY"] = "mock-event-key"
os.environ["ENVIRONMENT"] = "development"


# In-Memory DB State representing Supabase tables
MOCK_DB = {
    "workspaces": [],
    "workspace_members": [],
    "integrations": [],
    "schedules": [],
    "tasks": [],
    "workflows": [],
    "memory": [],
    "knowledge": [],
    "skills": [],
    "pending_actions": [],
    "usage_logs": [],
    "processed_events": [],
}

def clean_val(val):
    if isinstance(val, str) and (val.startswith("{") or val.startswith("[")):
        try:
            return json.loads(val)
        except Exception:
            pass
    return val

# Mock SQL Executor
def mock_execute_sql(query: str, *args, return_type: str = "status"):
    query_clean = " ".join(query.split()).strip()
    
    # 1. SELECT from processed_events
    if "SELECT 1 FROM processed_events" in query_clean:
        event_id = args[0]
        found = any(x["event_id"] == event_id for x in MOCK_DB["processed_events"])
        if found:
            return [{"1": 1}] if return_type == "query" else {"1": 1}
        return [] if return_type == "query" else None

    # 2. INSERT into processed_events
    elif "INSERT INTO processed_events" in query_clean:
        event_id = args[0]
        workspace_id = args[1] if len(args) > 1 else None
        if not any(x["event_id"] == event_id for x in MOCK_DB["processed_events"]):
            MOCK_DB["processed_events"].append({"event_id": event_id, "workspace_id": workspace_id})
        return "INSERT 0 1"

    # 3. SELECT workspaces by slack_team_id
    elif "SELECT * FROM workspaces WHERE slack_team_id = $1" in query_clean:
        team_id = args[0]
        res = [w for w in MOCK_DB["workspaces"] if w["slack_team_id"] == team_id]
        if res:
            return res if return_type == "query" else res[0]
        return [] if return_type == "query" else None

    # 4. SELECT workspaces by id
    elif "SELECT * FROM workspaces WHERE id = $1::uuid" in query_clean:
        ws_id = args[0]
        res = [w for w in MOCK_DB["workspaces"] if str(w["id"]) == str(ws_id)]
        if res:
            return res if return_type == "query" else res[0]
        return [] if return_type == "query" else None

    # 5. INSERT INTO workspaces
    elif "INSERT INTO workspaces" in query_clean:
        slack_team_id = args[0]
        slack_team_name = args[1]
        bot_token = args[2]
        bot_user_id = args[3]
        
        # Check if already exists
        existing = None
        for w in MOCK_DB["workspaces"]:
            if w["slack_team_id"] == slack_team_id:
                existing = w
                break
        if existing:
            existing["bot_token"] = bot_token
            existing["slack_team_name"] = slack_team_name
            existing_settings = existing.get("settings") or {}
            if isinstance(existing_settings, str):
                existing_settings = json.loads(existing_settings)
            existing_settings["bot_user_id"] = bot_user_id
            existing["settings"] = existing_settings
            existing["last_active_at"] = datetime.now()
            return existing["id"] if return_type == "val" else [existing]
        else:
            new_id = str(uuid.uuid4())
            new_ws = {
                "id": new_id,
                "slack_team_id": slack_team_id,
                "slack_team_name": slack_team_name,
                "bot_token": bot_token,
                "settings": {"bot_user_id": bot_user_id},
                "persona_name": "Klaw",
                "persona_prompt": "You are KlawHub...",
                "whitelisted_channels": [],
                "active_skills": [],
                "plan": "free",
                "monthly_run_limit": 100,
                "last_active_at": datetime.now()
            }
            MOCK_DB["workspaces"].append(new_ws)
            return new_id if return_type == "val" else [new_ws]

    # 6. UPDATE workspaces
    elif "UPDATE workspaces SET" in query_clean:
        ws_id = args[0]
        cols_match = re.findall(r"(\w+)\s*=\s*\$\d+", query_clean)
        ws = None
        for w in MOCK_DB["workspaces"]:
            if str(w["id"]) == str(ws_id):
                ws = w
                break
        if ws:
            for idx, col in enumerate(cols_match):
                ws[col] = clean_val(args[idx + 1])
            ws["last_active_at"] = datetime.now()
        return "UPDATE 1"

    # 7. SELECT workspace_members
    elif "SELECT * FROM workspace_members" in query_clean:
        ws_id = args[0]
        slack_user_id = args[1]
        res = [m for m in MOCK_DB["workspace_members"] if str(m["workspace_id"]) == str(ws_id) and m["slack_user_id"] == slack_user_id]
        if res:
            return res if return_type == "query" else res[0]
        return [] if return_type == "query" else None

    # 8. INSERT INTO workspace_members
    elif "INSERT INTO workspace_members" in query_clean:
        ws_id = args[0]
        slack_user_id = args[1]
        slack_username = args[2]
        role = args[3]
        email = args[4]
        existing = None
        for m in MOCK_DB["workspace_members"]:
            if str(m["workspace_id"]) == str(ws_id) and m["slack_user_id"] == slack_user_id:
                existing = m
                break
        if existing:
            existing["slack_username"] = slack_username
            existing["role"] = role
            existing["email"] = email
            existing["last_active_at"] = datetime.now()
        else:
            MOCK_DB["workspace_members"].append({
                "workspace_id": ws_id,
                "slack_user_id": slack_user_id,
                "slack_username": slack_username,
                "role": role,
                "email": email,
                "last_active_at": datetime.now()
            })
        return "INSERT 0 1"

    # 9. SELECT agent_states
    elif "SELECT * FROM agent_states" in query_clean:
        ws_id = args[0]
        thread_ts = args[1]
        agent_name = args[2]
        res = [s for s in MOCK_DB["agent_states"] if str(s["workspace_id"]) == str(ws_id) and s["thread_ts"] == thread_ts and s["agent_name"] == agent_name]
        if res:
            return res if return_type == "query" else res[0]
        return [] if return_type == "query" else None

    # 10. INSERT INTO agent_states
    elif "INSERT INTO agent_states" in query_clean:
        ws_id = args[0]
        thread_ts = args[1]
        channel_id = args[2]
        agent_name = args[3]
        state_payload = args[4]
        hmac_sig = args[5]
        existing = None
        for s in MOCK_DB["agent_states"]:
            if str(s["workspace_id"]) == str(ws_id) and s["thread_ts"] == thread_ts and s["agent_name"] == agent_name:
                existing = s
                break
        if existing:
            existing["channel_id"] = channel_id
            existing["state_payload"] = clean_val(state_payload)
            existing["hmac_sig"] = hmac_sig
            existing["updated_at"] = datetime.now()
        else:
            MOCK_DB["agent_states"].append({
                "workspace_id": ws_id,
                "thread_ts": thread_ts,
                "channel_id": channel_id,
                "agent_name": agent_name,
                "state_payload": clean_val(state_payload),
                "hmac_sig": hmac_sig,
                "updated_at": datetime.now()
            })
        return "INSERT 0 1"

    # 11. INSERT INTO schedules
    elif "INSERT INTO schedules" in query_clean:
        ws_id = args[0]
        name = args[1]
        schedule_type = args[2]
        cron_expr = args[3]
        channel_id = args[4]
        payload = args[5]
        created_by = args[6]
        new_id = str(uuid.uuid4())
        MOCK_DB["schedules"].append({
            "id": new_id,
            "workspace_id": ws_id,
            "name": name,
            "schedule_type": schedule_type,
            "cron_expr": cron_expr,
            "channel_id": channel_id,
            "payload": clean_val(payload),
            "created_by": created_by,
            "is_active": True,
            "next_run_at": None,
            "created_at": datetime.now()
        })
        return new_id if return_type == "val" else new_id

    # 12. SELECT schedules
    elif "SELECT * FROM schedules" in query_clean:
        ws_id = args[0]
        res = [s for s in MOCK_DB["schedules"] if str(s["workspace_id"]) == str(ws_id)]
        res.sort(key=lambda x: x["created_at"], reverse=True)
        return res

    # 13. UPDATE schedules
    elif "UPDATE schedules SET" in query_clean:
        sch_id = args[0]
        cols_match = re.findall(r"(\w+)\s*=\s*\$\d+", query_clean)
        sch = None
        for s in MOCK_DB["schedules"]:
            if str(s["id"]) == str(sch_id):
                sch = s
                break
        if sch:
            for idx, col in enumerate(cols_match):
                sch[col] = clean_val(args[idx + 1])
        return "UPDATE 1"

    # 14. DELETE FROM schedules
    elif "DELETE FROM schedules" in query_clean:
        sch_id = args[0]
        MOCK_DB["schedules"] = [s for s in MOCK_DB["schedules"] if str(s["id"]) != str(sch_id)]
        return "DELETE 1"

    # 15. INSERT INTO tasks
    elif "INSERT INTO tasks" in query_clean:
        ws_id = args[0]
        title = args[1]
        description = args[2]
        status = args[3]
        priority = args[4]
        payload = args[5]
        created_by = args[6]
        new_id = str(uuid.uuid4())
        MOCK_DB["tasks"].append({
            "id": new_id,
            "workspace_id": ws_id,
            "title": title,
            "description": description,
            "status": status,
            "priority": priority,
            "payload": clean_val(payload),
            "created_by": created_by,
            "assignee_slack_id": None,
            "due_date": None,
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        })
        return new_id if return_type == "val" else new_id

    # 16. SELECT tasks
    elif "SELECT * FROM tasks" in query_clean:
        ws_id = args[0]
        status = args[1] if len(args) > 1 else None
        if status:
            res = [t for t in MOCK_DB["tasks"] if str(t["workspace_id"]) == str(ws_id) and t["status"] == status]
        else:
            res = [t for t in MOCK_DB["tasks"] if str(t["workspace_id"]) == str(ws_id)]
        res.sort(key=lambda x: x["created_at"], reverse=True)
        return res

    # 17. UPDATE tasks
    elif "UPDATE tasks SET" in query_clean:
        task_id = args[0]
        cols_match = re.findall(r"(\w+)\s*=\s*\$\d+", query_clean)
        tk = None
        for t in MOCK_DB["tasks"]:
            if str(t["id"]) == str(task_id):
                tk = t
                break
        if tk:
            for idx, col in enumerate(cols_match):
                tk[col] = clean_val(args[idx + 1])
            tk["updated_at"] = datetime.now()
        return "UPDATE 1"

    # 18. DELETE FROM tasks
    elif "DELETE FROM tasks" in query_clean:
        task_id = args[0]
        MOCK_DB["tasks"] = [t for t in MOCK_DB["tasks"] if str(t["id"]) != str(task_id)]
        return "DELETE 1"

    # 19. INSERT INTO workflows
    elif "INSERT INTO workflows" in query_clean:
        ws_id = args[0]
        name = args[1]
        description = args[2]
        trigger_type = args[3]
        trigger_config = args[4]
        steps = args[5]
        created_by = args[6]
        new_id = str(uuid.uuid4())
        MOCK_DB["workflows"].append({
            "id": new_id,
            "workspace_id": ws_id,
            "name": name,
            "description": description,
            "trigger_type": trigger_type,
            "trigger_config": clean_val(trigger_config),
            "steps": clean_val(steps),
            "created_by": created_by,
            "is_active": True,
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        })
        return new_id if return_type == "val" else new_id

    # 20. SELECT workflows
    elif "SELECT * FROM workflows" in query_clean:
        if "WHERE id = $1::uuid" in query_clean:
            wf_id = args[0]
            res = [w for w in MOCK_DB["workflows"] if str(w["id"]) == str(wf_id)]
            if res:
                return res if return_type == "query" else res[0]
            return [] if return_type == "query" else None
        else:
            ws_id = args[0]
            res = [w for w in MOCK_DB["workflows"] if str(w["workspace_id"]) == str(ws_id)]
            res.sort(key=lambda x: x["created_at"], reverse=True)
            return res

    # 21. UPDATE workflows
    elif "UPDATE workflows SET" in query_clean:
        wf_id = args[0]
        cols_match = re.findall(r"(\w+)\s*=\s*\$\d+", query_clean)
        wf = None
        for w in MOCK_DB["workflows"]:
            if str(w["id"]) == str(wf_id):
                wf = w
                break
        if wf:
            for idx, col in enumerate(cols_match):
                wf[col] = clean_val(args[idx + 1])
            wf["updated_at"] = datetime.now()
        return "UPDATE 1"

    # 22. DELETE FROM workflows
    elif "DELETE FROM workflows" in query_clean:
        wf_id = args[0]
        MOCK_DB["workflows"] = [w for w in MOCK_DB["workflows"] if str(w["id"]) != str(wf_id)]
        return "DELETE 1"

    # 23. INSERT INTO memory
    elif "INSERT INTO memory" in query_clean:
        ws_id = args[0]
        slack_user_id = args[1]
        content = args[2]
        embedding = args[3]
        memory_type = args[4]
        source_ts = args[5]
        source_channel = args[6]
        MOCK_DB["memory"].append({
            "id": str(uuid.uuid4()),
            "workspace_id": ws_id,
            "slack_user_id": slack_user_id,
            "content": content,
            "embedding": embedding,
            "memory_type": memory_type,
            "source_ts": source_ts,
            "source_channel": source_channel,
            "created_at": datetime.now()
        })
        return "INSERT 0 1"

    # 24. SELECT / SEARCH memory
    elif "FROM memory" in query_clean:
        ws_id = args[1]
        res = [m for m in MOCK_DB["memory"] if str(m["workspace_id"]) == str(ws_id)]
        for r in res:
            r["similarity"] = 0.95
        limit = args[3] if len(args) > 3 else len(res)
        return res[:limit]

    # 25. INSERT INTO knowledge
    elif "INSERT INTO knowledge" in query_clean:
        ws_id = args[0]
        title = args[1]
        content = args[2]
        embedding = args[3]
        source_url = args[4]
        source_type = args[5]
        tags = args[6]
        MOCK_DB["knowledge"].append({
            "id": str(uuid.uuid4()),
            "workspace_id": ws_id,
            "title": title,
            "content": content,
            "embedding": embedding,
            "source_url": source_url,
            "source_type": source_type,
            "tags": tags,
            "created_at": datetime.now()
        })
        return "INSERT 0 1"

    # 26. SELECT / SEARCH knowledge
    elif "FROM knowledge" in query_clean:
        ws_id = args[1]
        res = [k for k in MOCK_DB["knowledge"] if str(k["workspace_id"]) == str(ws_id)]
        for r in res:
            r["similarity"] = 0.95
        limit = args[3] if len(args) > 3 else len(res)
        return res[:limit]

    # 27. SELECT skills
    elif "SELECT * FROM skills" in query_clean:
        ws_id = args[0]
        slug = args[1]
        res = [s for s in MOCK_DB["skills"] if str(s["workspace_id"]) == str(ws_id) and s["slug"] == slug]
        if res:
            return res if return_type == "query" else res[0]
        return [] if return_type == "query" else None

    # 28. INSERT INTO skills
    elif "INSERT INTO skills" in query_clean:
        ws_id = args[0]
        name = args[1]
        slug = args[2]
        description = args[3]
        entry_file = args[4]
        code = args[5]
        requirements = args[6]
        documentation = args[7]
        
        existing = None
        for s in MOCK_DB["skills"]:
            if str(s["workspace_id"]) == str(ws_id) and s["slug"] == slug:
                existing = s
                break
        if existing:
            existing["name"] = name
            existing["code"] = code
            existing["requirements"] = requirements
            existing["documentation"] = documentation
            existing["updated_at"] = datetime.now()
        else:
            MOCK_DB["skills"].append({
                "workspace_id": ws_id,
                "name": name,
                "slug": slug,
                "description": description,
                "entry_file": entry_file,
                "code": code,
                "requirements": requirements,
                "documentation": documentation,
                "activation_status": "active" if len(args) == 8 else "pending_approval",
                "created_at": datetime.now(),
                "updated_at": datetime.now()
            })
        return "INSERT 0 1"

    # 29. INSERT INTO pending_actions
    elif "INSERT INTO pending_actions" in query_clean:
        ws_id = args[0]
        action_type = args[1]
        title = args[2]
        description = args[3]
        payload = args[4]
        requested_by = args[5]
        new_id = str(uuid.uuid4())
        MOCK_DB["pending_actions"].append({
            "id": new_id,
            "workspace_id": ws_id,
            "action_type": action_type,
            "title": title,
            "description": description,
            "payload": clean_val(payload),
            "requested_by": requested_by,
            "status": "pending",
            "reviewed_by": None,
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        })
        return new_id if return_type == "val" else new_id

    # 30. UPDATE pending_actions
    elif "UPDATE pending_actions SET" in query_clean:
        action_id = args[0]
        status = args[1]
        reviewed_by = args[2]
        for a in MOCK_DB["pending_actions"]:
            if str(a["id"]) == str(action_id):
                a["status"] = status
                a["reviewed_by"] = reviewed_by
                a["updated_at"] = datetime.now()
                break
        return "UPDATE 1"

    # 31. INSERT INTO usage_logs
    elif "INSERT INTO usage_logs" in query_clean:
        ws_id = args[0]
        slack_user_id = args[1]
        agent_name = args[2]
        skill_used = args[3]
        sandbox_function = args[4]
        prompt_tokens = args[5]
        completion_tokens = args[6]
        total_tokens = args[7]
        latency_ms = args[8]
        status = args[9]
        MOCK_DB["usage_logs"].append({
            "workspace_id": ws_id,
            "slack_user_id": slack_user_id,
            "agent_name": agent_name,
            "skill_used": skill_used,
            "sandbox_function": sandbox_function,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "latency_ms": latency_ms,
            "status": status,
            "created_at": datetime.now()
        })
        return "INSERT 0 1"

    # 32. SELECT integrations
    elif "SELECT * FROM integrations" in query_clean:
        ws_id = args[0]
        provider = "google" if "google" in query_clean else "github"
        res = [i for i in MOCK_DB["integrations"] if str(i["workspace_id"]) == str(ws_id) and i["provider"] == provider]
        if res:
            return res if return_type == "query" else res[0]
        return [] if return_type == "query" else None

    # 33. INSERT INTO integrations
    elif "INSERT INTO integrations" in query_clean:
        cols_match = re.search(r"INSERT\s+INTO\s+integrations\s*\((.*?)\)\s*VALUES\s*\((.*?)\)", query_clean, re.IGNORECASE)
        if cols_match:
            cols = [c.strip() for c in cols_match.group(1).split(",")]
            vals_raw = [v.strip() for v in cols_match.group(2).split(",")]
            row = {}
            arg_idx = 0
            for col, val_raw in zip(cols, vals_raw):
                if "$" in val_raw:
                    row[col] = args[arg_idx]
                    arg_idx += 1
                else:
                    row[col] = val_raw.strip("'").strip('"')
            
            ws_id = row.get("workspace_id")
            provider = row.get("provider")
            existing = None
            for i in MOCK_DB["integrations"]:
                if str(i["workspace_id"]) == str(ws_id) and i["provider"] == provider:
                    existing = i
                    break
            if existing:
                existing["access_token"] = row.get("access_token")
                if "metadata" in row:
                    existing["metadata"] = clean_val(row["metadata"])
            else:
                MOCK_DB["integrations"].append({
                    "workspace_id": ws_id,
                    "provider": provider,
                    "access_token": row.get("access_token"),
                    "metadata": clean_val(row["metadata"]) if "metadata" in row else None,
                    "created_at": datetime.now()
                })
        return "INSERT 0 1"

    # 34. DELETE FROM integrations
    elif "DELETE FROM integrations" in query_clean:
        ws_id = args[0]
        provider = args[1] if len(args) > 1 else ("google" if "google" in query_clean else "github")
        MOCK_DB["integrations"] = [i for i in MOCK_DB["integrations"] if not (str(i["workspace_id"]) == str(ws_id) and i["provider"] == provider)]
        return "DELETE 1"

    print(f"UNHANDLED MOCK QUERY: {query_clean} with args {args}")
    if return_type == "query":
        return []
    elif return_type == "one":
        return None
    elif return_type == "val":
        return None
    return "SUCCESS"

# Low-level execution wrappers
async def mock_execute_query(query: str, *args) -> List[Any]:
    return mock_execute_sql(query, *args, return_type="query")

async def mock_execute_one(query: str, *args) -> Optional[Any]:
    return mock_execute_sql(query, *args, return_type="one")

async def mock_execute_statement(query: str, *args) -> str:
    return mock_execute_sql(query, *args, return_type="status")

async def mock_execute_val(query: str, *args) -> Any:
    return mock_execute_sql(query, *args, return_type="val")

async def mock_init_db_pool() -> Any:
    class MockPool:
        async def close(self):
            pass
    pool = MockPool()
    import src.db.client
    src.db.client._pool = pool
    return pool

async def mock_close_db_pool() -> None:
    import src.db.client
    src.db.client._pool = None

async def mock_ensure_pool() -> Any:
    import src.db.client
    if src.db.client._pool is None:
        await mock_init_db_pool()
    return src.db.client._pool

# Register patches session-wide
p1 = patch("src.db.operations.execute_query", side_effect=mock_execute_query)
p2 = patch("src.db.operations.execute_one", side_effect=mock_execute_one)
p3 = patch("src.db.operations.execute_statement", side_effect=mock_execute_statement)
p4 = patch("src.db.operations.execute_val", side_effect=mock_execute_val)
p5 = patch("src.db.client.init_db_pool", side_effect=mock_init_db_pool)
p6 = patch("src.db.client.close_db_pool", side_effect=mock_close_db_pool)
p7 = patch("src.db.client.ensure_pool", side_effect=mock_ensure_pool)

p1.start()
p2.start()
p3.start()
p4.start()
p5.start()
p6.start()
p7.start()

# Load FastAPI app to mount custom test routes
from api.inngest_handler import app
from src.config import settings
from src.core.security.encryptor import encryptor

# --- F2 Routes ---
@app.get("/api/oauth/slack")
def oauth_slack():
    client_id = settings.SLACK_CLIENT_ID or "mock-slack-client-id"
    redirect_uri = f"{settings.NEXT_PUBLIC_APP_URL}/api/oauth/callback"
    return RedirectResponse(
        url=f"https://slack.com/oauth/v2/authorize?client_id={client_id}&redirect_uri={redirect_uri}&scope=commands,chat:write"
    )

@app.get("/api/oauth/callback")
async def oauth_callback(code: str = None, error: str = None):
    if error:
        return RedirectResponse(url=f"{settings.NEXT_PUBLIC_APP_URL}/?install=denied&reason={error}")
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")
    
    team_id = f"T_{code.upper()}"
    team_name = f"Mock Team {code}"
    
    # Encrypt bot token
    bot_token = "xoxb-mock-bot-token"
    encrypted_token = encryptor.encrypt(bot_token)
    
    # Create workspace in mock database
    from src.db.operations import create_workspace
    ws_id = await create_workspace(
        slack_team_id=team_id,
        slack_team_name=team_name,
        bot_token=encrypted_token,
        bot_user_id="U_MOCK_BOT"
    )
    
    # Create session cookie JWT
    payload = {
        "sub": "user-123",
        "workspace_id": ws_id,
        "slack_team_id": team_id,
        "role": "admin"
    }
    jwt_token = jwt.encode(payload, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithm="HS256")
    
    response = RedirectResponse(url=f"{settings.NEXT_PUBLIC_APP_URL}/dashboard?install=success&team={team_name}")
    response.set_cookie(key="session", value=jwt_token, httponly=True)
    return response

# --- F3 Routes ---
@app.get("/api/oauth/google")
async def oauth_google(workspace_id: str):
    client_id = settings.GOOGLE_CLIENT_ID or "mock-google-client-id"
    redirect_uri = f"{settings.NEXT_PUBLIC_APP_URL}/api/oauth/google/callback"
    scopes = [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/gmail.readonly"
    ]
    scopes_str = "%20".join(scopes)
    return RedirectResponse(
        url=f"https://accounts.google.com/o/oauth2/v2/auth?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code&scope={scopes_str}&state={workspace_id}"
    )

@app.get("/api/oauth/google/callback")
async def oauth_google_callback(code: str, state: str):
    workspace_id = state
    google_token = "mock-google-access-token"
    encrypted_token = encryptor.encrypt(google_token)
    
    from src.db.operations import execute_statement
    await execute_statement(
        """
        INSERT INTO integrations (workspace_id, provider, access_token, metadata)
        VALUES ($1::uuid, 'google', $2, $3)
        """,
        workspace_id, encrypted_token, json.dumps({"email": "developer@organization.org"})
    )
    
    return RedirectResponse(url=f"{settings.NEXT_PUBLIC_APP_URL}/dashboard/settings?google=connected")

# --- F4 Routes ---
@app.get("/api/oauth/github")
async def oauth_github(workspace_id: str):
    client_id = settings.GITHUB_APP_CLIENT_ID or "mock-github-client-id"
    redirect_uri = f"{settings.NEXT_PUBLIC_APP_URL}/api/oauth/github/callback"
    return RedirectResponse(
        url=f"https://github.com/login/oauth/authorize?client_id={client_id}&redirect_uri={redirect_uri}&state={workspace_id}"
    )

@app.get("/api/oauth/github/callback")
async def oauth_github_callback(code: str, state: str):
    workspace_id = state
    github_token = "mock-github-access-token"
    encrypted_token = encryptor.encrypt(github_token)
    
    from src.db.operations import execute_statement
    await execute_statement(
        """
        INSERT INTO integrations (workspace_id, provider, access_token, metadata)
        VALUES ($1::uuid, 'github', $2, $3)
        """,
        workspace_id, encrypted_token, json.dumps({"email": "git-dev@organization.org"})
    )
    
    return RedirectResponse(url=f"{settings.NEXT_PUBLIC_APP_URL}/dashboard/settings?github=connected")

# --- F5 Dashboard CRUD Routes ---
# Schedules CRUD
@app.get("/api/dashboard/schedules")
async def api_list_schedules(workspace_id: str):
    from src.db.operations import list_schedules
    return await list_schedules(workspace_id)

@app.post("/api/dashboard/schedules")
async def api_create_schedule(workspace_id: str, payload: dict = Body(...)):
    from src.db.operations import create_schedule
    sid = await create_schedule(
        workspace_id,
        payload.get("name"),
        payload.get("schedule_type"),
        payload.get("cron_expr"),
        payload.get("channel_id"),
        payload.get("payload", {}),
        payload.get("created_by")
    )
    return {"id": sid}

@app.put("/api/dashboard/schedules/{schedule_id}")
async def api_update_schedule(schedule_id: str, updates: dict = Body(...)):
    from src.db.operations import update_schedule
    await update_schedule(schedule_id, updates)
    return {"status": "success"}

@app.delete("/api/dashboard/schedules/{schedule_id}")
async def api_delete_schedule(schedule_id: str):
    from src.db.operations import delete_schedule
    await delete_schedule(schedule_id)
    return {"status": "success"}

# Tasks CRUD
@app.get("/api/dashboard/tasks")
async def api_list_tasks(workspace_id: str, status: str = None):
    from src.db.operations import list_tasks
    return await list_tasks(workspace_id, status)

@app.post("/api/dashboard/tasks")
async def api_create_task(workspace_id: str, payload: dict = Body(...)):
    from src.db.operations import create_task
    tid = await create_task(
        workspace_id,
        payload.get("title"),
        payload.get("description"),
        payload.get("status"),
        payload.get("priority"),
        payload.get("payload", {}),
        payload.get("created_by")
    )
    return {"id": tid}

@app.put("/api/dashboard/tasks/{task_id}")
async def api_update_task(task_id: str, updates: dict = Body(...)):
    from src.db.operations import update_task
    await update_task(task_id, updates)
    return {"status": "success"}

@app.delete("/api/dashboard/tasks/{task_id}")
async def api_delete_task(task_id: str):
    from src.db.operations import delete_task
    await delete_task(task_id)
    return {"status": "success"}

# Workflows CRUD
@app.get("/api/dashboard/workflows")
async def api_list_workflows(workspace_id: str):
    from src.db.operations import list_workflows
    return await list_workflows(workspace_id)

@app.post("/api/dashboard/workflows")
async def api_create_workflow(workspace_id: str, payload: dict = Body(...)):
    from src.db.operations import create_workflow
    wid = await create_workflow(
        workspace_id,
        payload.get("name"),
        payload.get("description"),
        payload.get("trigger_type"),
        payload.get("trigger_config", {}),
        payload.get("steps", []),
        payload.get("created_by")
    )
    return {"id": wid}

@app.put("/api/dashboard/workflows/{workflow_id}")
async def api_update_workflow(workflow_id: str, updates: dict = Body(...)):
    from src.db.operations import update_workflow
    await update_workflow(workflow_id, updates)
    return {"status": "success"}

@app.delete("/api/dashboard/workflows/{workflow_id}")
async def api_delete_workflow(workflow_id: str):
    from src.db.operations import delete_workflow
    await delete_workflow(workflow_id)
    return {"status": "success"}


# Define standard fixtures
from fastapi.testclient import TestClient
from asgi_lifespan import LifespanManager
import httpx

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture
async def async_client():
    async with LifespanManager(app) as manager:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=manager.app), base_url="http://test") as c:
            yield c

@pytest.fixture(autouse=True)
def clean_mock_db():
    for key in MOCK_DB:
        MOCK_DB[key].clear()
    yield
