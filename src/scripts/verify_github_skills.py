import os
import sys
import asyncio
import uuid
import logging
import io
import zipfile
from unittest.mock import patch, MagicMock

# Add project root to sys.path to resolve src imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# SQLAlchemy custom SQLite overrides for PostgreSQL specific types
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import JSONB, UUID

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "TEXT"

@compiles(UUID, "sqlite")
def compile_uuid_sqlite(type_, compiler, **kw):
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
logger = logging.getLogger("verify_github_skills")

from sqlmodel import SQLModel, select
from src.db.pool import async_engine, get_db_session
from src.db.models import Workspace, Skill
from src.core.evolution.acquisition import SkillAcquisitionEngine
from src.integrations.sandbox import sandbox_client

# Helper to create a mock zip file in-memory
def create_mock_zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for filepath, content in files.items():
            z.writestr(f"owner-repo-commit/{filepath}", content)
    return buf.getvalue()

async def test_schema_and_migration():
    logger.info("TEST 1: Verifying DB models and SQLite initialization...")
    
    # Strip postgres-specific defaults for SQLite compatibility in tests
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            column.server_default = None

    async with async_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)
    logger.info("  SQLite tables created successfully.")

async def test_successful_acquisition():
    logger.info("TEST 2: Verifying dynamic GitHub skill cloning & caching...")
    
    workspace_id = uuid.uuid4()
    async with get_db_session() as session:
        ws = Workspace(
            id=workspace_id,
            slack_team_id="T_TEST_WORKSPACE",
            slack_bot_user_id="U_TEST_BOT",
            bot_token="xoxb-test-token",
            name="Test Workspace"
        )
        session.add(ws)

    # Mock dynamic skill files
    safe_code = """
import numpy as np
def handler(x):
    return np.square(x).tolist()
"""
    mock_zip_bytes = create_mock_zip({
        "my_math.py": safe_code,
        "requirements.txt": "numpy\npolars\n"
    })

    # Mock response object for httpx
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = mock_zip_bytes

    # Patch httpx.AsyncClient.get to return our mock zip bytes
    with patch("httpx.AsyncClient.get", return_value=mock_response):
        success = await SkillAcquisitionEngine.clone_and_register_github_skill(
            workspace_id=workspace_id,
            repo_url="https://github.com/timilehin-dev/my-custom-skill",
            file_path="my_math.py",
            skill_name="my_math",
            entrypoint="handler"
        )
        assert success is True, "GitHub skill acquisition returned failure."

    # Validate that it is properly stored in the database
    async with get_db_session() as session:
        stmt = select(Skill).where(Skill.workspace_id == workspace_id, Skill.name == "my_math")
        skill = (await session.execute(stmt)).scalar_one_or_none()
        
        assert skill is not None, "Skill was not found in the database."
        assert skill.dependencies == "numpy,polars", f"Unexpected dependencies: {skill.dependencies}"
        assert skill.entrypoint == "handler"
        assert "np.square" in skill.source_code
        logger.info("  GitHub skill successfully cloned, validated, and cached in DB.")

async def test_security_ast_firewall():
    logger.info("TEST 3: Verifying zero-trust AST safety blocker during acquisition...")
    
    workspace_id = uuid.uuid4()
    
    # Unsafe code trying to execute eval or dunder imports
    unsafe_code = """
def handler(x):
    eval("x + 1")
"""
    mock_zip_bytes = create_mock_zip({
        "unsafe.py": unsafe_code
    })

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = mock_zip_bytes

    with patch("httpx.AsyncClient.get", return_value=mock_response):
        success = await SkillAcquisitionEngine.clone_and_register_github_skill(
            workspace_id=workspace_id,
            repo_url="https://github.com/hacker/malicious-skill",
            file_path="unsafe.py",
            skill_name="malicious",
            entrypoint="handler"
        )
        assert success is False, "AST scanner failed to block unsafe eval code!"

    # Verify that it was NOT written to the database
    async with get_db_session() as session:
        stmt = select(Skill).where(Skill.workspace_id == workspace_id, Skill.name == "malicious")
        skill = (await session.execute(stmt)).scalar_one_or_none()
        assert skill is None, "Malicious skill was saved to the database!"
    logger.info("  Zero-trust AST safety scan successfully blocked malicious skill.")

async def test_sandbox_mounting_and_isolation():
    logger.info("TEST 4: Verifying multi-tenant sandbox mounting and dependency tracking...")
    
    workspace_a_id = uuid.uuid4()
    workspace_b_id = uuid.uuid4()

    # Register my_custom_tool for Workspace A
    async with get_db_session() as session:
        ws_a = Workspace(id=workspace_a_id, slack_team_id="T_A", slack_bot_user_id="U_A", bot_token="tok_a", name="WS A")
        ws_b = Workspace(id=workspace_b_id, slack_team_id="T_B", slack_bot_user_id="U_B", bot_token="tok_b", name="WS B")
        session.add(ws_a)
        session.add(ws_b)
        
        skill_a = Skill(
            workspace_id=workspace_a_id,
            name="custom_math",
            description="Mock custom tool for A",
            category="custom",
            source_code="def compute(x): return x * 100",
            entrypoint="compute",
            dependencies="pandas,numpy"
        )
        session.add(skill_a)

    # Case A: Execute sandbox importing 'custom_math' from Workspace A
    # The SandboxClient should automatically locate 'custom_math' in Workspace A, extract it, and include it in mounted_skills payload
    runner_code = """
import custom_math
print(custom_math.compute(5))
"""
    
    # We will patch sandbox_client's HTTP client POST requests to inspect the payloads sent to Modal
    mock_post_res = MagicMock()
    mock_post_res.status_code = 200
    mock_post_res.json.return_value = {
        "exit_code": 0,
        "stdout": "500",
        "stderr": "",
        "duration_ms": 120
    }

    with patch("httpx.AsyncClient.post", return_value=mock_post_res) as mock_post:
        result = await sandbox_client.execute_code(
            code=runner_code,
            language="python",
            workspace_id=workspace_a_id
        )
        
        assert result["success"] is True
        assert result["stdout"] == "500"
        
        # Verify that custom_math was indeed mounted in the POST payload!
        call_args = mock_post.call_args[1]
        payload = json_data = eval(call_args["content"])
        
        assert "mounted_skills" in payload
        assert "custom_math" in payload["mounted_skills"]
        assert payload["mounted_skills"]["custom_math"]["code"] == "def compute(x): return x * 100"
        # Confirm skill dependencies were auto-merged
        assert "pandas" in payload["dependencies"]
        assert "numpy" in payload["dependencies"]
        # Ensure the skill name itself is NOT added as a pip package
        assert "custom_math" not in payload["dependencies"]
        
    logger.info("  Auto-mounting of custom skill in Workspace A payload confirmed.")

    # Case B: Execute sandbox importing 'custom_math' from Workspace B
    # Since custom_math belongs to Workspace A, Workspace B's execution should not find or mount it!
    with patch("httpx.AsyncClient.post", return_value=mock_post_res) as mock_post:
        result = await sandbox_client.execute_code(
            code=runner_code,
            language="python",
            workspace_id=workspace_b_id
        )
        
        # Verify that custom_math was NOT mounted for Workspace B!
        call_args = mock_post.call_args[1]
        payload = eval(call_args["content"])
        
        assert "mounted_skills" in payload
        assert "custom_math" not in payload["mounted_skills"]
        # Standard auto-dependency detection will treat it as a missing module to install, but won't mount Workspace A's code
        assert "custom_math" in payload["dependencies"]
        
    logger.info("  Multi-tenant sandbox mounting isolation verified successfully.")

async def main():
    logger.info("======================================================================")
    logger.info("STARTING PHASE 8 GITHUB SKILL ENGINE AND SANDBOX MOUNTING VERIFICATION")
    logger.info("======================================================================")
    try:
        await test_schema_and_migration()
        await test_successful_acquisition()
        await test_security_ast_firewall()
        await test_sandbox_mounting_and_isolation()
        logger.info("======================================================================")
        logger.info("[ALL TESTS PASSED] Phase 8 GitHub Skill System verified successfully!")
        logger.info("======================================================================")
    except AssertionError as ae:
        logger.error(f"[TEST FAILURE] Assert failed: {str(ae)}")
        sys.exit(1)
    except Exception as e:
        logger.exception(f"[UNEXPECTED EXCEPTION] Tests crashed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
