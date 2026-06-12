"""
verify_settings_sync.py — Phase 6 E2E Test 3
==============================================
Validates bidirectional dashboard settings synchronization:
1. FastAPI client → POST /api/dashboard/settings → PostgreSQL update
2. PostgreSQL → Sentinel LangGraph node reads updated workspace profile
3. Cross-tenant settings isolation (Workspace B cannot tamper with A)
"""
import os
import sys
import asyncio
import uuid
import logging

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
os.environ["SLACK_SIGNING_SECRET"] = "mock_slack_signing_secret"
os.environ["SLACK_BOT_TOKEN"] = "xoxb-mock-bot-token"
os.environ["MODAL_FUNCTION_URL"] = "https://mock-modal.run"
os.environ["MODAL_WEBHOOK_SECRET"] = "mock_modal_secret"
os.environ["INTEGRATION_ENCRYPTION_KEY"] = "mock_integration_encryption_key_32_bytes!!"
os.environ["STATE_SIGNING_KEY"] = "test_state_signing_key_secure_12345"
os.environ["INNGEST_SIGNING_KEY"] = "mock_inngest_signing_key"
os.environ["INNGEST_DEV_MODE"] = "true"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("verify_settings_sync")

from sqlmodel import SQLModel, select
from httpx import AsyncClient, ASGITransport
from src.db.pool import async_engine, get_db_session
from src.db.models import Workspace
from src.integrations.crypto import encrypt_token, decrypt_token
from src.core.agents.team.sentinel import sentinel_node


async def bootstrap_db():
    """Create all tables in the in-memory SQLite database."""
    # Strip postgres-specific server_default expressions
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            column.server_default = None

    async with async_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    logger.info("In-memory database schema initialized.")


async def create_test_workspace(
    slack_team_id: str,
    name: str,
    agent_name: str = "Klawhub",
    personality: str = "Professional, efficient, and precise.",
    skills: list = None
) -> uuid.UUID:
    """Insert a test workspace and return its UUID."""
    wid = uuid.uuid4()
    async with get_db_session(bypass_rls=True) as session:
        ws = Workspace(
            id=wid,
            slack_team_id=slack_team_id,
            slack_bot_user_id="U_BOT_TEST",
            bot_token="xoxb-test-token",
            name=name,
            agent_name=agent_name,
            agent_personality=personality,
            enabled_skills=skills or ["web_search", "python_sandbox", "pdf_generator"],
        )
        session.add(ws)
    return wid


async def test_settings_roundtrip():
    """Test 1: POST new settings → confirm DB update → confirm GET reflects changes."""
    logger.info("=" * 60)
    logger.info("TEST 1: Settings roundtrip via FastAPI client")
    logger.info("=" * 60)

    workspace_id = await create_test_workspace(
        slack_team_id="T_ROUNDTRIP",
        name="Roundtrip Corp",
        agent_name="Klawhub",
        personality="Be helpful.",
        skills=["web_search", "python_sandbox"]
    )
    logger.info(f"Created test workspace: {workspace_id}")

    # Build encrypted session cookie
    encrypted_session = encrypt_token(str(workspace_id))

    # Import the FastAPI app
    from api.index import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # ── GET current settings ──
        get_resp = await client.get(
            "/api/dashboard/settings",
            cookies={"session_id": encrypted_session}
        )
        assert get_resp.status_code == 200, f"GET settings failed: {get_resp.status_code}"
        original = get_resp.json()
        assert original["agent_name"] == "Klawhub"
        assert original["enabled_skills"] == ["web_search", "python_sandbox"]
        logger.info(f"  Original settings retrieved: name='{original['agent_name']}', skills={original['enabled_skills']}")

        # ── POST updated settings ──
        new_settings = {
            "agent_name": "Atlas Prime",
            "agent_personality": "You are a decisive, sharp executive assistant who communicates concisely.",
            "enabled_skills": ["web_search", "python_sandbox", "pdf_generator", "puppeteer_scraping"],
            "is_active": True
        }
        post_resp = await client.post(
            "/api/dashboard/settings",
            json=new_settings,
            cookies={"session_id": encrypted_session}
        )
        assert post_resp.status_code == 200, f"POST settings failed: {post_resp.status_code}"
        assert post_resp.json()["status"] == "success"
        logger.info("  POST /api/dashboard/settings → success")

        # ── GET updated settings to confirm persistence ──
        get_resp2 = await client.get(
            "/api/dashboard/settings",
            cookies={"session_id": encrypted_session}
        )
        assert get_resp2.status_code == 200
        updated = get_resp2.json()
        assert updated["agent_name"] == "Atlas Prime"
        assert updated["agent_personality"] == "You are a decisive, sharp executive assistant who communicates concisely."
        assert "puppeteer_scraping" in updated["enabled_skills"]
        assert len(updated["enabled_skills"]) == 4
        logger.info(f"  Updated settings confirmed: name='{updated['agent_name']}', skills={updated['enabled_skills']}")

    # ── Direct DB verification ──
    async with get_db_session(bypass_rls=True) as session:
        ws = await session.get(Workspace, workspace_id)
        assert ws.agent_name == "Atlas Prime"
        assert ws.agent_personality == "You are a decisive, sharp executive assistant who communicates concisely."
        assert "puppeteer_scraping" in ws.enabled_skills
    logger.info("  Direct DB query confirms settings persisted correctly.")
    logger.info("  [PASS] Test 1 complete.\n")
    return workspace_id


async def test_sentinel_loads_updated_settings(workspace_id: uuid.UUID):
    """Test 2: Sentinel LangGraph node loads updated workspace profile from DB."""
    logger.info("=" * 60)
    logger.info("TEST 2: Sentinel node loads updated workspace settings")
    logger.info("=" * 60)

    # Simulate LangGraph state input
    state = {
        "workspace_id": str(workspace_id),
        "thread_id": "test_thread_sentinel_001",
        "user_query": "Generate a quarterly invoice report for ACME Corp"
    }

    result = await sentinel_node(state)

    # Assertions: Sentinel should reflect the updated settings from Test 1
    assert result["bot_name"] == "Atlas Prime", f"Expected 'Atlas Prime', got '{result['bot_name']}'"
    assert "decisive" in result["bot_personality"].lower(), f"Personality not updated: {result['bot_personality']}"
    assert "puppeteer_scraping" in result["enabled_skills"], f"Skills not propagated: {result['enabled_skills']}"
    assert result["is_high_value_trigger"] is True, "High-value keyword 'invoice' should be detected"
    logger.info(f"  Sentinel bot_name: '{result['bot_name']}'")
    logger.info(f"  Sentinel personality: '{result['bot_personality'][:60]}...'")
    logger.info(f"  Sentinel enabled_skills: {result['enabled_skills']}")
    logger.info(f"  Sentinel high_value_trigger: {result['is_high_value_trigger']}")
    logger.info("  [PASS] Test 2 complete.\n")


async def test_disabled_skills_propagation():
    """Test 3: Toggling off skills via settings removes them from Sentinel's loaded profile."""
    logger.info("=" * 60)
    logger.info("TEST 3: Disabled skills propagation to Sentinel node")
    logger.info("=" * 60)

    workspace_id = await create_test_workspace(
        slack_team_id="T_SKILL_TOGGLE",
        name="SkillToggle Inc",
        agent_name="Sentinel Bot",
        personality="Always verify before acting.",
        skills=["web_search", "python_sandbox", "pdf_generator"]
    )

    # Update settings: remove python_sandbox
    encrypted_session = encrypt_token(str(workspace_id))
    from api.index import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        post_resp = await client.post(
            "/api/dashboard/settings",
            json={
                "agent_name": "Sentinel Bot",
                "agent_personality": "Always verify before acting.",
                "enabled_skills": ["web_search"],  # Only web_search remains
                "is_active": True
            },
            cookies={"session_id": encrypted_session}
        )
        assert post_resp.status_code == 200

    # Verify through Sentinel node
    state = {
        "workspace_id": str(workspace_id),
        "thread_id": "test_thread_toggle_001",
        "user_query": "Build me an analytics dashboard"
    }
    result = await sentinel_node(state)

    assert result["enabled_skills"] == ["web_search"], f"Expected only 'web_search', got {result['enabled_skills']}"
    assert "python_sandbox" not in result["enabled_skills"]
    assert "pdf_generator" not in result["enabled_skills"]
    logger.info(f"  Sentinel loaded skills after toggle: {result['enabled_skills']}")
    logger.info("  [PASS] Test 3 complete.\n")


async def test_cross_tenant_settings_isolation():
    """Test 4: Workspace B's session cookie cannot modify Workspace A's settings."""
    logger.info("=" * 60)
    logger.info("TEST 4: Cross-tenant settings isolation")
    logger.info("=" * 60)

    # Create two workspaces
    ws_a_id = await create_test_workspace(
        slack_team_id="T_ISOLATION_A",
        name="Alpha Corp",
        agent_name="Alpha Bot"
    )
    ws_b_id = await create_test_workspace(
        slack_team_id="T_ISOLATION_B",
        name="Beta Corp",
        agent_name="Beta Bot"
    )

    # Workspace B's encrypted session
    session_b = encrypt_token(str(ws_b_id))

    from api.index import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Use Workspace B's cookie to try to update settings
        post_resp = await client.post(
            "/api/dashboard/settings",
            json={
                "agent_name": "HACKED NAME",
                "agent_personality": "Malicious personality",
                "enabled_skills": ["evil_skill"],
                "is_active": False
            },
            cookies={"session_id": session_b}
        )
        assert post_resp.status_code == 200  # This updates Workspace B, not A

    # Verify Workspace A is UNTOUCHED
    async with get_db_session(bypass_rls=True) as session:
        ws_a = await session.get(Workspace, ws_a_id)
        assert ws_a.agent_name == "Alpha Bot", f"Workspace A was tampered! Got '{ws_a.agent_name}'"
        assert ws_a.is_active is True, "Workspace A's is_active was tampered!"
        assert "evil_skill" not in (ws_a.enabled_skills or [])

        # Verify Workspace B WAS legitimately updated (with its own session)
        ws_b = await session.get(Workspace, ws_b_id)
        assert ws_b.agent_name == "HACKED NAME", f"Workspace B should have been updated, got '{ws_b.agent_name}'"

    logger.info("  Workspace A remains: name='Alpha Bot', is_active=True (UNTOUCHED)")
    logger.info("  Workspace B updated: name='HACKED NAME' (correctly scoped)")
    logger.info("  [PASS] Test 4 complete.\n")


async def test_unauthorized_access_blocked():
    """Test 5: Requests without a valid session cookie are blocked with 401."""
    logger.info("=" * 60)
    logger.info("TEST 5: Unauthorized access returns 401")
    logger.info("=" * 60)

    from api.index import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # No cookie at all
        resp = await client.get("/api/dashboard/settings")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        logger.info(f"  No cookie → {resp.status_code} (correct)")

        # Invalid/corrupted cookie
        resp2 = await client.get(
            "/api/dashboard/settings",
            cookies={"session_id": "totally_invalid_base64_garbage_xoxo"}
        )
        assert resp2.status_code == 401, f"Expected 401, got {resp2.status_code}"
        logger.info(f"  Invalid cookie → {resp2.status_code} (correct)")

        # POST with no cookie
        resp3 = await client.post(
            "/api/dashboard/settings",
            json={
                "agent_name": "Hacker",
                "agent_personality": "Bad",
                "enabled_skills": [],
                "is_active": False
            }
        )
        assert resp3.status_code == 401, f"Expected 401, got {resp3.status_code}"
        logger.info(f"  POST without session → {resp3.status_code} (correct)")

    logger.info("  [PASS] Test 5 complete.\n")


async def main():
    await bootstrap_db()

    workspace_id = await test_settings_roundtrip()
    await test_sentinel_loads_updated_settings(workspace_id)
    await test_disabled_skills_propagation()
    await test_cross_tenant_settings_isolation()
    await test_unauthorized_access_blocked()

    logger.info("=" * 60)
    logger.info("[ALL TESTS PASSED] verify_settings_sync.py completed successfully.")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
