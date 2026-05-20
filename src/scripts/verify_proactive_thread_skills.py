import os
import sys
import asyncio
import uuid
import logging
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime

# Add project root to sys.path to resolve src imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# SQLAlchemy custom SQLite overrides for PostgreSQL specific types
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import JSONB, UUID
from src.db.models import PGVector

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "TEXT"

@compiles(UUID, "sqlite")
def compile_uuid_sqlite(type_, compiler, **kw):
    return "TEXT"

@compiles(PGVector, "sqlite")
def compile_vector_sqlite(type_, compiler, **kw):
    return "TEXT"

# 1. Setup mock environment variables before importing any src modules
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["UPSTASH_REDIS_REST_URL"] = "https://mock-redis.upstash.io"
os.environ["UPSTASH_REDIS_REST_TOKEN"] = "mock_token"
os.environ["SLACK_SIGNING_SECRET"] = "mock_slack_signing_secret"
os.environ["SLACK_BOT_TOKEN"] = "xoxb-mock-bot-token"
os.environ["MODAL_FUNCTION_URL"] = "https://mock-modal.run"
os.environ["MODAL_WEBHOOK_SECRET"] = "mock_modal_secret"
os.environ["INTEGRATION_ENCRYPTION_KEY"] = "mock_integration_encryption_key_32_bytes_long!!"
os.environ["STATE_SIGNING_KEY"] = "test_state_signing_key_secure_12345"

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("verify_proactive_thread_skills")

# Import necessary modules
from sqlmodel import SQLModel, select
from src.db.pool import async_engine, get_db_session
from src.db.models import Workspace, Skill, AgentState, Run
from src.core.evolution.compiler import EvolutionCompiler, SecurityError
from src.core.evolution.registry import DynamicSkillRegistry
from src.core.evolution.acquisition import SkillAcquisitionEngine
from src.workflows.message_handler import slack_message_handler

# Mock Inngest Context for testing message handler steps
class MockInngestStep:
    async def run(self, step_id, fn, *args, **kwargs):
        logger.info(f"[Inngest Mock Step] Executing step '{step_id}'")
        if asyncio.iscoroutinefunction(fn):
            return await fn(*args, **kwargs)
        return fn(*args, **kwargs)

class MockInngestContext:
    def __init__(self, event_data):
        self.event = MagicMock()
        self.event.data = event_data
        self.step = MockInngestStep()

async def init_db():
    logger.info("Normalizing SQLModel metadata server defaults for SQLite compatibility...")
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            column.server_default = None

    logger.info("Initializing in-memory database schema...")
    async with async_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    logger.info("Database tables initialized successfully.")

# ─────────────────────────────────────────────────────────────────────────────
# TEST 1: Silent Skill Acquisition of Legitimate high-risk sandbox skills
# ─────────────────────────────────────────────────────────────────────────────
async def test_silent_skill_acquisition(workspace_id: uuid.UUID):
    logger.info("=== TEST 1: Silent high-risk sandbox skill acquisition ===")
    
    # 1. Custom skill source code using whitelisted sandbox packages (os, sys, subprocess, open)
    sandbox_skill_code = """
import os
import sys
import subprocess
import shutil
import tempfile

def handler(event, context):
    # Standard shell / subprocess operations destined for Modal container sandbox execution
    tmp = tempfile.gettempdir()
    path = os.path.join(tmp, "sandbox_test.txt")
    with open(path, "w") as f:
        f.write("Modal Container Test Payload")
    
    res = subprocess.run(["echo", "Running dynamic skill entrypoint!"], capture_output=True, text=True, shell=True)
    return {
        "status": "success",
        "output": res.stdout.strip(),
        "file_exists": os.path.exists(path)
    }
"""
    
    logger.info("Validating compilation under 'strict' profile (should fail due to forbidden imports)...")
    try:
        EvolutionCompiler.compile_skill(sandbox_skill_code, "test_sandbox_skill", isolation_profile="strict")
        raise AssertionError("Expected SecurityError when compiling powerful operations under strict profile!")
    except SecurityError as se:
        logger.info(f"[PASSED] Strict profile correctly blocked powerful imports: {se}")

    logger.info("Validating compilation under 'sandbox' profile (should compile and load successfully)...")
    try:
        namespace = EvolutionCompiler.compile_skill(sandbox_skill_code, "test_sandbox_skill", isolation_profile="sandbox")
        res = namespace["handler"](None, None)
        assert res["status"] == "success", "Failed to run compiled sandbox skill handler!"
        logger.info(f"[PASSED] Sandbox profile successfully compiled powerful operations: {res}")
    except Exception as e:
        raise AssertionError(f"Failed to compile powerful skill under sandbox safety profile: {e}")

    # Register into DB and DynamicSkillRegistry
    logger.info("Testing dynamic registration through DynamicSkillRegistry...")
    DynamicSkillRegistry.register_skill(
        name="pdf_generator", 
        source_code=sandbox_skill_code, 
        entrypoint_function="handler", 
        isolation_profile="sandbox"
    )
    loaded_handler = DynamicSkillRegistry.get_skill("pdf_generator")
    assert loaded_handler is not None, "Failed to load registered skill!"
    logger.info("[PASSED] Registered powerful custom skill silently under sandbox safety profile.")

# ─────────────────────────────────────────────────────────────────────────────
# TEST 2: Dynamic In-Memory Thread Tracing & Privacy boundary
# ─────────────────────────────────────────────────────────────────────────────
async def test_in_memory_thread_tracing(workspace: Workspace):
    logger.info("=== TEST 2: Dynamic In-Memory Thread Tracing ===")

    # 1. Create a dummy active skill in DB that matches thread topic
    async with get_db_session() as session:
        pdf_skill = Skill(
            workspace_id=workspace.id,
            name="pdf_generator",
            description="Generates corporate pdf reports and summaries",
            category="custom",
            is_active=True
        )
        session.add(pdf_skill)
        await session.commit()

    # Create Slack Thread replies mock payload
    mock_replies = [
        {"ts": "1710000001.000100", "user": "U_USER_A", "text": "Need to find a way to generate a PDF for these stats"},
        {"ts": "1710000002.000200", "user": "U_USER_B", "text": "I can help with formatting, but we need pdf_generator skill"},
        {"ts": "1710000003.000300", "user": "U_USER_A", "text": "Summarize this thread and list concrete action items"}
    ]

    event_payload = {
        "eventId": "evt_trace_test_123",
        "teamId": workspace.slack_team_id,
        "event": {
            "type": "app_mention",
            "channel": "C_CHANNEL_X",
            "ts": "1710000003.000300",
            "thread_ts": "1710000001.000100",
            "text": f"<@{workspace.slack_bot_user_id}> summarize this thread"
        }
    }

    ctx = MockInngestContext(event_payload)

    # 2. Mock SlackClient and the LangGraph graph execution so we only test handler tracing context
    with patch("src.workflows.message_handler.SlackClient") as MockSlackClientClass, \
         patch("src.core.agents.graph.coworker_app.ainvoke", new_callable=AsyncMock) as mock_ainvoke:
         
        mock_slack_inst = MagicMock()
        mock_slack_inst.get_thread_replies = AsyncMock(return_value=mock_replies)
        mock_slack_inst.post_message = AsyncMock(return_value={"ts": "1710000004.000400"})
        mock_slack_inst.add_reaction = AsyncMock()
        mock_slack_inst.remove_reaction = AsyncMock()
        
        MockSlackClientClass.return_value = mock_slack_inst
        mock_ainvoke.return_value = {"worker_output": "Here is the thread summary.", "errors": []}

        # Trigger message handler
        await slack_message_handler._handler(ctx)

        # 3. Assertions
        # Verify get_thread_replies was fetched dynamically
        mock_slack_inst.get_thread_replies.assert_called_once_with("C_CHANNEL_X", "1710000001.000100")
        
        # Verify that coworker_app.ainvoke was invoked with the constructed in-memory context in user_query!
        called_args, called_kwargs = mock_ainvoke.call_args
        invoked_state = called_args[0]
        
        assert "Need to find a way to generate a PDF" in invoked_state["user_query"], "Thread context missing from user query!"
        assert "U_USER_B" in invoked_state["user_query"], "Thread participant user IDs missing from transcript!"
        logger.info("[PASSED] Parent thread crawled and unified in-memory context compiled successfully.")

        # 4. Strict Privacy Boundary verification: Ensure database has zero chat messages stored
        async with get_db_session() as session:
            stmt = select(Run)
            runs = (await session.execute(stmt)).scalars().all()
            for r in runs:
                assert "Need to find" not in (r.request or "") and "Need to find" not in (r.final_output or ""), \
                    "Privacy leak! Raw chat messages or transcript found inside database tables."
        logger.info("[PASSED] Absolute Privacy Boundary: Verified zero database chat log storage.")

# ─────────────────────────────────────────────────────────────────────────────
# TEST 3: Proactive Intervention heuristics & single response spam boundary
# ─────────────────────────────────────────────────────────────────────────────
async def test_proactive_intervention(workspace: Workspace):
    logger.info("=== TEST 3: Proactive Slack Intervention Heuristics ===")

    # Clear prior states
    async with get_db_session() as session:
        from sqlalchemy import delete
        await session.execute(delete(AgentState).where(AgentState.agent_name.like("proactive_suggestion:%")))
        await session.commit()

    # Triggering untagged channel message (not a question) -> should ignore
    event_no_question = {
        "eventId": "evt_no_q",
        "teamId": workspace.slack_team_id,
        "event": {
            "type": "message",
            "channel": "C_CHANNEL_X",
            "ts": "1710000100.000100",
            "thread_ts": "1710000100.000100",
            "text": "Just pushed some random code commits."
        }
    }

    # Triggering untagged channel question (no matching active skill) -> should ignore
    event_no_skill_match = {
        "eventId": "evt_no_skill",
        "teamId": workspace.slack_team_id,
        "event": {
            "type": "message",
            "channel": "C_CHANNEL_X",
            "ts": "1710000101.000100",
            "thread_ts": "1710000101.000100",
            "text": "How do we bake a strawberry shortcake?"
        }
    }

    # Triggering untagged channel question (matching active skill 'pdf_generator') -> should respond
    event_proactive_match = {
        "eventId": "evt_match",
        "teamId": workspace.slack_team_id,
        "event": {
            "type": "message",
            "channel": "C_CHANNEL_X",
            "ts": "1710000102.000100",
            "thread_ts": "1710000102.000100",
            "text": "How do we generate a PDF report for marketing?"
        }
    }

    with patch("src.workflows.message_handler.SlackClient") as MockSlackClientClass:
        mock_slack_inst = MagicMock()
        mock_slack_inst.get_history = AsyncMock(return_value=[
            {"ts": "1710000102.000100", "user": "U_USER_A", "text": "How do we generate a PDF report for marketing?"},
            {"ts": "1710000050.000200", "user": "U_USER_B", "text": "Let's ask later"},
            {"ts": "1710000000.000300", "user": "U_USER_A", "text": "Hello"}
        ])  # 3 messages in 102 seconds -> not rapid!
        mock_slack_inst.post_message = AsyncMock(return_value={"ts": "1710000105.000100"})
        MockSlackClientClass.return_value = mock_slack_inst

        # 1. Verify message without question is ignored
        ctx_no_q = MockInngestContext(event_no_question)
        await slack_message_handler._handler(ctx_no_q)
        mock_slack_inst.post_message.assert_not_called()
        logger.info("[PASSED] Correctly ignored untagged message with no question.")

        # 2. Verify message with no matching active skill is ignored
        ctx_no_skill = MockInngestContext(event_no_skill_match)
        await slack_message_handler._handler(ctx_no_skill)
        mock_slack_inst.post_message.assert_not_called()
        logger.info("[PASSED] Correctly ignored untagged message with no active skill matches.")

        # 3. Verify message with matching active skill triggers proactive Block Kit card
        ctx_proactive = MockInngestContext(event_proactive_match)
        await slack_message_handler._handler(ctx_proactive)
        
        mock_slack_inst.post_message.assert_called_once()
        called_channel, called_text = mock_slack_inst.post_message.call_args[0] or (None, None)
        called_kwargs = mock_slack_inst.post_message.call_args[1]
        
        assert called_kwargs["thread_ts"] == "1710000102.000100"
        assert "pdf_generator" in called_kwargs["blocks"][0]["text"]["text"]
        logger.info("[PASSED] Successfully triggered Block Kit proactive suggestion card on skill match.")

        # 4. Anti-Spam Check: Trigger again in the SAME thread -> should block duplicate response
        mock_slack_inst.post_message.reset_mock()
        event_proactive_repeat = {
            "eventId": "evt_match_repeat",
            "teamId": workspace.slack_team_id,
            "event": {
                "type": "message",
                "channel": "C_CHANNEL_X",
                "ts": "1710000106.000100",
                "thread_ts": "1710000102.000100",  # Same thread!
                "text": "Anyone know how do we generate a PDF report?"
            }
        }
        ctx_repeat = MockInngestContext(event_proactive_repeat)
        await slack_message_handler._handler(ctx_repeat)
        mock_slack_inst.post_message.assert_not_called()
        logger.info("[PASSED] Anti-Spam Boundary: Duplicate thread interventions correctly blocked.")

        # 5. Rapid Chat frequency check: Trigger in new thread but simulate rapid huddle
        mock_slack_inst.post_message.reset_mock()
        mock_slack_inst.get_history = AsyncMock(return_value=[
            {"ts": "1710000200.000300", "user": "U_USER_A", "text": "How do we generate a PDF?"},
            {"ts": "1710000199.000200", "user": "U_USER_B", "text": "Let's check now!"},
            {"ts": "1710000198.000100", "user": "U_USER_A", "text": "Yes, please!"}
        ])  # 3 messages in 2 seconds -> extremely rapid!
        
        event_rapid = {
            "eventId": "evt_match_rapid",
            "teamId": workspace.slack_team_id,
            "event": {
                "type": "message",
                "channel": "C_CHANNEL_X",
                "ts": "1710000200.000300",
                "thread_ts": "1710000200.000300",
                "text": "How do we generate a PDF report for marketing?"
            }
        }
        ctx_rapid = MockInngestContext(event_rapid)
        await slack_message_handler._handler(ctx_rapid)
        mock_slack_inst.post_message.assert_not_called()
        logger.info("[PASSED] Chat Frequency Boundary: Kept silent during rapid channel dialogue.")

# ─────────────────────────────────────────────────────────────────────────────
# MAIN EXECUTION ROUTINE
# ─────────────────────────────────────────────────────────────────────────────
async def main():
    logger.info("Starting Phase 10 Proactive Coworker & Privacy Tracer E2E Verification Suite...")
    await init_db()

    # Create workspace profile
    workspace_id = uuid.uuid4()
    workspace = Workspace(
        id=workspace_id,
        slack_team_id="T_MOCK_CORP",
        slack_bot_user_id="U_KLAWHUB_BOT",
        bot_token="xoxb-mock-bot-token",
        name="Enterprise Workspace",
        is_active=True
    )
    async with get_db_session() as session:
        session.add(workspace)
        await session.commit()

    # Run tests
    try:
        await test_silent_skill_acquisition(workspace_id)
        await test_in_memory_thread_tracing(workspace)
        await test_proactive_intervention(workspace)
        
        logger.info("=" * 60)
        logger.info("[ALL TESTS PASSED] Phase 10 enterprise capabilities verified successfully!")
        logger.info("=" * 60)
        sys.exit(0)
    except AssertionError as ae:
        logger.error(f"[TEST FAILURE] Assertion failed: {ae}")
        sys.exit(1)
    except Exception as e:
        logger.exception(f"[UNEXPECTED ERROR] Test run failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
