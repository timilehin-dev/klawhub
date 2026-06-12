import os
import sys
import asyncio
import uuid
import logging
import base64
import json
from unittest.mock import AsyncMock, patch, MagicMock

# Add project root to sys.path
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

# Setup mock environment variables before importing config
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("UPSTASH_REDIS_REST_URL", "https://mock-redis.upstash.io")
os.environ.setdefault("UPSTASH_REDIS_REST_TOKEN", "mock_token")
os.environ.setdefault("SLACK_SIGNING_SECRET", "mock_slack_signing_secret")
os.environ.setdefault("SLACK_BOT_TOKEN", "xoxb-mock-bot-token")
os.environ.setdefault("MODAL_FUNCTION_URL", "https://mock-modal.run")
os.environ.setdefault("MODAL_WEBHOOK_SECRET", "mock_modal_secret")
os.environ.setdefault("INTEGRATION_ENCRYPTION_KEY", "mock_integration_encryption_key_32_bytes!!")
os.environ.setdefault("STATE_SIGNING_KEY", "test_state_signing_key_secure_12345")

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("verify_document_skills")

from sqlmodel import SQLModel, select
from src.db.pool import async_engine, get_db_session
from src.db.models import Workspace, Skill
from src.integrations.sandbox import SandboxClient

class MockHttpResponse:
    def __init__(self, status_code: int, json_data: dict):
        self.status_code = status_code
        self._json_data = json_data
        self.text = str(json_data)

    def json(self):
        return self._json_data

async def test_dynamic_skill_installation_and_execution():
    logger.info("=" * 60)
    logger.info("TEST: Auto-Installing document_generator on first import")
    logger.info("=" * 60)

    # 1. Initialize SQLite schema in memory
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            column.server_default = None

    async with async_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)

    # 2. Add mock workspace to DB
    workspace_id = uuid.uuid4()
    async with get_db_session(bypass_rls=True) as session:
        ws = Workspace(
            id=workspace_id,
            slack_team_id="T_DOCS",
            slack_bot_user_id="U_DOCS",
            bot_token="xoxb-docs-token",
            name="Document Workspace"
        )
        session.add(ws)
        await session.commit()

    # 3. Instantiate SandboxClient
    client = SandboxClient(
        function_url="https://mock-modal.run",
        webhook_secret="mock_modal_secret"
    )

    # Code that imports document_generator for the first time
    code = """
import document_generator
pdf_path = document_generator.generate_pdf('<h1>Hi</h1>', 'output.pdf')
"""

    mock_response_data = {
        "success": True,
        "exit_code": 0,
        "stdout": "Compiled PDF!",
        "stderr": "",
        "duration_ms": 200,
        "generated_files": [
            {
                "name": "output.pdf",
                "data_b64": base64.b64encode(b"pdf-binary").decode("utf-8"),
                "size": 10
            }
        ]
    }

    # Patch httpx.AsyncClient.post to capture the payload sent to Modal
    mock_post = AsyncMock(return_value=MockHttpResponse(200, mock_response_data))

    # Mock the GitHub skill clone response to fail (so it falls back to registering our high-fidelity skill directly!)
    mock_github_res = MagicMock()
    mock_github_res.status_code = 404 # Repositories might not exist yet
    mock_github_res.content = b""

    with patch("httpx.AsyncClient.post", mock_post):
        with patch("httpx.AsyncClient.get", return_value=mock_github_res):
            logger.info("Triggering sandbox execution for code importing document_generator...")
            result = await client.execute_code(code, workspace_id=workspace_id)

            assert result["success"] is True
            assert len(result["generated_files"]) == 1
            assert result["generated_files"][0]["name"] == "output.pdf"

            # 4. Verify that the skill is now saved and cached in the database!
            async with get_db_session(bypass_rls=True) as session:
                stmt = select(Skill).where(Skill.workspace_id == workspace_id, Skill.name == "document_generator")
                db_skill = (await session.execute(stmt)).scalar_one_or_none()

                assert db_skill is not None
                assert db_skill.is_active is True
                assert "def generate_pdf" in db_skill.source_code
                assert "def generate_xlsx" in db_skill.source_code
                assert "weasyprint" in db_skill.dependencies

                logger.info("  [PASS] document_generator skill successfully installed and cached on demand!")

            # 5. Verify that in the payload to Modal, the skill was dynamically mounted!
            call_args = mock_post.call_args[1]
            payload = json.loads(call_args["content"])
            
            assert "mounted_skills" in payload
            assert "document_generator" in payload["mounted_skills"]
            assert "def generate_pdf" in payload["mounted_skills"]["document_generator"]["code"]
            assert "weasyprint" in payload["dependencies"]
            assert payload["memory_tier"] == "heavy" # Promoted because of weasyprint/docx dependencies!

            logger.info("  [PASS] document_generator was correctly mounted in the sandbox runner payload.")

async def main():
    try:
        await test_dynamic_skill_installation_and_execution()
        logger.info("=" * 60)
        logger.info("[ALL TESTS PASSED] Dynamic document generator skill verified successfully!")
        logger.info("=" * 60)
        sys.exit(0)
    except AssertionError as ae:
        logger.error(f"[TESTS FAILED] Assertion failed: {ae}", exc_info=True)
        sys.exit(1)
    except Exception as e:
        logger.error(f"[TESTS FAILED] Verification suite failed: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
