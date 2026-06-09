import os
import sys

# Dynamic root path inject for Vercel Serverless environment
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import uuid
import logging
import asyncio
import httpx
import time
import json
from sqlalchemy import case
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Request, Response, HTTPException, Depends, BackgroundTasks
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import select, func
from pydantic import BaseModel

from slack_sdk.signature import SignatureVerifier
import inngest
import inngest.fast_api
from src.workflows.inngest_app import inngest_client
from src.workflows.message_handler import slack_message_handler, cron_schedule_runner

from src.db.pool import get_db_session
from src.db.models import Workspace, Run, Task, Schedule, ProcessedEvent
from src.integrations.crypto import encrypt_token, decrypt_token
from src.config import settings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("klawhub.api")

# Guarantee directories exist
os.makedirs("api/static/js", exist_ok=True)
os.makedirs("api/templates", exist_ok=True)

app = FastAPI(title="Klawhub API", description="Serverless Python Gateway for Klawhub AI Coworkers")

@app.on_event("startup")
async def startup_event():
    if os.getenv("KLAWHUB_RUN_SCHEMA_EVOLUTION", "false").lower() not in {"1", "true", "yes"}:
        logger.info("Skipping runtime database schema evolution; Supabase migrations own production schema.")
        return

    from src.db.pool import init_db_models
    try:
        logger.info("Running database schema evolution on FastAPI startup because KLAWHUB_RUN_SCHEMA_EVOLUTION is enabled...")
        await init_db_models()
    except Exception as e:
        logger.error(f"Startup database migration failed: {e}", exc_info=True)

# Mount Static Files
app.mount("/static", StaticFiles(directory="api/static"), name="static")

# Expose the background workflow runner server at /api/inngest
inngest.fast_api.serve(
    app,
    inngest_client,
    [slack_message_handler, cron_schedule_runner]
)

# Initialize Slack request signature verifier
slack_verifier = SignatureVerifier(settings.slack_signing_secret)

# Shared HTTP client for improved performance (connection pooling)
http_client = httpx.AsyncClient()

@app.on_event("shutdown")
async def shutdown_event():
    await http_client.aclose()



async def dispatch_slack_event_to_inngest_bg(event: Dict[str, Any], event_id: Optional[str], team_id: Optional[str]) -> None:
    """Dispatches Slack events to Inngest outside Slack's acknowledgement path."""
    event_identifier = event_id or str(uuid.uuid4())
    try:
        await asyncio.wait_for(
            inngest_client.send(
                inngest.Event(
                    name="slack/event.received",
                    data={
                        "event": event,
                        "eventId": event_identifier,
                        "teamId": team_id
                    },
                    id=event_identifier
                )
            ),
            timeout=8.0
        )
        logger.info(f"Successfully dispatched slack/event.received event {event_identifier} to Inngest.")
    except Exception as e:
        logger.error(f"Failed to dispatch Slack event {event_identifier} to Inngest in background: {e}", exc_info=True)


async def add_initial_reaction_bg(workspace_id: uuid.UUID, channel_id: str, message_ts: str, reaction: str = "eyes") -> None:
    """Adds immediate visual Slack acknowledgement without blocking the Slack Events response."""
    try:
        from src.integrations.providers.slack.client import SlackClient
        slack_client = SlackClient(workspace_id)
        await asyncio.wait_for(slack_client.add_reaction(channel_id, message_ts, reaction), timeout=4.0)
    except Exception as e:
        logger.warning(f"Failed to add immediate '{reaction}' reaction: {e}")


def should_forward_proactive_channel_message(text: str) -> bool:
    """Cheap gateway heuristic for unmentioned channel messages that may deserve proactive handling."""
    normalized = (text or "").lower()
    if not normalized or len(normalized.split()) < 4:
        return False
    if "?" in normalized:
        return True
    proactive_phrases = [
        "how do we", "how can i", "help with", "anyone know", "how to",
        "need to find", "is there a", "can someone", "where is", "stuck on",
        "trying to", "problem with", "error running", "fail to", "failing to",
        "need a", "need an", "please build", "please create"
    ]
    return any(phrase in normalized for phrase in proactive_phrases)


async def verify_slack_request(request: Request) -> bytes:
    """Dependency that cryptographically verifies the authenticity of incoming requests from Slack."""
    # Read raw request body
    body_bytes = await request.body()
    
    # Retrieve Slack signature headers
    timestamp = request.headers.get("X-Slack-Request-Timestamp")
    signature = request.headers.get("X-Slack-Signature")
    
    if not timestamp or not signature:
        logger.warning("Rejected request: missing Slack signature headers.")
        raise HTTPException(status_code=401, detail="Missing signature headers")
        
    # Guard against replay attacks
    try:
        ts_int = int(timestamp)
    except ValueError:
        logger.warning("Rejected request: invalid Slack timestamp format.")
        raise HTTPException(status_code=401, detail="Invalid timestamp format")
        
    if abs(time.time() - ts_int) > 60 * 5:
        logger.warning(f"Rejected request: replay window expired. Timestamp: {timestamp}, Current: {time.time()}")
        raise HTTPException(status_code=401, detail="Request timestamp too old")
        
    # Verify signature
    if not slack_verifier.is_valid(body_bytes, timestamp, signature):
        logger.warning("Rejected request: cryptographically invalid Slack signature.")
        raise HTTPException(status_code=401, detail="Invalid signature")
        
    return body_bytes

# ─────────────────────────────────────────────
# Session & Cryptographic Helper Operations
# ─────────────────────────────────────────────

def get_session_workspace_id(request: Request) -> Optional[uuid.UUID]:
    """Retrieves and decrypts the Workspace ID from the secure session cookie."""
    session_id_b64 = request.cookies.get("session_id")
    if not session_id_b64:
        return None
    try:
        workspace_id_str = decrypt_token(session_id_b64)
        return uuid.UUID(workspace_id_str)
    except Exception as e:
        logger.warning(f"Failed to decrypt workspace session ID: {str(e)}")
        return None

# ─────────────────────────────────────────────
# Page Serving Routes
# ─────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    """Serves the visually stunning, high-converting homepage."""
    filepath = "api/templates/index.html"
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Homepage template not found")
    with open(filepath, "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content)


@app.get("/dashboard", response_class=HTMLResponse)
async def serve_dashboard(request: Request):
    """Serves the frosted glassmorphic Settings & Analytics Dashboard."""
    workspace_id = get_session_workspace_id(request)
    if not workspace_id:
        logger.info("Unauthorized dashboard access attempt. Redirecting to home.")
        return RedirectResponse(url="/?error=unauthorized", status_code=303)
    
    filepath = "api/templates/dashboard.html"
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Dashboard template not found")
    with open(filepath, "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content)

# ─────────────────────────────────────────────
# Slack Installation & OAuth Flow
# ─────────────────────────────────────────────

def get_redirect_uri(request: Request) -> str:
    """Constructs the absolute Slack OAuth redirect URI with proper HTTPS scheme in production."""
    proto = request.headers.get("x-forwarded-proto", "http")
    host = request.headers.get("x-forwarded-host") or request.url.netloc
    
    # Force https for any production deployment to avoid HTTP vs HTTPS mismatch in Slack
    if "localhost" not in host and "127.0.0.1" not in host:
        proto = "https"
        
    return f"{proto}://{host}/api/slack/oauth"


@app.get("/api/slack/install")
async def slack_install(request: Request):
    """Generates the Slack OAuth V2 installation link with clean scopes."""
    client_id = os.environ.get("NEXT_PUBLIC_SLACK_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="Slack Client ID is not configured in env.")
        
    redirect_uri = get_redirect_uri(request)
    
    scopes = [
        "app_mentions:read",
        "channels:history",
        "chat:write",
        "commands",
        "groups:history",
        "im:history",
        "mpim:history",
        "users:read",
        "users:read.email"
    ]
    
    scopes_str = ",".join(scopes)
    auth_url = (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={client_id}"
        f"&scope={scopes_str}"
        f"&redirect_uri={redirect_uri}"
    )
    return RedirectResponse(url=auth_url)


@app.get("/api/slack/oauth")
async def slack_oauth(code: str, request: Request, response: Response):
    """Slack OAuth callback handler exchanging code for bot token and initiating workspace session."""
    client_id = os.environ.get("NEXT_PUBLIC_SLACK_CLIENT_ID")
    client_secret = os.environ.get("SLACK_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="Slack Client configuration missing.")

    logger.info("Exchanging Slack authorization code for access token...")
    redirect_uri = get_redirect_uri(request)
    res = await http_client.post(
        "https://slack.com/api/oauth.v2.access",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri
        }
    )
    payload = res.json()

    if not payload.get("ok"):
        logger.error(f"Slack OAuth failed: {payload.get('error')}")
        return RedirectResponse(url="/?error=oauth_failed")

    team = payload.get("team", {})
    team_id = team.get("id")
    team_name = team.get("name") or "Slack Workspace"
    bot_user_id = payload.get("bot_user_id")
    access_token = payload.get("access_token")

    if not team_id or not bot_user_id or not access_token:
        raise HTTPException(status_code=400, detail="Incomplete OAuth payload from Slack.")

    # Register or Update Workspace details inside the PostgreSQL database (SQLModel)
    async with get_db_session() as session:
        statement = select(Workspace).where(Workspace.slack_team_id == team_id)
        result = await session.execute(statement)
        workspace = result.scalar_one_or_none()

        if workspace:
            logger.info(f"Workspace {team_id} already registered. Updating credentials...")
            workspace.bot_token = access_token
            workspace.slack_bot_user_id = bot_user_id
            workspace.name = team_name
            workspace.is_active = True
            workspace.updated_at = datetime.utcnow()
        else:
            logger.info(f"Registering brand-new Workspace: {team_name} ({team_id})...")
            workspace = Workspace(
                slack_team_id=team_id,
                slack_bot_user_id=bot_user_id,
                bot_token=access_token,
                name=team_name,
                plan="free",
                monthly_run_limit=100,
                is_active=True,
                agent_name="Klawhub",
                agent_personality="You are a professional, high-performance executive coworker.",
                enabled_skills=["web_search", "python_sandbox", "pdf_generator"]
            )
            session.add(workspace)

        await session.commit()
        workspace_id = workspace.id

    # Securely encrypt the workspace database UUID to set as session cookie
    encrypted_workspace_id = encrypt_token(str(workspace_id))
    
    # Redirect to the dashboard and append secure signed session cookie
    redirect_res = RedirectResponse(url="/dashboard", status_code=303)
    redirect_res.set_cookie(
        key="session_id",
        value=encrypted_workspace_id,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7 # 7 days expiration
    )
    logger.info(f"Successfully initiated session for Workspace {workspace_id}")
    return redirect_res

# ─────────────────────────────────────────────
# Telemetry and settings API Scoped to Workspace
# ─────────────────────────────────────────────

@app.get("/api/dashboard/stats")
async def get_dashboard_stats(request: Request):
    """Aggregates and delivers real-time workspace runs, tasks, and schedules analytics."""
    workspace_id = get_session_workspace_id(request)
    if not workspace_id:
        raise HTTPException(status_code=401, detail="Unauthorized session")

    async with get_db_session() as session:
        # 1. Fetch Workspace Profile
        workspace = await session.get(Workspace, workspace_id)
        if not workspace:
            raise HTTPException(status_code=404, detail="Workspace not found")

        # 2. Get Telemetry Counters
        runs_query = select(
            func.count(Run.id).label("total"),
            func.sum(case((Run.status == "completed", 1), else_=0)).label("completed")
        ).where(Run.workspace_id == workspace_id)
        runs_res = await session.execute(runs_query)
        runs_row = runs_res.first()
        total_runs = runs_row.total or 0
        completed_runs = int(runs_row.completed or 0)
        pending_runs = total_runs - completed_runs

        tasks_query = select(
            func.count(Task.id).label("total"),
            func.sum(case((Task.status == "completed", 1), else_=0)).label("completed")
        ).where(Task.workspace_id == workspace_id)
        tasks_res = await session.execute(tasks_query)
        tasks_row = tasks_res.first()
        total_tasks = tasks_row.total or 0
        completed_tasks = int(tasks_row.completed or 0)

        schedules_count_query = select(func.count(Schedule.id)).where(
            Schedule.workspace_id == workspace_id,
            Schedule.is_active == True
        )
        schedules_count_res = await session.execute(schedules_count_query)
        active_schedules = schedules_count_res.scalar() or 0

    # Aggregate telemetry splits
    
    # Model compute telemetry (simulated dashboard ratios for aesthetic graph representation)
    model_splits = {
        "gpt4": int(total_runs * 0.4) if total_runs > 0 else 0,
        "claude": int(total_runs * 0.35) if total_runs > 0 else 0,
        "gemini": total_runs - int(total_runs * 0.4) - int(total_runs * 0.35) if total_runs > 0 else 0
    }

    return {
        "workspace_name": workspace.name,
        "agent_name": workspace.agent_name,
        "plan": workspace.plan,
        "monthly_run_limit": workspace.monthly_run_limit,
        "runs_count": total_runs,
        "runs_completed": completed_runs,
        "runs_pending": pending_runs,
        "tasks_count": total_tasks,
        "tasks_completed": completed_tasks,
        "active_schedules": active_schedules,
        "model_splits": model_splits
    }


class SettingsUpdateSchema(BaseModel):
    agent_name: str
    agent_personality: str
    enabled_skills: List[str]
    is_active: bool


@app.get("/api/dashboard/settings")
async def get_dashboard_settings(request: Request):
    """Retrieves current workspace settings identity."""
    workspace_id = get_session_workspace_id(request)
    if not workspace_id:
        raise HTTPException(status_code=401, detail="Unauthorized session")

    async with get_db_session() as session:
        workspace = await session.get(Workspace, workspace_id)
        if not workspace:
            raise HTTPException(status_code=404, detail="Workspace not found")

        return {
            "agent_name": workspace.agent_name,
            "agent_personality": workspace.agent_personality or "",
            "enabled_skills": workspace.enabled_skills or [],
            "is_active": workspace.is_active,
            "plan": workspace.plan,
            "monthly_run_limit": workspace.monthly_run_limit
        }


@app.post("/api/dashboard/settings")
async def update_dashboard_settings(data: SettingsUpdateSchema, request: Request):
    """Saves updated identity settings with strict multi-tenant boundary checks."""
    workspace_id = get_session_workspace_id(request)
    if not workspace_id:
        raise HTTPException(status_code=401, detail="Unauthorized session")

    if not data.agent_name.strip():
        raise HTTPException(status_code=400, detail="Agent Name cannot be blank.")

    async with get_db_session() as session:
        workspace = await session.get(Workspace, workspace_id)
        if not workspace:
            raise HTTPException(status_code=404, detail="Workspace not found")

        logger.info(f"Updating settings for Workspace {workspace_id}: name='{data.agent_name}'")
        workspace.agent_name = data.agent_name.strip()
        workspace.agent_personality = data.agent_personality.strip()
        workspace.enabled_skills = data.enabled_skills
        workspace.is_active = data.is_active
        workspace.updated_at = datetime.utcnow()

        session.add(workspace)
        await session.commit()

    return {"status": "success", "message": "Settings updated successfully"}


@app.post("/api/dashboard/logout")
async def logout(response: Response):
    """Deletes session cookie and logs out user."""
    response.delete_cookie(key="session_id")
    return {"status": "success", "message": "Logged out successfully"}


# ─────────────────────────────────────────────
# Slack Gateway HTTP API Routes
# ─────────────────────────────────────────────

async def process_reaction_added_bg(
    workspace_id: uuid.UUID,
    user_id: str,
    reaction: str,
    channel_id: str,
    message_ts: str
):
    """Processes reaction feedback asynchronously in the background, logging to database for Few-Shot Learning."""
    try:
        from src.integrations.providers.slack.client import SlackClient
        from src.db.models import WorkflowLearning
        from sqlmodel import select
        
        slack_client = SlackClient(workspace_id)
        
        # 1. Fetch the bot's message text
        replies = await slack_client.get_thread_replies(channel_id, message_ts)
        if not replies:
            return
            
        bot_message = None
        for msg in replies:
            if msg.get("ts") == message_ts:
                bot_message = msg
                break
                
        if not bot_message:
            return
            
        bot_text = bot_message.get("text", "")
        
        # 2. Get the triggering user message in history
        trigger_text = "Conversational message"
        for idx, msg in enumerate(replies):
            if msg.get("ts") == message_ts and idx > 0:
                trigger_text = replies[idx - 1].get("text", "")
                break
                
        # 3. Classify feedback rating
        rating = 5 if reaction in ["white_check_mark", "heavy_check_mark", "+1", "thumbsup"] else 1
        feedback_label = "Positive" if rating == 5 else "Negative"
        
        logger.info(f"Reaction-Based Learning: Recording {feedback_label} feedback on message {message_ts}")
        
        async with get_db_session() as session:
            # Check unique constraint to avoid duplicates
            statement = select(WorkflowLearning).where(
                WorkflowLearning.workspace_id == workspace_id,
                WorkflowLearning.slack_user_id == user_id,
                WorkflowLearning.message_ts == message_ts,
                WorkflowLearning.reaction == reaction
            )
            result = await session.execute(statement)
            existing = result.scalar_one_or_none()
            
            if not existing:
                learning = WorkflowLearning(
                    workspace_id=workspace_id,
                    slack_user_id=user_id,
                    message_ts=message_ts,
                    reaction=reaction,
                    category="conversational",
                    trigger_prompt=trigger_text[:200],
                    feedback=feedback_label,
                    correction=bot_text[:500],
                    rating=rating
                )
                session.add(learning)
                await session.commit()
                logger.info(f"Successfully recorded reaction workflow learning record {learning.id}")
    except Exception as e:
        logger.error(f"Error in process_reaction_added_bg: {e}", exc_info=True)


@app.post("/api/slack/events")
async def slack_events(
    request: Request,
    background_tasks: BackgroundTasks,
    body_bytes: bytes = Depends(verify_slack_request)
):
    """Receives, verifies, and routes Slack event subscriptions (mentions, direct messages, and reactions)."""
    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
        
    # Handle the URL verification handshake
    if payload.get("type") == "url_verification":
        logger.info("Successfully handled Slack URL verification handshake.")
        return {"challenge": payload.get("challenge")}
        
    if payload.get("type") != "event_callback":
        return {"ok": True}
        
    event = payload.get("event", {})
    event_type = event.get("type")
    event_id = payload.get("event_id")
    team_id = payload.get("team_id")
    
    # Process messages, app_mentions, or reactions
    if event_type not in ["message", "app_mention", "reaction_added"]:
        return {"ok": True}
        
    # Ignore bot messages to prevent infinite execution loops (except for reactions)
    if event_type != "reaction_added" and (event.get("bot_id") or event.get("user") == event.get("bot_user_id")):
        return {"ok": True}
        
    channel = event.get("channel", "")
    text = event.get("text", "")
    user = event.get("user", "")
    
    # Load workspace details to retrieve bot user id and verify activation
    async with get_db_session() as session:
        statement = select(Workspace).where(Workspace.slack_team_id == team_id)
        result = await session.execute(statement)
        workspace = result.scalar_one_or_none()
        
    if not workspace:
        logger.warning(f"No registered workspace found for Slack team ID: {team_id}. Ignoring event.")
        return {"ok": True}
        
    if not workspace.is_active:
        logger.warning(f"Workspace {workspace.id} is currently inactive. Ignoring event.")
        return {"ok": True}
        
    # Handle reaction feedback asynchronously in a background task
    if event_type == "reaction_added":
        item = event.get("item", {})
        item_user = event.get("item_user")
        
        if item.get("type") == "message" and item_user == workspace.slack_bot_user_id:
            logger.info("Asynchronously processing reaction feedback on bot message in background task...")
            background_tasks.add_task(
                process_reaction_added_bg,
                workspace_id=workspace.id,
                user_id=user,
                reaction=event.get("reaction"),
                channel_id=item.get("channel"),
                message_ts=item.get("ts")
            )
        return {"ok": True}
        
    # Exclude bot self-messages using database bot user ID boundary
    if user == workspace.slack_bot_user_id:
        return {"ok": True}
        
    # Determine the conversational boundary: DM vs Channel
    is_dm = channel.startswith("D") or event.get("channel_type") == "im"
    bot_mention_tag = f"<@{workspace.slack_bot_user_id}>"
    
    should_ack_reaction = False
    if is_dm:
        logger.info(f"Direct Message received in channel {channel} from user {user}.")
        cleaned_text = text.replace(bot_mention_tag, "").strip()
        should_ack_reaction = True
    else:
        has_bot_mention = bool(bot_mention_tag and bot_mention_tag in text)
        if has_bot_mention:
            logger.info(f"App mention received in channel {channel} from user {user}.")
            cleaned_text = text.replace(bot_mention_tag, "").strip()
            should_ack_reaction = True
        elif should_forward_proactive_channel_message(text):
            logger.info(f"Forwarding likely proactive channel need in {channel} from user {user}.")
            cleaned_text = text.strip()
        else:
            return {"ok": True}

    # Clean up any residual double-spaces or legacy tags
    event["text"] = cleaned_text

    if should_ack_reaction and channel and event.get("ts"):
        background_tasks.add_task(add_initial_reaction_bg, workspace.id, channel, event.get("ts"), "eyes")

    # Slack may retry the same event if its 3-second ack window is missed. Keep the
    # workflow idempotent before handing work to Inngest in the background.
    if event_id:
        try:
            async with get_db_session() as session:
                existing = await session.get(ProcessedEvent, event_id)
                if existing:
                    logger.info(f"Duplicate Slack event {event_id} ignored before Inngest dispatch.")
                    return {"ok": True}
                session.add(ProcessedEvent(event_id=event_id))
                await session.commit()
        except Exception as e:
            logger.warning(f"ProcessedEvent idempotency check failed for {event_id}; relying on Inngest idempotency: {e}")

    # Dispatch the Inngest workflow outside Slack's acknowledgement path.
    logger.info(f"Scheduling slack/event.received event {event_id} dispatch to Inngest in background...")
    background_tasks.add_task(dispatch_slack_event_to_inngest_bg, event, event_id, team_id)

    return {"ok": True}


async def open_settings_modal_bg(
    workspace_id: uuid.UUID,
    workspace_name: str,
    workspace_agent_name: Optional[str],
    workspace_agent_personality: Optional[str],
    workspace_enabled_skills: Optional[List[str]],
    trigger_id: str,
    channel_id: str
):
    """Asynchronously generates the Slack Block Kit modal form and opens it using the trigger_id.
    
    Executed in a background task to instantly free the main HTTP response thread, avoiding trigger_id expiration.
    """
    try:
        from src.integrations.providers.slack.client import SlackClient
        slack_client = SlackClient(workspace_id)
        
        all_skills = ["web_search", "puppeteer_scraping", "python_sandbox", "pdf_generator"]
        enabled_skills = workspace_enabled_skills or []
        for sk in enabled_skills:
            if sk not in all_skills:
                all_skills.append(sk)
                
        skill_options = [
            {
                "text": {"type": "plain_text", "text": sk.replace("_", " ").title(), "emoji": True},
                "value": sk
            }
            for sk in all_skills
        ]
        
        initial_skill_options = [
            opt for opt in skill_options if opt["value"] in enabled_skills
        ]
        
        modal_view = {
            "type": "modal",
            "callback_id": "settings_modal",
            "title": {"type": "plain_text", "text": "Configure Coworker"},
            "submit": {"type": "plain_text", "text": "Save Changes"},
            "close": {"type": "plain_text", "text": "Cancel"},
            "private_metadata": json.dumps({"channel_id": channel_id, "workspace_id": str(workspace_id)}),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"🔧 *Configure Coworker Identity for `{workspace_name}`*"
                    }
                },
                {
                    "type": "input",
                    "block_id": "block_agent_name",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "input_agent_name",
                        "initial_value": workspace_agent_name or "Klawhub",
                        "placeholder": {"type": "plain_text", "text": "Enter bot name..."}
                    },
                    "label": {"type": "plain_text", "text": "Agent Bot Name"}
                },
                {
                    "type": "input",
                    "block_id": "block_agent_personality",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "input_agent_personality",
                        "multiline": True,
                        "initial_value": workspace_agent_personality or "Professional, efficient, and precise.",
                        "placeholder": {"type": "plain_text", "text": "Describe how this coworker should act..."}
                    },
                    "label": {"type": "plain_text", "text": "Agent Personality Profile"}
                },
                {
                    "type": "input",
                    "block_id": "block_enabled_skills",
                    "element": {
                        "type": "checkboxes",
                        "action_id": "input_enabled_skills",
                        "options": skill_options,
                        **({"initial_options": initial_skill_options} if initial_skill_options else {})
                    },
                    "label": {"type": "plain_text", "text": "Active Cognitive Skills"}
                }
            ]
        }
        
        await slack_client.open_view(trigger_id, modal_view)
        logger.info("Successfully opened configuration modal in background task.")
    except Exception as e:
        logger.error(f"Failed to open configure modal in background task: {e}", exc_info=True)


def format_skills_list(workspace_name: str, skills: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generates gorgeous Block Kit layout representing the workspace custom skills."""
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🧠 Workspace Cognitive Skills - {workspace_name}",
                "emoji": True
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "Here are the custom cognitive skills engineered and installed for your workspace."
            }
        },
        {"type": "divider"}
    ]
    
    if not skills:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "_No custom cognitive skills installed. Ask me to engineer a custom skill to get started!_"
            }
        })
    else:
        for s in skills:
            status_emoji = "🟢 `ACTIVE`" if s.get("is_active") else "⏸️ `PAUSED`"
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Skill Name:* `{s.get('name')}`\n"
                            f"• *Description:* _{s.get('description')}_\n"
                            f"• *Entrypoint:* `{s.get('entrypoint')}`\n"
                            f"• *Status:* {status_emoji}"
                }
            })
            
            toggle_action = "skill_pause" if s.get("is_active") else "skill_resume"
            toggle_text = "⏸️ Pause" if s.get("is_active") else "▶️ Resume"
            
            blocks.append({
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": toggle_text},
                        "action_id": toggle_action,
                        "value": str(s.get("id"))
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "🗑️ Delete"},
                        "style": "danger",
                        "action_id": "skill_delete",
                        "value": str(s.get("id")),
                        "confirm": {
                            "title": {"type": "plain_text", "text": "Confirm Delete"},
                            "text": {"type": "plain_text", "text": "Are you sure you want to permanently delete this cognitive skill?"},
                            "confirm": {"type": "plain_text", "text": "Delete"},
                            "deny": {"type": "plain_text", "text": "Cancel"}
                        }
                    }
                ]
            })
            blocks.append({"type": "divider"})
            
    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "➕ Create New Skill"},
                "style": "primary",
                "action_id": "skill_create_modal"
            }
        ]
    })
    
    return blocks


def build_skill_creation_modal(workspace_id: uuid.UUID, channel_id: str) -> Dict[str, Any]:
    """Generates gorgeous stateful Skill Creation Modal layout."""
    return {
        "type": "modal",
        "callback_id": "skill_create_modal_submit",
        "title": {"type": "plain_text", "text": "Create Custom Skill"},
        "submit": {"type": "plain_text", "text": "Create"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "private_metadata": json.dumps({"channel_id": channel_id, "workspace_id": str(workspace_id)}),
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "➕ *Set up a new dynamic cognitive skill coworker huddle.*"
                }
            },
            {
                "type": "input",
                "block_id": "block_skill_name",
                "element": {
                    "type": "plain_text_input",
                    "action_id": "input_skill_name",
                    "placeholder": {"type": "plain_text", "text": "e.g., csv_summarizer"}
                },
                "label": {"type": "plain_text", "text": "Skill Name"}
            },
            {
                "type": "input",
                "block_id": "block_skill_desc",
                "element": {
                    "type": "plain_text_input",
                    "action_id": "input_skill_desc",
                    "placeholder": {"type": "plain_text", "text": "e.g., Summarizes csv input and prints a row count report"}
                },
                "label": {"type": "plain_text", "text": "Description"}
            },
            {
                "type": "input",
                "block_id": "block_skill_source",
                "element": {
                    "type": "plain_text_input",
                    "action_id": "input_skill_source",
                    "multiline": True,
                    "placeholder": {"type": "plain_text", "text": "def handler(text):\n    # Write Python code here\n    print('Hello World')"}
                },
                "label": {"type": "plain_text", "text": "Python Source Code"}
            }
        ]
    }


async def open_skill_creation_modal_bg(
    workspace_id: uuid.UUID,
    trigger_id: str,
    channel_id: str
):
    """Asynchronously generates and opens the Slack Block Kit skill creation modal."""
    try:
        from src.integrations.providers.slack.client import SlackClient
        slack_client = SlackClient(workspace_id)
        modal_view = build_skill_creation_modal(workspace_id, channel_id)
        await slack_client.open_view(trigger_id, modal_view)
        logger.info("Successfully opened skill creation modal in background task.")
    except Exception as e:
        logger.error(f"Failed to open skill creation modal: {e}", exc_info=True)


def format_schedules_list(workspace_name: str, schedules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generates gorgeous Block Kit layout representing the workspace schedules."""
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"⏰ Workspace Schedules - {workspace_name}",
                "emoji": True
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "Here are the active and paused cron trigger schedules configured for your workspace."
            }
        },
        {"type": "divider"}
    ]
    
    if not schedules:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "_No schedules configured. Type `/klawhub schedule create` or ask me to schedule standups to create one!_"
            }
        })
    else:
        for s in schedules:
            status_emoji = "🟢 `ACTIVE`" if s.get("is_active") else "⏸️ `PAUSED`"
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Schedule Name:* `{s.get('name')}`\n"
                            f"• *Cron Expr:* `{s.get('cron_expr')}`\n"
                            f"• *Timezone:* `{s.get('timezone')}`\n"
                            f"• *Action message:* _{s.get('action')}_\n"
                            f"• *Channel:* <#{s.get('channel_id')}>\n"
                            f"• *Status:* {status_emoji}"
                }
            })
            
            toggle_action = "schedule_pause" if s.get("is_active") else "schedule_resume"
            toggle_text = "⏸️ Pause" if s.get("is_active") else "▶️ Resume"
            
            blocks.append({
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": toggle_text},
                        "action_id": toggle_action,
                        "value": str(s.get("id"))
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "🗑️ Delete"},
                        "style": "danger",
                        "action_id": "schedule_delete",
                        "value": str(s.get("id")),
                        "confirm": {
                            "title": {"type": "plain_text", "text": "Confirm Delete"},
                            "text": {"type": "plain_text", "text": "Are you sure you want to permanently delete this schedule?"},
                            "confirm": {"type": "plain_text", "text": "Delete"},
                            "deny": {"type": "plain_text", "text": "Cancel"}
                        }
                    }
                ]
            })
            blocks.append({"type": "divider"})
            
    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "➕ Create New Schedule"},
                "style": "primary",
                "action_id": "schedule_create_modal"
            }
        ]
    })
    
    return blocks


def build_schedule_creation_modal(workspace_id: uuid.UUID, channel_id: str) -> Dict[str, Any]:
    """Generates gorgeous stateful Schedule Creation Modal layout."""
    return {
        "type": "modal",
        "callback_id": "schedule_create_modal_submit",
        "title": {"type": "plain_text", "text": "Create Cron Schedule"},
        "submit": {"type": "plain_text", "text": "Create"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "private_metadata": json.dumps({"channel_id": channel_id, "workspace_id": str(workspace_id)}),
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "➕ *Set up a new recurring schedule coworker huddle.*"
                }
            },
            {
                "type": "input",
                "block_id": "block_schedule_name",
                "element": {
                    "type": "plain_text_input",
                    "action_id": "input_schedule_name",
                    "placeholder": {"type": "plain_text", "text": "e.g., Daily Standup Report"}
                },
                "label": {"type": "plain_text", "text": "Schedule Name"}
            },
            {
                "type": "input",
                "block_id": "block_schedule_cron",
                "element": {
                    "type": "plain_text_input",
                    "action_id": "input_schedule_cron",
                    "placeholder": {"type": "plain_text", "text": "e.g., 0 9 * * 1-5 (every weekday at 9am)"}
                },
                "label": {"type": "plain_text", "text": "Cron Expression (5 fields)"}
            },
            {
                "type": "input",
                "block_id": "block_schedule_timezone",
                "element": {
                    "type": "static_select",
                    "action_id": "input_schedule_timezone",
                    "initial_option": {
                        "text": {"type": "plain_text", "text": "UTC"},
                        "value": "UTC"
                    },
                    "options": [
                        {"text": {"type": "plain_text", "text": "UTC"}, "value": "UTC"},
                        {"text": {"type": "plain_text", "text": "US/Eastern (EST/EDT)"}, "value": "US/Eastern"},
                        {"text": {"type": "plain_text", "text": "US/Central (CST/CDT)"}, "value": "US/Central"},
                        {"text": {"type": "plain_text", "text": "US/Pacific (PST/PDT)"}, "value": "US/Pacific"},
                        {"text": {"type": "plain_text", "text": "Europe/London (GMT/BST)"}, "value": "Europe/London"},
                        {"text": {"type": "plain_text", "text": "Asia/Tokyo (JST)"}, "value": "Asia/Tokyo"}
                    ]
                },
                "label": {"type": "plain_text", "text": "Timezone"}
            },
            {
                "type": "input",
                "block_id": "block_schedule_action",
                "element": {
                    "type": "plain_text_input",
                    "action_id": "input_schedule_action",
                    "placeholder": {"type": "plain_text", "text": "e.g., ask team to standup huddle or execute daily report"}
                },
                "label": {"type": "plain_text", "text": "Action / Intent (Message to trigger)"}
            }
        ]
    }


async def open_schedule_creation_modal_bg(
    workspace_id: uuid.UUID,
    trigger_id: str,
    channel_id: str
):
    """Asynchronously generates and opens the Slack Block Kit schedule creation modal huddle."""
    try:
        from src.integrations.providers.slack.client import SlackClient
        slack_client = SlackClient(workspace_id)
        modal_view = build_schedule_creation_modal(workspace_id, channel_id)
        await slack_client.open_view(trigger_id, modal_view)
        logger.info("Successfully opened schedule creation modal in background task.")
    except Exception as e:
        logger.error(f"Failed to open schedule creation modal: {e}", exc_info=True)


@app.post("/api/slack/commands")
async def slack_commands(
    request: Request,
    background_tasks: BackgroundTasks,
    body_bytes: bytes = Depends(verify_slack_request)
):
    """Receives and executes /klawhub slash commands, delivering gorgeous Block Kit messages."""
    import urllib.parse
    form_data = urllib.parse.parse_qs(body_bytes.decode("utf-8"))
    
    command = form_data.get("command", [""])[0]
    text_args = form_data.get("text", [""])[0].strip().lower()
    team_id = form_data.get("team_id", [""])[0]
    channel_id = form_data.get("channel_id", [""])[0]
    user_id = form_data.get("user_id", [""])[0]

    # Sanitize user-controlled fields before logging to prevent log injection (CWE-117).
    # Newlines (\r, \n) in attacker-controlled input can forge additional log entries.
    def _sanitize_log(value: str) -> str:
        return value.replace("\r", "\\r").replace("\n", "\\n")

    logger.info(
        "Slash command '%s' with arguments '%s' triggered by %s in workspace %s.",
        _sanitize_log(command),
        _sanitize_log(text_args),
        _sanitize_log(user_id),
        _sanitize_log(team_id),
    )
    
    async with get_db_session() as session:
        statement = select(Workspace).where(Workspace.slack_team_id == team_id)
        result = await session.execute(statement)
        workspace = result.scalar_one_or_none()
        
    if not workspace:
        return JSONResponse({
            "response_type": "ephemeral",
            "text": ":warning: This Slack workspace is not registered with Klawhub. Please install Klawhub first."
        })
        
    if not workspace.is_active:
        return JSONResponse({
            "response_type": "ephemeral",
            "text": ":warning: Klawhub coworker services are currently deactivated for this workspace. Please activate them in the web settings."
        })
        
    if text_args == "status":
        async with get_db_session() as session:
            runs_query = select(
                func.count(Run.id).label("total"),
                func.sum(case((Run.status == "completed", 1), else_=0)).label("completed")
            ).where(Run.workspace_id == workspace.id)
            runs_res = await session.execute(runs_query)
            runs_row = runs_res.first()
            total_runs = runs_row.total or 0
            completed_runs = int(runs_row.completed or 0)
            
            schedules_count_query = select(func.count(Schedule.id)).where(
                Schedule.workspace_id == workspace.id,
                Schedule.is_active == True
            )
            schedules_count_res = await session.execute(schedules_count_query)
            active_schedules = schedules_count_res.scalar() or 0
            
            tasks_query = select(
                func.count(Task.id).label("total"),
                func.sum(case((Task.status == "completed", 1), else_=0)).label("completed")
            ).where(Task.workspace_id == workspace.id)
            tasks_res = await session.execute(tasks_query)
            tasks_row = tasks_res.first()
            total_tasks = tasks_row.total or 0
            completed_tasks = int(tasks_row.completed or 0)
        
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"🤖 {workspace.agent_name} Status & Analytics",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Organization:* `{workspace.name}`\n*Billing Plan:* `{workspace.plan.upper()}`\n*Status:* :green_heart: `ACTIVE`"
                }
            },
            {"type": "divider"},
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"📈 *Conversational Runs:*\n`{completed_runs} / {total_runs} Completed`"},
                    {"type": "mrkdwn", "text": f"🕒 *Active Schedules:*\n`{active_schedules} Cron Triggers`"},
                    {"type": "mrkdwn", "text": f"✅ *Completed Tasks:*\n`{completed_tasks} / {total_tasks} Executed`"},
                    {"type": "mrkdwn", "text": f"🛡️ *Monthly Plan Limit:*\n`{total_runs} / {workspace.monthly_run_limit} Runs Used`"}
                ]
            },
            {"type": "divider"},
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"🧠 *Coworker Personality Profile:*\n_{workspace.agent_personality or 'You are a professional, high-performance executive coworker.'}_"
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"Klawhub serverless gateway • live telemetry compiled at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC"
                    }
                ]
            }
        ]
        
        return JSONResponse({
            "response_type": "in_channel",
            "blocks": blocks
        })
        
    elif text_args.startswith("schedule") or text_args.startswith("schedules"):
        subargs = text_args.replace("schedules", "").replace("schedule", "").strip()
        
        if subargs.startswith("create"):
            trigger_id = form_data.get("trigger_id", [""])[0]
            if not trigger_id:
                return JSONResponse({
                    "response_type": "ephemeral",
                    "text": ":warning: Command requires a trigger ID. Please execute it within Slack."
                })
                
            background_tasks.add_task(
                open_schedule_creation_modal_bg,
                workspace_id=workspace.id,
                trigger_id=trigger_id,
                channel_id=channel_id
            )
            return Response(content="", media_type="text/plain")
        else:
            # Default: list all active/paused schedules scoped to workspace
            from src.core.tools.schedule_control import ScheduleControl
            schedules = await ScheduleControl.list_schedules(workspace.id)
            blocks = format_schedules_list(workspace.name, schedules)
            return JSONResponse({
                "response_type": "ephemeral",
                "blocks": blocks
            })
        
    elif text_args.startswith("skill") or text_args.startswith("skills"):
        subargs = text_args.replace("skills", "").replace("skill", "").strip()
        
        if subargs.startswith("create"):
            trigger_id = form_data.get("trigger_id", [""])[0]
            if not trigger_id:
                return JSONResponse({
                    "response_type": "ephemeral",
                    "text": ":warning: Command requires a trigger ID. Please execute it within Slack."
                })
                
            background_tasks.add_task(
                open_skill_creation_modal_bg,
                workspace_id=workspace.id,
                trigger_id=trigger_id,
                channel_id=channel_id
            )
            return Response(content="", media_type="text/plain")
        else:
            from src.core.tools.skill_control import SkillControl
            skills = await SkillControl.list_skills(workspace.id)
            blocks = format_skills_list(workspace.name, skills)
            return JSONResponse({
                "response_type": "ephemeral",
                "blocks": blocks
            })
        
    elif text_args.startswith("monitor"):
        from src.core.tools.schedule_control import ScheduleControl
        try:
            schedules = await ScheduleControl.list_schedules(workspace.id)
            existing = [s for s in schedules if s.get("channel_id") == channel_id and "monitor silence" in s.get("action", "").lower()]
            
            if existing:
                return JSONResponse({
                    "response_type": "ephemeral",
                    "text": f"👀 *Silence Monitor is already active for this channel!*\n• *Schedule Name:* `{existing[0].get('name')}`\n• *Cron Expr:* `{existing[0].get('cron_expr')}`"
                })
                
            cron_expr = "0 * * * *"
            result = await ScheduleControl.create_schedule(
                workspace_id=workspace.id,
                slack_user_id=user_id,
                name="Silence Detector",
                cron_expr=cron_expr,
                action=f"monitor silence in channel {channel_id}",
                channel_id=channel_id,
                timezone="UTC"
            )
            confirm_text = (
                f"📡 *Silence Detector monitoring successfully activated for this channel!*\n"
                f"• *Name:* `Silence Detector`\n"
                f"• *Frequency:* `Every Hour` (`{cron_expr}`)\n"
                f"• *Scope:* <#{channel_id}>\n\n"
                f"I will scan this channel and its active threads. If any thread with pending tasks or unresolved questions goes silent for more than 24 hours, I will gently bump it! 🤫"
            )
        except Exception as e:
            confirm_text = f"❌ *Failed to activate Silence Detector:* {str(e)}"
            
        return JSONResponse({
            "response_type": "ephemeral",
            "text": confirm_text
        })
        
    elif text_args in ["configure", "settings"]:
        trigger_id = form_data.get("trigger_id", [""])[0]
        if not trigger_id:
            return JSONResponse({
                "response_type": "ephemeral",
                "text": ":warning: Command requires a trigger ID. Please execute it within Slack."
            })
            
        background_tasks.add_task(
            open_settings_modal_bg,
            workspace_id=workspace.id,
            workspace_name=workspace.name,
            workspace_agent_name=workspace.agent_name,
            workspace_agent_personality=workspace.agent_personality,
            workspace_enabled_skills=workspace.enabled_skills,
            trigger_id=trigger_id,
            channel_id=channel_id
        )
        return Response(content="", media_type="text/plain")

    elif text_args in ["help", ""]:
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "💡 Klawhub Coworker Helper Guide",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"Hi there! I am *{workspace.agent_name}*, your persistent AI coworker. I execute tools, schedule recurring standups, build custom software inside isolated sandboxes, and integrate custom GitHub skills directly in Slack!"
                }
            },
            {"type": "divider"},
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*Available Slash Commands:*\n"
                            "• `/klawhub status` - View my current health, subscription tier, and dynamic runs telemetry.\n"
                            "• `/klawhub help` - Display this interactive helper guide."
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*How to Collaborate:*\n"
                            "• *Direct Messages:* Simply message me here, and I will respond to your queries immediately.\n"
                            "• *Channels:* Invite me to any channel using `/invite @Klawhub` and mention me (`@Klawhub do X`) to activate my tool reasoning chain."
                }
            },
            {"type": "divider"},
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "⚙️ *Workspace Management:*\nConfigure my identity, persona, active integrations, and dynamic skills via your unified Vercel dashboard."
                },
                "accessory": {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "Open Dashboard",
                        "emoji": True
                    },
                    "url": f"{request.base_url}dashboard",
                    "style": "primary"
                }
            }
        ]
        
        return JSONResponse({
            "response_type": "ephemeral",
            "blocks": blocks
        })
        
    else:
        return JSONResponse({
            "response_type": "ephemeral",
            "text": f":warning: Unknown command option `{text_args}`. Type `/klawhub help` to see all available commands."
        })


@app.post("/api/slack/actions")
async def slack_actions(request: Request, body_bytes: bytes = Depends(verify_slack_request)):
    """Receives and processes Slack Block Kit interactive actions (button clicks, modal submissions)."""
    import urllib.parse
    import random
    form_data = urllib.parse.parse_qs(body_bytes.decode("utf-8"))
    payload_str = form_data.get("payload", [""])[0]
    
    if not payload_str:
        raise HTTPException(status_code=400, detail="Missing interactive action payload")
        
    try:
        payload = json.loads(payload_str)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON action payload")
        
    payload_type = payload.get("type")
    user_id = payload.get("user", {}).get("id")
    team_id = payload.get("team", {}).get("id")
    channel_id = payload.get("channel", {}).get("id")
    response_url = payload.get("response_url")
    
    logger.info(f"Received Slack interactive action of type {payload_type} from user {user_id} in team {team_id}.")
    
    # Pre-defined list of corporate developer excuses
    CORPORATE_EXCUSES = [
        "My local database migration took 4 hours, corrupted my local state, and I am currently reinstalling everything.",
        "My IDE decided to index the entire node_modules directory, and my laptop's fan is sounding like a jet engine preparing for takeoff.",
        "A minor sub-dependency got deprecated overnight, and I am currently 5 layers deep in npm dependency resolution hell.",
        "The production staging environment is showing a blank screen, and I am tracing a silent NullPointerException in a legacy module.",
        "A git merge conflict in a shared config file somehow deleted 12 of my local files, and I am recovering them from git reflog.",
        "My API key for the development sandbox expired, and I am waiting for the DevOps team to approve the rotation ticket.",
        "I spent the last 3 hours debugging why a CSS margin was off by 2px, only to find a hidden parent container had overflow: hidden."
    ]

    async with get_db_session() as session:
        statement = select(Workspace).where(Workspace.slack_team_id == team_id)
        result = await session.execute(statement)
        workspace = result.scalar_one_or_none()
        
    if not workspace:
        logger.warning(f"No workspace found for Slack team ID {team_id}")
        return {"ok": True}

    from src.integrations.providers.slack.client import SlackClient
    slack_client = SlackClient(workspace.id)

    if payload_type == "view_submission":
        view = payload.get("view", {})
        callback_id = view.get("callback_id")
        private_metadata_str = view.get("private_metadata", "{}")
        
        try:
            metadata = json.loads(private_metadata_str)
        except json.JSONDecodeError:
            metadata = {}
            
        target_channel = metadata.get("channel_id") or channel_id
        target_thread = metadata.get("thread_ts")
        
        if callback_id == "settings_modal":
            # 1. Identity & Settings configuration modal submission
            values = view.get("state", {}).get("values", {})
            new_name = values.get("block_agent_name", {}).get("input_agent_name", {}).get("value")
            new_personality = values.get("block_agent_personality", {}).get("input_agent_personality", {}).get("value")
            
            selected_skills_opts = values.get("block_enabled_skills", {}).get("input_enabled_skills", {}).get("selected_options", [])
            new_skills = [opt.get("value") for opt in selected_skills_opts if opt.get("value")]
            
            async with get_db_session() as session:
                statement = select(Workspace).where(Workspace.id == workspace.id)
                workspace_db = (await session.execute(statement)).scalar_one_or_none()
                if workspace_db:
                    workspace_db.agent_name = new_name or workspace_db.agent_name
                    workspace_db.agent_personality = new_personality or workspace_db.agent_personality
                    workspace_db.enabled_skills = new_skills or workspace_db.enabled_skills
                    workspace_db.updated_at = datetime.utcnow()
                    await session.commit()
            
            # Post confirmation to the channel
            skills_formatted = ", ".join(f"`{sk}`" for sk in new_skills)
            confirm_text = (
                f"⚙️ *Coworker Identity & Settings Synchronized successfully!*\n"
                f"• *Bot Name:* `{new_name}`\n"
                f"• *Personality:* _{new_personality}_\n"
                f"• *Active Skills:* {skills_formatted}"
            )
            
            if target_channel:
                await slack_client.post_message(
                    channel_id=target_channel,
                    text=confirm_text
                )
                
        elif callback_id == "standup_modal":
            # 2. Standup Check-in Modal Submission
            values = view.get("state", {}).get("values", {})
            yesterday = values.get("block_yesterday", {}).get("input_yesterday", {}).get("value")
            today = values.get("block_today", {}).get("input_today", {}).get("value")
            blockers = values.get("block_blockers", {}).get("input_blockers", {}).get("value") or "None"
            
            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "📝 Standup Check-in Complete",
                        "emoji": True
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"🤖 *Check-in submitted by <@{user_id}>*"
                    }
                },
                {"type": "divider"},
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*⏮️ Accomplished Yesterday:*\n{yesterday}"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*⏭️ Focusing on Today:*\n{today}"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*⚠️ Blockers / Impediments:*\n`{blockers}`"
                    }
                }
            ]
            
            if target_channel:
                await slack_client.post_message(
                    channel_id=target_channel,
                    text=f"📝 Standup Check-in submitted by <@{user_id}>",
                    blocks=blocks,
                    thread_ts=target_thread
                )
                
        elif callback_id == "excuse_modal":
            # Excuse Modal Submission
            values = view.get("state", {}).get("values", {})
            excuse = values.get("block_excuse_text", {}).get("input_excuse_text", {}).get("value")
            
            blocks = [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"🤖 *<@{user_id}> is excused from today's standup huddle.*\n\n*Reason:* _{excuse}_"
                    }
                }
            ]
            
            if target_channel:
                await slack_client.post_message(
                    channel_id=target_channel,
                    text=f"🤖 <@{user_id}> is excused from today's standup huddle.",
                    blocks=blocks,
                    thread_ts=target_thread
                )
                
        elif callback_id == "task_creation_modal":
            # 3. Action Item log to DB Task Submission
            values = view.get("state", {}).get("values", {})
            task_request = values.get("block_task_request", {}).get("input_task_request", {}).get("value")
            task_type = values.get("block_task_type", {}).get("input_task_type", {}).get("selected_option", {}).get("value") or "action_item"
            
            async with get_db_session() as session:
                new_task = Task(
                    workspace_id=workspace.id,
                    slack_user_id=user_id,
                    slack_channel_id=target_channel or channel_id or "",
                    slack_thread_ts=target_thread,
                    type=task_type,
                    request=task_request,
                    status="pending"
                )
                session.add(new_task)
                await session.commit()
                
            confirm_text = (
                f"💾 *Action Item successfully converted to Workspace Task!*\n"
                f"• *Task ID:* `{new_task.id}`\n"
                f"• *Category:* `{task_type.upper()}`\n"
                f"• *Request:* _{task_request}_"
            )
            
            if target_channel:
                await slack_client.post_message(
                    channel_id=target_channel,
                    text=confirm_text,
                    thread_ts=target_thread
                )
                
        elif callback_id == "schedule_create_modal_submit":
            values = view.get("state", {}).get("values", {})
            name = values.get("block_schedule_name", {}).get("input_schedule_name", {}).get("value")
            cron_expr = values.get("block_schedule_cron", {}).get("input_schedule_cron", {}).get("value")
            timezone = values.get("block_schedule_timezone", {}).get("input_schedule_timezone", {}).get("selected_option", {}).get("value") or "UTC"
            action_text = values.get("block_schedule_action", {}).get("input_schedule_action", {}).get("value")
            
            from src.core.tools.schedule_control import ScheduleControl
            try:
                result = await ScheduleControl.create_schedule(
                    workspace_id=workspace.id,
                    slack_user_id=user_id,
                    name=name,
                    cron_expr=cron_expr,
                    action=action_text,
                    channel_id=target_channel,
                    timezone=timezone
                )
                confirm_text = (
                    f"⏰ *New Cron Schedule successfully created!*\n"
                    f"• *Name:* `{name}`\n"
                    f"• *Cron expression:* `{cron_expr}`\n"
                    f"• *Timezone:* `{timezone}`\n"
                    f"• *Action:* _{action_text}_"
                )
            except Exception as e:
                confirm_text = f"❌ *Failed to create schedule:* {str(e)}"
                
        elif callback_id == "skill_create_modal_submit":
            values = view.get("state", {}).get("values", {})
            name = values.get("block_skill_name", {}).get("input_skill_name", {}).get("value")
            description = values.get("block_skill_desc", {}).get("input_skill_desc", {}).get("value")
            source_code = values.get("block_skill_source", {}).get("input_skill_source", {}).get("value")
            
            from src.core.tools.skill_control import SkillControl
            try:
                res = await SkillControl.create_skill(
                    workspace_id=workspace.id,
                    name=name,
                    description=description,
                    source_code=source_code,
                    entrypoint="handler"
                )
                if res.get("status") == "success":
                    confirm_text = (
                        f"🧠 *New Cognitive Skill successfully created & verified!*\n"
                        f"• *Name:* `{res['skill']['name']}`\n"
                        f"• *Description:* _{res['skill']['description']}_\n"
                        f"• *Status:* `ACTIVE`"
                    )
                else:
                    confirm_text = f"❌ *Failed to create skill:* {res.get('message')}"
            except Exception as e:
                confirm_text = f"❌ *Failed to create skill:* {str(e)}"
                
            if target_channel:
                await slack_client.post_message(
                    channel_id=target_channel,
                    text=confirm_text
                )

        # Acknowledge submission and close the modal
        return JSONResponse({"response_action": "clear"})

    elif payload_type == "block_actions":
        actions = payload.get("actions", [])
        trigger_id = payload.get("trigger_id")
        
        for action in actions:
            action_id = action.get("action_id")
            logger.info(f"Processing action_id: {action_id}")
            
            if action_id == "huddle_post_update":
                # User clicked "Post Update" button on standup card
                message_ts = payload.get("container", {}).get("message_ts") or payload.get("message", {}).get("ts")
                thread_ts = payload.get("message", {}).get("thread_ts") or message_ts
                
                modal_view = {
                    "type": "modal",
                    "callback_id": "standup_modal",
                    "title": {"type": "plain_text", "text": "Standup Check-in"},
                    "submit": {"type": "plain_text", "text": "Post Update"},
                    "close": {"type": "plain_text", "text": "Cancel"},
                    "private_metadata": json.dumps({"channel_id": channel_id, "thread_ts": thread_ts}),
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "📝 *Share your updates with the team.* Your responses will be formatted and posted in the standup thread."
                            }
                        },
                        {
                            "type": "input",
                            "block_id": "block_yesterday",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "input_yesterday",
                                "multiline": True,
                                "placeholder": {"type": "plain_text", "text": "What did you accomplish yesterday?"}
                            },
                            "label": {"type": "plain_text", "text": "Yesterday"}
                        },
                        {
                            "type": "input",
                            "block_id": "block_today",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "input_today",
                                "multiline": True,
                                "placeholder": {"type": "plain_text", "text": "What are you focusing on today?"}
                            },
                            "label": {"type": "plain_text", "text": "Today"}
                        },
                        {
                            "type": "input",
                            "block_id": "block_blockers",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "input_blockers",
                                "multiline": True,
                                "placeholder": {"type": "plain_text", "text": "Any blockers? (Type 'None' if clear)"}
                            },
                            "label": {"type": "plain_text", "text": "Blockers / Impediments"},
                            "optional": True
                        }
                    ]
                }
                
                if trigger_id:
                    try:
                        await slack_client.open_view(trigger_id, modal_view)
                    except Exception as e:
                        logger.error(f"Failed to open standup modal: {e}")
                        
            elif action_id == "huddle_excuse":
                # User clicked "Excuse Me" button on standup card
                message_ts = payload.get("container", {}).get("message_ts") or payload.get("message", {}).get("ts")
                thread_ts = payload.get("message", {}).get("thread_ts") or message_ts
                
                random_excuse = random.choice(CORPORATE_EXCUSES)
                
                modal_view = {
                    "type": "modal",
                    "callback_id": "excuse_modal",
                    "title": {"type": "plain_text", "text": "Excuse Me"},
                    "submit": {"type": "plain_text", "text": "Post Excuse"},
                    "close": {"type": "plain_text", "text": "Cancel"},
                    "private_metadata": json.dumps({"channel_id": channel_id, "thread_ts": thread_ts}),
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "🤖 *Oh dear! Can't make it to today's huddle?*\nReview or customize your excuse below, or click *Regenerate* to cycle through developer excuses."
                            }
                        },
                        {
                            "type": "input",
                            "block_id": "block_excuse_text",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "input_excuse_text",
                                "multiline": True,
                                "initial_value": random_excuse
                            },
                            "label": {"type": "plain_text", "text": "Excuse Reason"}
                        },
                        {
                            "type": "actions",
                            "block_id": "block_excuse_actions",
                            "elements": [
                                {
                                    "type": "button",
                                    "text": {"type": "plain_text", "text": "🔄 Regenerate Excuse"},
                                    "action_id": "regenerate_excuse"
                                }
                            ]
                        }
                    ]
                }
                
                if trigger_id:
                    try:
                        await slack_client.open_view(trigger_id, modal_view)
                    except Exception as e:
                        logger.error(f"Failed to open excuse modal: {e}")
                        
            elif action_id == "regenerate_excuse":
                # User clicked "Regenerate Excuse" inside the Excuse modal
                view = payload.get("view", {})
                view_id = view.get("id")
                private_metadata_str = view.get("private_metadata", "{}")
                
                random_excuse = random.choice(CORPORATE_EXCUSES)
                
                updated_view = {
                    "type": "modal",
                    "callback_id": "excuse_modal",
                    "title": {"type": "plain_text", "text": "Excuse Me"},
                    "submit": {"type": "plain_text", "text": "Post Excuse"},
                    "close": {"type": "plain_text", "text": "Cancel"},
                    "private_metadata": private_metadata_str,
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "🤖 *Oh dear! Can't make it to today's huddle?*\nReview or customize your excuse below, or click *Regenerate* to cycle through developer excuses."
                            }
                        },
                        {
                            "type": "input",
                            "block_id": "block_excuse_text",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "input_excuse_text",
                                "multiline": True,
                                "initial_value": random_excuse
                            },
                            "label": {"type": "plain_text", "text": "Excuse Reason"}
                        },
                        {
                            "type": "actions",
                            "block_id": "block_excuse_actions",
                            "elements": [
                                {
                                    "type": "button",
                                    "text": {"type": "plain_text", "text": "🔄 Regenerate Excuse"},
                                    "action_id": "regenerate_excuse"
                                }
                            ]
                        }
                    ]
                }
                
                if view_id:
                    try:
                        await slack_client.update_view(view_id=view_id, view=updated_view)
                    except Exception as e:
                        logger.error(f"Failed to update excuse modal view: {e}")
                        
            elif action_id == "task_convert_dashboard":
                # User clicked "Log as Workspace Task" on a thread summary card
                message = payload.get("message", {})
                message_ts = message.get("ts")
                thread_ts = message.get("thread_ts") or message_ts
                
                text_to_log = "Action item extracted from thread"
                blocks = message.get("blocks", [])
                for block in blocks:
                    if block.get("type") == "section" and block.get("text", {}).get("type") == "mrkdwn":
                        txt = block.get("text", {}).get("text", "")
                        if "Action Item" in txt or "Extracted" in txt or "Summary" in txt:
                            text_to_log = txt
                            break
                            
                clean_text = text_to_log.replace("*", "").replace("_", "").replace("•", "-").strip()
                if len(clean_text) > 150:
                    clean_text = clean_text[:147] + "..."
                    
                modal_view = {
                    "type": "modal",
                    "callback_id": "task_creation_modal",
                    "title": {"type": "plain_text", "text": "Log Workspace Task"},
                    "submit": {"type": "plain_text", "text": "Create Task"},
                    "close": {"type": "plain_text", "text": "Cancel"},
                    "private_metadata": json.dumps({"channel_id": channel_id, "thread_ts": thread_ts}),
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "💾 *Log an action item directly to your Klawhub Workspace task board.*"
                            }
                        },
                        {
                            "type": "input",
                            "block_id": "block_task_request",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "input_task_request",
                                "multiline": True,
                                "initial_value": clean_text,
                                "placeholder": {"type": "plain_text", "text": "Describe the task request..."}
                            },
                            "label": {"type": "plain_text", "text": "Task Request"}
                        },
                        {
                            "type": "input",
                            "block_id": "block_task_type",
                            "element": {
                                "type": "static_select",
                                "action_id": "input_task_type",
                                "initial_option": {
                                    "text": {"type": "plain_text", "text": "Action Item"},
                                    "value": "action_item"
                                },
                                "options": [
                                    {
                                        "text": {"type": "plain_text", "text": "Action Item"},
                                        "value": "action_item"
                                    },
                                    {
                                        "text": {"type": "plain_text", "text": "Bug Fix"},
                                        "value": "bug_fix"
                                    },
                                    {
                                        "text": {"type": "plain_text", "text": "Research"},
                                        "value": "research"
                                    },
                                    {
                                        "text": {"type": "plain_text", "text": "Feature Request"},
                                        "value": "feature_request"
                                    }
                                ]
                            },
                            "label": {"type": "plain_text", "text": "Task Category"}
                        }
                    ]
                }
                
                if trigger_id:
                    try:
                        await slack_client.open_view(trigger_id, modal_view)
                    except Exception as e:
                        logger.error(f"Failed to open task creation modal: {e}")
                        
            elif action_id == "task_assign_me":
                # Assign to me button clicked
                message = payload.get("message", {})
                message_ts = message.get("ts")
                thread_ts = message.get("thread_ts") or message_ts
                
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "in_channel",
                        "replace_original": False,
                        "text": f"👤 <@{user_id}> has claimed an action item in this thread! :muscle:"
                    })
                        
            elif action_id == "task_done":
                # Mark done button clicked
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "in_channel",
                        "replace_original": False,
                        "text": f"✅ An action item in this thread was marked as completed by <@{user_id}>! :tada:"
                    })
                        
            elif action_id == "schedule_pause":
                schedule_id = action.get("value")
                from src.core.tools.schedule_control import ScheduleControl
                await ScheduleControl.toggle_schedule_status(workspace.id, uuid.UUID(schedule_id), False)
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "ephemeral",
                        "replace_original": False,
                        "text": "⏸️ Schedule paused successfully!"
                    })
                        
            elif action_id == "schedule_resume":
                schedule_id = action.get("value")
                from src.core.tools.schedule_control import ScheduleControl
                await ScheduleControl.toggle_schedule_status(workspace.id, uuid.UUID(schedule_id), True)
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "ephemeral",
                        "replace_original": False,
                        "text": "▶️ Schedule reactivated successfully!"
                    })
                        
            elif action_id == "schedule_delete":
                schedule_id = action.get("value")
                from src.core.tools.schedule_control import ScheduleControl
                await ScheduleControl.delete_schedule(workspace.id, uuid.UUID(schedule_id))
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "ephemeral",
                        "replace_original": False,
                        "text": "🗑️ Schedule deleted successfully!"
                    })
                        
            elif action_id == "schedule_create_modal":
                if trigger_id:
                    modal_view = build_schedule_creation_modal(workspace.id, channel_id)
                    try:
                        await slack_client.open_view(trigger_id, modal_view)
                    except Exception as e:
                        logger.error(f"Failed to open schedule creation modal from button click: {e}")
                        
            elif action_id == "skill_pause":
                skill_id = action.get("value")
                from src.core.tools.skill_control import SkillControl
                await SkillControl.toggle_skill_status(workspace.id, uuid.UUID(skill_id), False)
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "ephemeral",
                        "replace_original": False,
                        "text": "⏸️ Cognitive skill paused successfully!"
                    })
                        
            elif action_id == "skill_resume":
                skill_id = action.get("value")
                from src.core.tools.skill_control import SkillControl
                await SkillControl.toggle_skill_status(workspace.id, uuid.UUID(skill_id), True)
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "ephemeral",
                        "replace_original": False,
                        "text": "▶️ Cognitive skill reactivated successfully!"
                    })
                        
            elif action_id == "skill_delete":
                skill_id = action.get("value")
                from src.core.tools.skill_control import SkillControl
                await SkillControl.delete_skill(workspace.id, uuid.UUID(skill_id))
                if response_url:
                    await http_client.post(response_url, json={
                        "response_type": "ephemeral",
                        "replace_original": False,
                        "text": "🗑️ Cognitive skill deleted successfully!"
                    })
                        
            elif action_id == "skill_create_modal":
                if trigger_id:
                    modal_view = build_skill_creation_modal(workspace.id, channel_id)
                    try:
                        await slack_client.open_view(trigger_id, modal_view)
                    except Exception as e:
                        logger.error(f"Failed to open skill creation modal from button click: {e}")
                        
            elif action_id.startswith("run_skill_"):
                skill_val = action.get("value")
                skill_name, thread_ts = skill_val.split(":", 1)
                
                if response_url:
                    try:
                        await http_client.post(response_url, json={
                            "replace_original": True,
                            "text": f"🚀 *Executing Cognitive Skill `{skill_name}` inside the Modal cloud sandbox...*"
                        })
                    except Exception as e:
                        logger.error(f"Failed to update suggestion card: {e}")
                
                # Retrieve the custom skill from PostgreSQL DB
                from src.db.models import Skill, PendingAction
                async with get_db_session() as session:
                    statement = select(Skill).where(
                        Skill.workspace_id == workspace.id,
                        Skill.name == skill_name,
                        Skill.is_active == True
                    )
                    skill_db = (await session.execute(statement)).scalar_one_or_none()
                
                if skill_db:
                    # Create a pre-approved PendingAction in the database to execute it immediately
                    pre_approved_action = PendingAction(
                        workspace_id=workspace.id,
                        slack_user_id=user_id,
                        slack_channel_id=channel_id,
                        tool_name="modal_sandbox",
                        params={"code": skill_db.source_code, "milestone": f"Execute custom skill: {skill_name}", "thread_ts": thread_ts},
                        status="approved"
                    )
                    async with get_db_session() as session:
                        session.add(pre_approved_action)
                        await session.commit()
                
                # Dispatch event to Inngest
                await inngest_client.send(
                    inngest.Event(
                        name="slack/event.received",
                        data={
                            "event": {
                                "type": "message",
                                "channel": channel_id,
                                "ts": thread_ts,
                                "thread_ts": thread_ts,
                                "text": f"execute skill {skill_name}",
                                "user": user_id
                            },
                            "eventId": str(uuid.uuid4()),
                            "teamId": team_id
                        }
                    )
                )
                
            elif action_id == "dismiss_suggestion":
                if response_url:
                    try:
                        await http_client.post(response_url, json={
                            "replace_original": True,
                            "text": "Dismissed. Let me know if you need any other help! 😊"
                        })
                    except Exception as e:
                        logger.error(f"Failed to update dismiss card: {e}")
                        
            elif action_id == "approve_action":
                action_id_str = action.get("value")
                from src.db.models import PendingAction
                
                original_request = None
                async with get_db_session() as session:
                    statement = select(PendingAction).where(
                        PendingAction.id == uuid.UUID(action_id_str),
                        PendingAction.workspace_id == workspace.id
                    )
                    db_act = (await session.execute(statement)).scalar_one_or_none()
                    if db_act:
                        db_act.status = "approved"
                        db_act.updated_at = datetime.utcnow()
                        original_request = db_act.params.get("milestone") or db_act.params.get("request")
                        await session.commit()
                    else:
                        logger.warning(f"Approval requested for unknown or cross-workspace PendingAction {action_id_str}")
                        
                # Update Slack card to remove huddle buttons and show success
                if response_url:
                    try:
                        await http_client.post(response_url, json={
                            "replace_original": True,
                            "text": "✅ *Sandbox Action Approved!* Coworker is compiling and executing the script now... 🚀"
                        })
                    except Exception as e:
                        logger.error(f"Failed to update Slack approval card: {e}")
                
                # Simulate Slack message event to re-trigger graph execution asynchronously in Inngest
                logger.info("Re-dispatching slack/event.received event to Inngest for thread huddle approval continuation...")
                msg_ts = payload.get("container", {}).get("message_ts") or payload.get("message", {}).get("ts")
                thread_ts = payload.get("message", {}).get("thread_ts") or msg_ts
                
                await inngest_client.send(
                    inngest.Event(
                        name="slack/event.received",
                        data={
                            "event": {
                                "type": "message",
                                "channel": channel_id,
                                "ts": msg_ts,
                                "thread_ts": thread_ts,
                                "text": "Action Approved",
                                "user": user_id
                            },
                            "eventId": str(uuid.uuid4()),
                            "teamId": team_id,
                            "continuationType": "modal_sandbox_approval",
                            "approvedActionId": action_id_str,
                            "originalRequest": original_request
                        }
                    )
                )
                
            elif action_id == "reject_action":
                action_id_str = action.get("value")
                from src.db.models import PendingAction
                
                async with get_db_session() as session:
                    statement = select(PendingAction).where(PendingAction.id == uuid.UUID(action_id_str))
                    db_act = (await session.execute(statement)).scalar_one_or_none()
                    if db_act:
                        db_act.status = "rejected"
                        db_act.updated_at = datetime.utcnow()
                        await session.commit()
                        
                # Update Slack card to remove huddle buttons and show rejection
                if response_url:
                    try:
                        await http_client.post(response_url, json={
                            "replace_original": True,
                            "text": "❌ *Sandbox Action Rejected* by the user."
                        })
                    except Exception as e:
                        logger.error(f"Failed to update Slack rejection card: {e}")
                        
    return {"ok": True}
