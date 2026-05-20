"""
verify_slack_gateway.py — Phase 6 E2E Test 4
=============================================
Validates all aspects of the secure Klawhub Slack Gateway:
1. Cryptographic signature verification and replay protection.
2. Slack URL challenge verification handshakes.
3. DM event routing logic dispatches Inngest triggers.
4. Channel silence policy (no bot mentions are ignored).
5. Channel bot mentions strip tags and dispatch Inngest triggers.
6. Slash command '/klawhub status' compiles Block Kit telemetry.
7. Slash command '/klawhub help' serves guide cards.
8. Interactive actions handler intercepts and handles button callbacks.
9. Inngest discovery serve adapter is registered and queried successfully.
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
from unittest.mock import AsyncMock, patch

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
logger = logging.getLogger("verify_slack_gateway")

from sqlmodel import SQLModel, select
from httpx import AsyncClient, ASGITransport
from src.db.pool import async_engine, get_db_session
from src.db.models import Workspace, Run, Task, Schedule
from src.workflows.inngest_app import inngest_client


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
    """Inserts a registered, active Workspace along with mock runs and tasks for telemetry cards."""
    async with get_db_session() as session:
        # Create Active Workspace
        ws = Workspace(
            id=uuid.uuid4(),
            slack_team_id="T_SLACK_TEST",
            slack_bot_user_id="U_BOT_123",
            bot_token="xoxb-test-token-123",
            name="Test Slack Corp",
            plan="growth",
            monthly_run_limit=500,
            is_active=True,
            agent_name="Klawhub Agent",
            agent_personality="You are an elite productivity executive coworker.",
            enabled_skills=["web_search", "python_sandbox", "pdf_generator"]
        )
        session.add(ws)
        await session.commit()
        await session.refresh(ws)

        # Create mock telemetry items
        run1 = Run(
            workspace_id=ws.id,
            slack_user_id="U_USER_123",
            slack_channel_id="C_CHANNEL_1",
            request="Run a financial analytics chart",
            status="completed",
            code_language="python"
        )
        run2 = Run(
            workspace_id=ws.id,
            slack_user_id="U_USER_123",
            slack_channel_id="C_CHANNEL_1",
            request="Crawl recent documentation website",
            status="pending",
            code_language="python"
        )
        session.add(run1)
        session.add(run2)

        task1 = Task(
            workspace_id=ws.id,
            slack_user_id="U_USER_123",
            slack_channel_id="C_CHANNEL_1",
            type="document",
            request="Generate clean PDF invoice",
            status="completed"
        )
        session.add(task1)

        schedule1 = Schedule(
            workspace_id=ws.id,
            slack_user_id="U_USER_123",
            slack_team_id="T_SLACK_TEST",
            name="Daily standup tracker",
            cron_expr="0 9 * * 1-5",
            action="post_huddle",
            is_active=True
        )
        session.add(schedule1)
        
        await session.commit()
        logger.info(f"Test Workspace '{ws.name}' ({ws.id}) and telemetry bootstrapped.")
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


async def test_signature_verification_firewall():
    """Test 1: Signature verification and replay window enforcement."""
    logger.info("=" * 60)
    logger.info("TEST 1: Signature Verification Firewall")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Case A: Missing headers entirely
        resp = await client.post("/api/slack/events", content=b"{}")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        assert resp.json()["detail"] == "Missing signature headers"
        logger.info("  [PASS] Request with missing headers rejected with 401.")

        # Case B: Invalid timestamp format
        headers = {"X-Slack-Request-Timestamp": "not-a-number", "X-Slack-Signature": "sig"}
        resp = await client.post("/api/slack/events", content=b"{}", headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid timestamp format"
        logger.info("  [PASS] Request with malformed timestamp rejected.")

        # Case C: Expired timestamp (replay attack defense, 6 minutes old)
        six_minutes_ago = int(time.time()) - (60 * 6)
        headers = generate_slack_headers(b"{}", timestamp=six_minutes_ago)
        resp = await client.post("/api/slack/events", content=b"{}", headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Request timestamp too old"
        logger.info("  [PASS] Request with expired timestamp rejected.")

        # Case D: Correct timestamp but invalid signature hash
        timestamp = int(time.time())
        headers = {
            "X-Slack-Request-Timestamp": str(timestamp),
            "X-Slack-Signature": "v0=wrongsignaturehash1234567890"
        }
        resp = await client.post("/api/slack/events", content=b"{}", headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid signature"
        logger.info("  [PASS] Request with cryptographically invalid signature rejected.")


async def test_slack_challenge_handshake():
    """Test 2: Slack URL verification handshake (challenge)."""
    logger.info("=" * 60)
    logger.info("TEST 2: Slack Challenge Handshake")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        payload = {
            "type": "url_verification",
            "challenge": "mock_slack_challenge_token_abc123"
        }
        body = json.dumps(payload).encode("utf-8")
        headers = generate_slack_headers(body)
        
        resp = await client.post("/api/slack/events", content=body, headers=headers)
        assert resp.status_code == 200, f"Challenge failed: {resp.status_code}"
        assert resp.json() == {"challenge": "mock_slack_challenge_token_abc123"}
        logger.info("  [PASS] Handshake replied immediately with matching challenge token.")


async def test_dm_event_routing():
    """Test 3: Direct message event triggers Inngest events pipeline."""
    logger.info("=" * 60)
    logger.info("TEST 3: Direct Message Event Routing")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    # Capture calls to inngest_client.send
    inngest_client.send = AsyncMock()
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        payload = {
            "type": "event_callback",
            "team_id": "T_SLACK_TEST",
            "event_id": "ev_dm_101",
            "event": {
                "type": "message",
                "channel": "D_DM_CHANNEL_ABC",
                "channel_type": "im",
                "text": "Hello, please review my python code",
                "user": "U_USER_123"
            }
        }
        body = json.dumps(payload).encode("utf-8")
        headers = generate_slack_headers(body)
        
        resp = await client.post("/api/slack/events", content=body, headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        
        # Verify Inngest client was called with correct data
        inngest_client.send.assert_called_once()
        sent_event = inngest_client.send.call_args[0][0]
        
        assert sent_event.name == "slack/event.received"
        assert sent_event.id == "ev_dm_101"
        assert sent_event.data["teamId"] == "T_SLACK_TEST"
        assert sent_event.data["event"]["text"] == "Hello, please review my python code"
        assert sent_event.data["event"]["channel"] == "D_DM_CHANNEL_ABC"
        
        logger.info("  [PASS] DM event cleanly bypassed bot tags and successfully dispatched to Inngest.")


async def test_channel_silence_policy():
    """Test 4: Silence Policy ensures normal messages in channel are ignored."""
    logger.info("=" * 60)
    logger.info("TEST 4: Channel Silence Policy")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    inngest_client.send = AsyncMock()
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        payload = {
            "type": "event_callback",
            "team_id": "T_SLACK_TEST",
            "event_id": "ev_chan_silence",
            "event": {
                "type": "message",
                "channel": "C_PUBLIC_CHANNEL",
                "text": "Just talking to my team here",
                "user": "U_USER_123"
            }
        }
        body = json.dumps(payload).encode("utf-8")
        headers = generate_slack_headers(body)
        
        resp = await client.post("/api/slack/events", content=body, headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        
        # Assert Inngest client was NOT called
        inngest_client.send.assert_not_called()
        logger.info("  [PASS] Normal channel talk without mention was ignored silently.")


async def test_channel_mention_activation():
    """Test 5: Bot user ID mention activates coworker and strips mention XML."""
    logger.info("=" * 60)
    logger.info("TEST 5: Channel Mention Activation & Sanitization")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    inngest_client.send = AsyncMock()
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # The bot user id is U_BOT_123 as configured in workspace
        payload = {
            "type": "event_callback",
            "team_id": "T_SLACK_TEST",
            "event_id": "ev_chan_mention_12",
            "event": {
                "type": "app_mention",
                "channel": "C_PUBLIC_CHANNEL",
                "text": "<@U_BOT_123> create a quick invoice pdf document",
                "user": "U_USER_123"
            }
        }
        body = json.dumps(payload).encode("utf-8")
        headers = generate_slack_headers(body)
        
        resp = await client.post("/api/slack/events", content=body, headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        
        # Verify Inngest event dispatch contains clean text
        inngest_client.send.assert_called_once()
        sent_event = inngest_client.send.call_args[0][0]
        
        assert sent_event.name == "slack/event.received"
        assert sent_event.id == "ev_chan_mention_12"
        # The mention string "<@U_BOT_123>" must be fully stripped out
        assert sent_event.data["event"]["text"] == "create a quick invoice pdf document"
        logger.info("  [PASS] Bot mention in channel triggered activation; mention markup was parsed and stripped.")


async def test_slash_command_status():
    """Test 6: '/klawhub status' returns premium telemetry Block Kit cards."""
    logger.info("=" * 60)
    logger.info("TEST 6: Slash Command /klawhub status")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Construct form-url-encoded body as posted by Slack
        form_data = {
            "command": "/klawhub",
            "text": "status",
            "team_id": "T_SLACK_TEST",
            "channel_id": "C_CHANNEL_1",
            "user_id": "U_USER_123"
        }
        import urllib.parse
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers = generate_slack_headers(body)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        
        resp = await client.post("/api/slack/commands", content=body, headers=headers)
        assert resp.status_code == 200, f"Slash status failed: {resp.status_code}"
        
        res_json = resp.json()
        assert res_json["response_type"] == "in_channel"
        assert "blocks" in res_json
        
        blocks = res_json["blocks"]
        # Verify header block matches
        header_block = blocks[0]
        assert header_block["type"] == "header"
        assert "Klawhub Agent Status" in header_block["text"]["text"]
        
        # Verify status block reflects workspace plan & active status
        status_sec = blocks[1]
        assert "Test Slack Corp" in status_sec["text"]["text"]
        assert "GROWTH" in status_sec["text"]["text"]
        
        # Verify database telemetry stats are correctly gathered
        telemetry_sec = blocks[3]
        fields = telemetry_sec["fields"]
        assert "1 / 2 Completed" in fields[0]["text"]  # Runs completed / total runs
        assert "1 Cron Triggers" in fields[1]["text"]   # Active schedules
        assert "1 / 1 Executed" in fields[2]["text"]    # Tasks completed
        assert "2 / 500 Runs Used" in fields[3]["text"] # Monthly limits usage
        
        logger.info("  [PASS] /klawhub status returns rich Block Kit message filled with live telemetry statistics.")


async def test_slash_command_help():
    """Test 7: '/klawhub help' returns the ephemeral helper guides."""
    logger.info("=" * 60)
    logger.info("TEST 7: Slash Command /klawhub help")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        form_data = {
            "command": "/klawhub",
            "text": "help",
            "team_id": "T_SLACK_TEST",
            "channel_id": "C_CHANNEL_1",
            "user_id": "U_USER_123"
        }
        import urllib.parse
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers = generate_slack_headers(body)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        
        resp = await client.post("/api/slack/commands", content=body, headers=headers)
        assert resp.status_code == 200
        
        res_json = resp.json()
        assert res_json["response_type"] == "ephemeral"
        
        blocks = res_json["blocks"]
        assert blocks[0]["type"] == "header"
        assert "Coworker Helper Guide" in blocks[0]["text"]["text"]
        
        # Access link button structure
        action_button = blocks[6]["accessory"]
        assert action_button["type"] == "button"
        assert "Open Dashboard" in action_button["text"]["text"]
        assert action_button["style"] == "primary"
        
        logger.info("  [PASS] /klawhub help returns premium onboarding instructions with an Open Dashboard button.")


async def test_slack_interactive_actions():
    """Test 8: Block Kit action hooks process excuse standup/post update clicks."""
    logger.info("=" * 60)
    logger.info("TEST 8: Interactive Actions Callback")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    action_payload = {
        "user": {"id": "U_USER_123"},
        "team": {"id": "T_SLACK_TEST"},
        "channel": {"id": "C_CHANNEL_1"},
        "response_url": "https://hooks.slack.com/actions/T123/C123/ABCDEF",
        "actions": [
            {
                "action_id": "huddle_excuse",
                "block_id": "b1",
                "type": "button"
            }
        ]
    }
    
    import urllib.parse
    form_data = {"payload": json.dumps(action_payload)}
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    headers = generate_slack_headers(body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    
    # Conditionally intercept only outgoing requests to Slack response URLs
    import httpx
    original_post = httpx.AsyncClient.post
    intercepted_calls = []
    
    async def mock_post_side_effect(self, url, *args, **kwargs):
        if "hooks.slack.com" in str(url):
            intercepted_calls.append((url, kwargs))
            # Return a mock response object
            mock_resp = AsyncMock()
            mock_resp.status_code = 200
            async def mock_json():
                return {"ok": True}
            mock_resp.json = mock_json
            return mock_resp
        else:
            return await original_post(self, url, *args, **kwargs)
            
    with patch("httpx.AsyncClient.post", mock_post_side_effect):
        resp = await client_post_helper(transport, "/api/slack/actions", body, headers)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        
        # Assert callback posted to Slack response URL with ephemeral block
        assert len(intercepted_calls) == 1
        posted_url, posted_kwargs = intercepted_calls[0]
        posted_json = posted_kwargs["json"]
        
        assert str(posted_url) == "https://hooks.slack.com/actions/T123/C123/ABCDEF"
        assert "excused from today's standup" in posted_json["text"]
        logger.info("  [PASS] Intercepted button event and executed outgoing response webhook back to Slack.")


async def client_post_helper(transport, path, body, headers):
    """Auxiliary helper for posting requests inside patched environments."""
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.post(path, content=body, headers=headers)


async def test_inngest_serve_discovery():
    """Test 9: Inngest serve schema returns all background function metadata."""
    logger.info("=" * 60)
    logger.info("TEST 9: Inngest Serve Discovery Endpoint")
    logger.info("=" * 60)
    
    from api.index import app
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Inngest SDK serve uses GET /api/inngest to discover functions
        resp = await client.get("/api/inngest")
        assert resp.status_code == 200, f"Discovery endpoint failed: {resp.status_code}"
        
        schema = resp.json()
        logger.info(f"Retrieved Inngest Discovery Schema keys: {list(schema.keys())}")
        
        # Verify background workflow handlers are loaded and registered via function_count
        function_count = schema.get("function_count", 0)
        assert function_count > 0, f"Expected functions registered in Inngest schema, got {function_count}"
        logger.info(f"  Registered functions count: {function_count}")
        logger.info("  [PASS] Inngest middleware exposed dynamic background triggers correctly.")


async def main():
    await bootstrap_db()
    await setup_test_data()
    
    await test_signature_verification_firewall()
    await test_slack_challenge_handshake()
    await test_dm_event_routing()
    await test_channel_silence_policy()
    await test_channel_mention_activation()
    await test_slash_command_status()
    await test_slash_command_help()
    await test_slack_interactive_actions()
    await test_inngest_serve_discovery()
    
    logger.info("=" * 60)
    logger.info("[ALL TESTS PASSED] verify_slack_gateway.py completed successfully.")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
