"""
verify_slack_interactions.py — Phase 6 E2E Test 5
==================================================
Validates all aspects of the secure Klawhub Slack Interactions & Overhauled Slack Coworker Behaviors:
1. `/klawhub configure` and `/klawhub settings` slash commands open the Coworker Configuration Modal.
2. Block actions like 'huddle_post_update', 'huddle_excuse', 'regenerate_excuse', and 'task_convert_dashboard' open/update the respective modal views.
3. Block actions like 'task_assign_me' and 'task_done' post interactive confirmation cards back to Slack via the response_url.
4. Modal submissions for settings update, standup check-in, huddle excuse, and task creation.
5. Absolute multi-tenant database isolation inside view submissions (verifying settings persist and tasks insert correctly scoped to the workspace).
6. Smart Thread Replies fetching, bot self-message exclusion, and premium Block Kit thread synthesis card compiling.
"""
import os
import sys
import time
import json
import uuid
import hmac
import hashlib
import asyncio
import logging
from unittest.mock import AsyncMock, patch, MagicMock

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# SQLAlchemy custom SQLite overrides for PostgreSQL-specific types
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "TEXT"

@compiles(PG_UUID, "sqlite")
def compile_uuid_sqlite(type_, compiler, **kw):
    return "TEXT"

# Setup mock environment variables before importing src modules
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["UPSTASH_REDIS_REST_URL"] = "https://mock-redis.upstash.io"
os.environ["UPSTASH_REDIS_REST_TOKEN"] = "mock_token"
os.environ["SLACK_SIGNING_SECRET"] = "test_slack_signing_secret_xyz"
os.environ["SLACK_BOT_TOKEN"] = "xoxb-mock-bot-token"
os.environ["MODAL_FUNCTION_URL"] = "https://mock-modal.run"
os.environ["MODAL_WEBHOOK_SECRET"] = "mock_modal_secret"
os.environ["INTEGRATION_ENCRYPTION_KEY"] = "mock_integration_encryption_key_32_bytes!!"
os.environ["STATE_SIGNING_KEY"] = "test_state_signing_key_secure_12345"
os.environ["INNGEST_SIGNING_KEY"] = "signkey_mock_12345"
os.environ["INNGEST_EVENT_KEY"] = "eventkey_mock_12345"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("verify_slack_interactions")

from sqlmodel import SQLModel, select
from httpx import AsyncClient, ASGITransport
import inngest
from src.db.pool import async_engine, get_db_session
from src.db.models import Workspace, Task, Run, Schedule
from src.integrations.providers.slack.client import SlackClient

# Custom Inngest Event Mock for testing the handlers directly
class MockStep:
    async def run(self, step_id, fn, *args, **kwargs):
        if asyncio.iscoroutinefunction(fn):
            return await fn(*args, **kwargs)
        elif callable(fn):
            return fn(*args, **kwargs)
        return fn

class MockContext:
    def __init__(self, event_data):
        self.event = inngest.Event(
            name="slack/event.received",
            data=event_data,
            id=event_data.get("eventId", str(uuid.uuid4()))
        )
        self.step = MockStep()


async def bootstrap_db():
    """Create all tables in the in-memory SQLite database."""
    # Strip postgres-specific server_default expressions
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            column.server_default = None

    async with async_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    logger.info("In-memory database schema initialized.")


async def setup_test_data() -> Workspace:
    """Inserts a registered workspace for interaction tests."""
    async with get_db_session() as session:
        ws = Workspace(
            id=uuid.uuid4(),
            slack_team_id="T_SLACK_TEST",
            slack_bot_user_id="U_BOT_123",
            bot_token="xoxb-test-token-123",
            name="Slack Test Corp",
            plan="growth",
            monthly_run_limit=500,
            is_active=True,
            agent_name="TestBot",
            agent_personality="Helpful AI Coworker",
            enabled_skills=["web_search"]
        )
        session.add(ws)
        await session.commit()
        await session.refresh(ws)
        logger.info(f"Test Workspace '{ws.name}' ({ws.id}) bootstrapped.")
        return ws


def generate_slack_headers(body: bytes, timestamp: int = None) -> dict:
    """Computes a valid Slack signature for testing."""
    if timestamp is None:
        timestamp = int(time.time())
    secret = os.environ["SLACK_SIGNING_SECRET"]
    sig_basestring = f"v0:{timestamp}:".encode("utf-8") + body
    signature = "v0=" + hmac.new(
        secret.encode("utf-8"),
        sig_basestring,
        hashlib.sha256
    ).hexdigest()
    
    return {
        "X-Slack-Request-Timestamp": str(timestamp),
        "X-Slack-Signature": signature
    }


async def test_slash_command_configure(workspace: Workspace):
    """Test 1: '/klawhub configure' triggers SlackClient.open_view with correct modal view."""
    logger.info("=" * 60)
    logger.info("TEST 1: Slash Command /klawhub configure")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    # Mock SlackClient open_view
    open_view_mock = AsyncMock(return_value={"ok": True})
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        form_data = {
            "command": "/klawhub",
            "text": "configure",
            "team_id": workspace.slack_team_id,
            "channel_id": "C_CHANNEL_1",
            "user_id": "U_USER_123",
            "trigger_id": "trig_123"
        }
        import urllib.parse
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers = generate_slack_headers(body)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        
        with patch.object(SlackClient, "open_view", open_view_mock):
            resp = await client.post("/api/slack/commands", content=body, headers=headers)
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
            
            # Assert open_view was called
            open_view_mock.assert_called_once()
            called_trig_id, called_view = open_view_mock.call_args[0]
            assert called_trig_id == "trig_123"
            assert called_view["callback_id"] == "settings_modal"
            assert called_view["type"] == "modal"
            
            # Verify private metadata carries context
            meta = json.loads(called_view["private_metadata"])
            assert meta["channel_id"] == "C_CHANNEL_1"
            assert meta["workspace_id"] == str(workspace.id)
            
            # Verify fields populated with current workspace values
            blocks = called_view["blocks"]
            assert blocks[1]["element"]["initial_value"] == "TestBot"
            assert blocks[2]["element"]["initial_value"] == "Helpful AI Coworker"
            
            logger.info("  [PASS] /klawhub configure successfully triggered settings modal with correct context.")


async def test_block_action_huddle_post_update(workspace: Workspace):
    """Test 2: Block action 'huddle_post_update' opens standup check-in modal."""
    logger.info("=" * 60)
    logger.info("TEST 2: Block Action 'huddle_post_update'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    open_view_mock = AsyncMock(return_value={"ok": True})
    
    action_payload = {
        "type": "block_actions",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "channel": {"id": "C_CHANNEL_1"},
        "trigger_id": "trig_huddle_123",
        "actions": [
            {
                "action_id": "huddle_post_update",
                "block_id": "b1",
                "type": "button"
            }
        ],
        "message": {
            "ts": "1111111.11111",
            "thread_ts": "2222222.22222"
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(action_payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "open_view", open_view_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
            open_view_mock.assert_called_once()
            called_trig_id, called_view = open_view_mock.call_args[0]
            assert called_trig_id == "trig_huddle_123"
            assert called_view["callback_id"] == "standup_modal"
            
            meta = json.loads(called_view["private_metadata"])
            assert meta["channel_id"] == "C_CHANNEL_1"
            assert meta["thread_ts"] == "2222222.22222"
            
            logger.info("  [PASS] Block action 'huddle_post_update' successfully opened standup modal.")


async def test_block_action_huddle_excuse(workspace: Workspace):
    """Test 3: Block action 'huddle_excuse' opens excuse modal with a pre-filled corporate excuse."""
    logger.info("=" * 60)
    logger.info("TEST 3: Block Action 'huddle_excuse'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    open_view_mock = AsyncMock(return_value={"ok": True})
    
    action_payload = {
        "type": "block_actions",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "channel": {"id": "C_CHANNEL_1"},
        "trigger_id": "trig_excuse_123",
        "actions": [
            {
                "action_id": "huddle_excuse",
                "block_id": "b1",
                "type": "button"
            }
        ],
        "message": {
            "ts": "1111111.11111"
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(action_payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "open_view", open_view_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
            open_view_mock.assert_called_once()
            called_trig_id, called_view = open_view_mock.call_args[0]
            assert called_trig_id == "trig_excuse_123"
            assert called_view["callback_id"] == "excuse_modal"
            
            # Check the initial excuse is injected
            blocks = called_view["blocks"]
            excuse_text = blocks[1]["element"]["initial_value"]
            assert len(excuse_text) > 0
            logger.info(f"  Pre-filled excuse: '{excuse_text}'")
            
            logger.info("  [PASS] Block action 'huddle_excuse' successfully opened excuse modal with pre-filled corporate excuse.")


async def test_block_action_regenerate_excuse(workspace: Workspace):
    """Test 4: Block action 'regenerate_excuse' updates excuse modal view in-place."""
    logger.info("=" * 60)
    logger.info("TEST 4: Block Action 'regenerate_excuse'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    update_view_mock = AsyncMock(return_value={"ok": True})
    
    action_payload = {
        "type": "block_actions",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "actions": [
            {
                "action_id": "regenerate_excuse",
                "block_id": "b1",
                "type": "button"
            }
        ],
        "view": {
            "id": "view_excuse_123",
            "private_metadata": json.dumps({"channel_id": "C_CHANNEL_1", "thread_ts": "111111.11111"})
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(action_payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "update_view", update_view_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
            update_view_mock.assert_called_once()
            called_kwargs = update_view_mock.call_args[1]
            assert called_kwargs["view_id"] == "view_excuse_123"
            assert called_kwargs["view"]["callback_id"] == "excuse_modal"
            
            # Check private metadata is preserved
            meta = json.loads(called_kwargs["view"]["private_metadata"])
            assert meta["channel_id"] == "C_CHANNEL_1"
            assert meta["thread_ts"] == "111111.11111"
            
            logger.info("  [PASS] Block action 'regenerate_excuse' successfully updated excuse modal in-place.")


async def test_block_action_task_convert_dashboard(workspace: Workspace):
    """Test 5: Block action 'task_convert_dashboard' opens task creation modal pre-populated with summary text."""
    logger.info("=" * 60)
    logger.info("TEST 5: Block Action 'task_convert_dashboard'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    open_view_mock = AsyncMock(return_value={"ok": True})
    
    action_payload = {
        "type": "block_actions",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "channel": {"id": "C_CHANNEL_1"},
        "trigger_id": "trig_task_123",
        "actions": [
            {
                "action_id": "task_convert_dashboard",
                "block_id": "b1",
                "type": "button"
            }
        ],
        "message": {
            "ts": "1111111.11111",
            "thread_ts": "2222222.22222",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "📖 *Thread Summary:* Extracted Action Items:\n• Integrate OAuth with sandbox\n• Deploy Modal apps"
                    }
                }
            ]
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(action_payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "open_view", open_view_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
            open_view_mock.assert_called_once()
            called_trig_id, called_view = open_view_mock.call_args[0]
            assert called_trig_id == "trig_task_123"
            assert called_view["callback_id"] == "task_creation_modal"
            
            # Check the initial request matches parsed text
            blocks = called_view["blocks"]
            task_req = blocks[1]["element"]["initial_value"]
            assert "OAuth" in task_req
            assert "Modal" in task_req
            logger.info(f"  Pre-populated task request: '{task_req}'")
            
            logger.info("  [PASS] Block action 'task_convert_dashboard' successfully opened pre-filled task modal.")


async def test_block_actions_claim_and_done(workspace: Workspace):
    """Test 6: Block actions 'task_assign_me' and 'task_done' post ephemerals back via response_url."""
    logger.info("=" * 60)
    logger.info("TEST 6: Block Actions Claim and Complete Webhooks")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    import httpx
    original_post = httpx.AsyncClient.post
    intercepted_posts = []
    
    async def mock_httpx_post(self, url, *args, **kwargs):
        if "hooks.slack.com" in str(url):
            intercepted_posts.append((url, kwargs))
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            return mock_resp
        return await original_post(self, url, *args, **kwargs)
        
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Assign to me
        payload = {
            "type": "block_actions",
            "user": {"id": "U_USER_123"},
            "team": {"id": workspace.slack_team_id},
            "response_url": "https://hooks.slack.com/actions/T123/C123/CLAIM",
            "actions": [{"action_id": "task_assign_me"}]
        }
        form_data = {"payload": json.dumps(payload)}
        import urllib.parse
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers = generate_slack_headers(body)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        
        with patch("httpx.AsyncClient.post", mock_httpx_post):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
        # 2. Done
        payload["response_url"] = "https://hooks.slack.com/actions/T123/C123/DONE"
        payload["actions"] = [{"action_id": "task_done"}]
        form_data = {"payload": json.dumps(payload)}
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers = generate_slack_headers(body)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        
        with patch("httpx.AsyncClient.post", mock_httpx_post):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
        assert len(intercepted_posts) == 2
        assert intercepted_posts[0][0] == "https://hooks.slack.com/actions/T123/C123/CLAIM"
        assert "claimed" in intercepted_posts[0][1]["json"]["text"]
        
        assert intercepted_posts[1][0] == "https://hooks.slack.com/actions/T123/C123/DONE"
        assert "completed" in intercepted_posts[1][1]["json"]["text"]
        
        logger.info("  [PASS] Block actions 'task_assign_me' and 'task_done' successfully updated threads via response webhooks.")


async def test_view_submission_settings(workspace: Workspace):
    """Test 7: Settings Modal submission updates DB workspace details and posts channel confirmation."""
    logger.info("=" * 60)
    logger.info("TEST 7: View Submission 'settings_modal'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    post_message_mock = AsyncMock(return_value={"ok": True})
    
    payload = {
        "type": "view_submission",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "view": {
            "callback_id": "settings_modal",
            "private_metadata": json.dumps({"channel_id": "C_CHANNEL_1", "workspace_id": str(workspace.id)}),
            "state": {
                "values": {
                    "block_agent_name": {
                        "input_agent_name": {"value": "SuperBot"}
                    },
                    "block_agent_personality": {
                        "input_agent_personality": {"value": "Super efficiency hacker coworker."}
                    },
                    "block_enabled_skills": {
                        "input_enabled_skills": {
                            "selected_options": [
                                {"value": "web_search"},
                                {"value": "python_sandbox"}
                            ]
                        }
                    }
                }
            }
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "post_message", post_message_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            assert resp.json() == {"response_action": "clear"}
            
            # Verify database workspace identity is persisted
            async with get_db_session() as session:
                statement = select(Workspace).where(Workspace.id == workspace.id)
                ws_db = (await session.execute(statement)).scalar_one()
                assert ws_db.agent_name == "SuperBot"
                assert ws_db.agent_personality == "Super efficiency hacker coworker."
                assert "web_search" in ws_db.enabled_skills
                assert "python_sandbox" in ws_db.enabled_skills
                
            # Verify confirmation card is posted to Slack
            post_message_mock.assert_called_once()
            called_chan, called_text = post_message_mock.call_args[1].values()
            assert called_chan == "C_CHANNEL_1"
            assert "Synchronized" in called_text
            assert "SuperBot" in called_text
            
            logger.info("  [PASS] Settings view submission correctly updated SQLite DB and posted Slack confirmation.")


async def test_view_submission_standup(workspace: Workspace):
    """Test 8: Standup Modal submission posts check-in report card."""
    logger.info("=" * 60)
    logger.info("TEST 8: View Submission 'standup_modal'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    post_message_mock = AsyncMock(return_value={"ok": True})
    
    payload = {
        "type": "view_submission",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "view": {
            "callback_id": "standup_modal",
            "private_metadata": json.dumps({"channel_id": "C_CHANNEL_1", "thread_ts": "111111.22222"}),
            "state": {
                "values": {
                    "block_yesterday": {
                        "input_yesterday": {"value": "Completed the Inngest cron runner."}
                    },
                    "block_today": {
                        "input_today": {"value": "Writing comprehensive interaction E2E tests."}
                    },
                    "block_blockers": {
                        "input_blockers": {"value": "None"}
                    }
                }
            }
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "post_message", post_message_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
            post_message_mock.assert_called_once()
            called_kwargs = post_message_mock.call_args[1]
            assert called_kwargs["channel_id"] == "C_CHANNEL_1"
            assert called_kwargs["thread_ts"] == "111111.22222"
            
            blocks = called_kwargs["blocks"]
            assert blocks[0]["text"]["text"] == "📝 Standup Check-in Complete"
            assert "Accomplished Yesterday" in blocks[3]["text"]["text"]
            assert "Focusing on Today" in blocks[4]["text"]["text"]
            
            logger.info("  [PASS] Standup check-in view submission cleanly formatted and posted check-in report.")


async def test_view_submission_excuse(workspace: Workspace):
    """Test 9: Excuse Modal submission posts excused notice card."""
    logger.info("=" * 60)
    logger.info("TEST 9: View Submission 'excuse_modal'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    post_message_mock = AsyncMock(return_value={"ok": True})
    
    payload = {
        "type": "view_submission",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "view": {
            "callback_id": "excuse_modal",
            "private_metadata": json.dumps({"channel_id": "C_CHANNEL_1", "thread_ts": "111111.22222"}),
            "state": {
                "values": {
                    "block_excuse_text": {
                        "input_excuse_text": {"value": "My laptop indexer got stuck in a node_modules blackhole."}
                    }
                }
            }
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "post_message", post_message_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
            post_message_mock.assert_called_once()
            called_kwargs = post_message_mock.call_args[1]
            assert called_kwargs["channel_id"] == "C_CHANNEL_1"
            assert called_kwargs["thread_ts"] == "111111.22222"
            
            blocks = called_kwargs["blocks"]
            assert "excused from today" in blocks[0]["text"]["text"]
            assert "node_modules" in blocks[0]["text"]["text"]
            
            logger.info("  [PASS] Excuse view submission successfully posted excused notice card.")


async def test_view_submission_task_creation(workspace: Workspace):
    """Test 10: Task Creation Modal submission registers a Task DB record and posts confirmation."""
    logger.info("=" * 60)
    logger.info("TEST 10: View Submission 'task_creation_modal'")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    post_message_mock = AsyncMock(return_value={"ok": True})
    
    payload = {
        "type": "view_submission",
        "user": {"id": "U_USER_123"},
        "team": {"id": workspace.slack_team_id},
        "view": {
            "callback_id": "task_creation_modal",
            "private_metadata": json.dumps({"channel_id": "C_CHANNEL_1", "thread_ts": "111111.22222"}),
            "state": {
                "values": {
                    "block_task_request": {
                        "input_task_request": {"value": "Deploy verified slack interactives to Modal"}
                    },
                    "block_task_type": {
                        "input_task_type": {
                            "selected_option": {"value": "feature_request"}
                        }
                    }
                }
            }
        }
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        with patch.object(SlackClient, "post_message", post_message_mock):
            resp = await client.post("/api/slack/actions", content=body, headers=headers)
            assert resp.status_code == 200
            
            # Verify database has the newly created task
            async with get_db_session() as session:
                statement = select(Task).where(Task.workspace_id == workspace.id)
                tasks_db = (await session.execute(statement)).scalars().all()
                assert len(tasks_db) == 1
                new_t = tasks_db[0]
                assert new_t.request == "Deploy verified slack interactives to Modal"
                assert new_t.type == "feature_request"
                assert new_t.status == "pending"
                assert new_t.slack_channel_id == "C_CHANNEL_1"
                assert new_t.slack_thread_ts == "111111.22222"
                
            # Verify post_message was called
            post_message_mock.assert_called_once()
            called_kwargs = post_message_mock.call_args[1]
            assert called_kwargs["channel_id"] == "C_CHANNEL_1"
            assert called_kwargs["thread_ts"] == "111111.22222"
            assert "Action Item successfully converted" in called_kwargs["text"]
            assert str(new_t.id) in called_kwargs["text"]
            
            logger.info("  [PASS] Task Creation view submission registered task record in DB and returned confirmation.")


async def test_thread_replies_ingestion_and_synthesis(workspace: Workspace):
    """Test 11: Message handler thread summarize triggers replies fetch, excludes bots, invokes coworker agent, and posts Blocks."""
    logger.info("=" * 60)
    logger.info("TEST 11: Thread Replies Summarization Ingestion & Synthesis")
    logger.info("=" * 60)
    
    from src.workflows.message_handler import slack_message_handler
    
    # 1. Mock slack get_thread_replies returning transcript
    replies_mock = [
        {"user": "U_USER_A", "text": "We should deploy the code changes today.", "ts": "1"},
        {"user": "U_USER_B", "text": "Agreed, let's trigger verification scripts first.", "ts": "2"},
        {"user": "U_BOT_123", "text": "I am a bot message, I must be ignored.", "ts": "3", "bot_id": "B123"},
        {"user": "U_USER_A", "text": "Sounds like a solid plan. @TestBot summarize thread decisions please.", "ts": "4"}
    ]
    
    # Mock SlackClient methods
    get_thread_replies_mock = AsyncMock(return_value=replies_mock)
    add_reaction_mock = AsyncMock(return_value={"ok": True})
    remove_reaction_mock = AsyncMock(return_value={"ok": True})
    post_message_mock = AsyncMock(return_value={"ok": True})
    
    # Mock cognitive Graph coworker_app invoke
    mock_agent_output = "• **Decision:** Deploy code changes today.\n• **Action Item:** Trigger verification scripts first."
    mock_graph_invoke = AsyncMock(return_value={
        "worker_output": mock_agent_output,
        "errors": []
    })
    
    event_payload = {
        "event": {
            "type": "message",
            "channel": "C_CHANNEL_1",
            "ts": "111111.44444",
            "thread_ts": "111111.11111",
            "text": "<@U_BOT_123> summarize thread decisions please",
            "user": "U_USER_A"
        },
        "eventId": "ev_summary_99",
        "teamId": workspace.slack_team_id
    }
    
    ctx = MockContext(event_payload)
    
    with patch.object(SlackClient, "get_thread_replies", get_thread_replies_mock), \
         patch.object(SlackClient, "add_reaction", add_reaction_mock), \
         patch.object(SlackClient, "remove_reaction", remove_reaction_mock), \
         patch.object(SlackClient, "post_message", post_message_mock), \
         patch("src.core.agents.graph.coworker_app.ainvoke", mock_graph_invoke):
             
        await slack_message_handler._handler(ctx)
        
        # Verify get_thread_replies was called with the correct channel and thread_ts
        get_thread_replies_mock.assert_called_once_with("C_CHANNEL_1", "111111.11111")
        
        # Verify coworker agent was invoked with correct transcript query (bot self-message excluded)
        mock_graph_invoke.assert_called_once()
        invoked_state = mock_graph_invoke.call_args[0][0]
        assert "U_USER_A" in invoked_state["user_query"]
        assert "U_USER_B" in invoked_state["user_query"]
        assert "U_BOT_123" not in invoked_state["user_query"] # Assert Bot self-message got excluded from transcript
        
        # Verify eyes reaction was managed
        add_reaction_mock.assert_called_once_with("C_CHANNEL_1", "111111.44444", "eyes")
        remove_reaction_mock.assert_called_once_with("C_CHANNEL_1", "111111.44444", "eyes")
        
        # Verify final response posted to thread contains interactive action keys
        post_message_mock.assert_called_once()
        called_kwargs = post_message_mock.call_args[1]
        assert called_kwargs["channel_id"] == "C_CHANNEL_1"
        assert called_kwargs["thread_ts"] == "111111.11111"
        
        blocks = called_kwargs["blocks"]
        assert blocks[0]["text"]["text"] == "📖 Thread Synthesis & Action Items"
        assert mock_agent_output in blocks[1]["text"]["text"]
        
        # Verify action elements exist
        actions = blocks[3]["elements"]
        action_ids = [act["action_id"] for act in actions]
        assert "task_assign_me" in action_ids
        assert "task_convert_dashboard" in action_ids
        assert "task_done" in action_ids
        
        logger.info("  [PASS] Thread replies fetched, bot message excluded, summarized, and posted with interactive action cards.")


async def main():
    await bootstrap_db()
    workspace = await setup_test_data()
    
    await test_slash_command_configure(workspace)
    await test_block_action_huddle_post_update(workspace)
    await test_block_action_huddle_excuse(workspace)
    await test_block_action_regenerate_excuse(workspace)
    await test_block_action_task_convert_dashboard(workspace)
    await test_block_actions_claim_and_done(workspace)
    
    await test_view_submission_settings(workspace)
    await test_view_submission_standup(workspace)
    await test_view_submission_excuse(workspace)
    await test_view_submission_task_creation(workspace)
    
    await test_thread_replies_ingestion_and_synthesis(workspace)
    
    logger.info("=" * 60)
    logger.info("[ALL TESTS PASSED] verify_slack_interactions.py completed successfully.")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
