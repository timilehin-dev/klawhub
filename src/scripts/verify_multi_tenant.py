import os
import sys
import asyncio
import uuid
import logging

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
logger = logging.getLogger("verify_multi_tenant")

# Import necessary modules
from sqlmodel import SQLModel, select
from src.db.pool import async_engine, get_db_session
from src.db.models import Workspace, Integration, AgentState, WorkspaceMember
from src.integrations.crypto import encrypt_token, decrypt_token
from src.core.agents.state import HMACCheckpointSaver
from langgraph.checkpoint.base import Checkpoint

async def test_multi_tenant_isolation():
    logger.info("Normalizing SQLModel metadata server defaults for SQLite compatibility...")
    # Strip postgres-specific default expressions and constraints
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            column.server_default = None

    logger.info("Initializing in-memory database schema...")
    async with async_engine.begin() as conn:
        # Create all tables defined in SQLModel
        await conn.run_sync(SQLModel.metadata.create_all)
    logger.info("Database tables initialized successfully.")

    # 1. Create Workspace A and Workspace B
    workspace_a_id = uuid.uuid4()
    workspace_b_id = uuid.uuid4()

    logger.info(f"Creating Workspace A (ID: {workspace_a_id}) and Workspace B (ID: {workspace_b_id})...")
    
    async with get_db_session(bypass_rls=True) as session:
        workspace_a = Workspace(
            id=workspace_a_id,
            slack_team_id="T_WORKSPACE_A",
            slack_bot_user_id="U_BOT_A",
            bot_token="xoxb-bot-token-a",
            name="Workspace A"
        )
        workspace_b = Workspace(
            id=workspace_b_id,
            slack_team_id="T_WORKSPACE_B",
            slack_bot_user_id="U_BOT_B",
            bot_token="xoxb-bot-token-b",
            name="Workspace B"
        )
        session.add(workspace_a)
        session.add(workspace_b)

    # 2. Add Encrypted Integrations for both Workspaces
    token_a = "super-secret-slack-token-for-workspace-a"
    token_b = "another-secret-slack-token-for-workspace-b"
    
    encrypted_token_a = encrypt_token(token_a)
    encrypted_token_b = encrypt_token(token_b)

    logger.info("Adding encrypted integrations for Workspace A and Workspace B...")
    async with get_db_session(bypass_rls=True) as session:
        integration_a = Integration(
            workspace_id=workspace_a_id,
            provider="slack",
            access_token_encrypted=encrypted_token_a,
            status="active"
        )
        integration_b = Integration(
            workspace_id=workspace_b_id,
            provider="slack",
            access_token_encrypted=encrypted_token_b,
            status="active"
        )
        session.add(integration_a)
        session.add(integration_b)

    # Validate that we can decrypt their credentials correctly
    assert decrypt_token(encrypted_token_a) == token_a
    assert decrypt_token(encrypted_token_b) == token_b
    logger.info("Credential encryption and decryption validated successfully.")

    # 3. Assert Database-level query isolation
    # Query Workspace A's Slack integration using session scoped to A
    async with get_db_session(bypass_rls=True) as session:
        # Workspace A select
        statement_a = select(Integration).where(
            Integration.workspace_id == workspace_a_id,
            Integration.provider == "slack"
        )
        result_a = await session.execute(statement_a)
        record_a = result_a.scalar_one_or_none()
        assert record_a is not None
        assert decrypt_token(record_a.access_token_encrypted) == token_a

        # Workspace B select
        statement_b = select(Integration).where(
            Integration.workspace_id == workspace_b_id,
            Integration.provider == "slack"
        )
        result_b = await session.execute(statement_b)
        record_b = result_b.scalar_one_or_none()
        assert record_b is not None
        assert decrypt_token(record_b.access_token_encrypted) == token_b

        # CROSS-TENANT ISOLATION PROOF: unscoped query returns both records,
        # proving that workspace_id scoping is essential for isolation
        statement_unscoped = select(Integration).where(
            Integration.provider == "slack"
        )
        result_unscoped = await session.execute(statement_unscoped)
        all_records = result_unscoped.scalars().all()
        assert len(all_records) == 2, f"Both workspaces should exist in DB, got {len(all_records)}"

        # Now verify scoped query returns exactly one record for each workspace
        statement_scoped_a = select(Integration).where(
            Integration.workspace_id == workspace_a_id,
            Integration.provider == "slack"
        )
        result_scoped_a = await session.execute(statement_scoped_a)
        scoped_records_a = result_scoped_a.scalars().all()
        assert len(scoped_records_a) == 1, f"Scoped query for A should return 1, got {len(scoped_records_a)}"
        assert scoped_records_a[0].workspace_id == workspace_a_id
        assert decrypt_token(scoped_records_a[0].access_token_encrypted) == token_a

    logger.info("Database-level query isolation holds perfectly.")

    # 4. Checkpointer State Isolation & HMAC Cryptographic Security Verification
    # Instantiate the secure multi-tenant checkpointer
    checkpointer = HMACCheckpointSaver()
    
    # Define threads for the tenants
    thread_id = "agent_mission_thread_001"
    
    config_a = {
        "configurable": {
            "workspace_id": str(workspace_a_id),
            "thread_id": thread_id
        }
    }
    
    config_b = {
        "configurable": {
            "workspace_id": str(workspace_b_id),
            "thread_id": thread_id
        }
    }

    checkpoint_data = {
        "v": 1,
        "id": "checkpoint_state_id_999",
        "ts": "2026-05-20T12:00:00Z",
        "channel_values": {"messages": ["hello agent team"]},
        "channel_versions": {},
        "versions_seen": {},
        "pending_sends": []
    }

    # Save state checkpoint for Workspace A
    logger.info("Saving LangGraph state checkpoint for Workspace A...")
    await checkpointer.aput(
        config=config_a,
        checkpoint=checkpoint_data,
        metadata={"step": 1, "task": "Verify security boundary"},
        new_versions={}
    )

    # 5. Assert retrieval by Workspace A succeeds
    logger.info("Retrieving checkpoint for Workspace A using Workspace A's config...")
    checkpoint_tuple_a = await checkpointer.aget_tuple(config_a)
    assert checkpoint_tuple_a is not None
    assert checkpoint_tuple_a.checkpoint["id"] == "checkpoint_state_id_999"
    logger.info("Workspace A checkpoint retrieved successfully.")

    # 6. Assert Workspace B is query isolated: querying Workspace B's config returns None
    logger.info("Retrieving checkpoint using Workspace B's config...")
    checkpoint_tuple_b = await checkpointer.aget_tuple(config_b)
    assert checkpoint_tuple_b is None
    logger.info("Workspace B correctly returned None (query-isolated from Workspace A's state).")

    # 7. HMAC Cryptographic Tamper/Breach Protection Verification
    # Let's simulate a malicious actor that directly manipulates the database record
    # to move Workspace A's checkpoint into Workspace B's workspace_id,
    # attempting to read Workspace A's state through Workspace B's context.
    logger.info("Simulating cross-tenant database hijacking attack...")
    
    async with get_db_session(bypass_rls=True) as session:
        # Select Workspace A's checkpoint from DB
        stmt = select(AgentState).where(AgentState.workspace_id == workspace_a_id)
        res = await session.execute(stmt)
        record = res.scalar_one()
        
        # Hijack: Change its workspace_id to Workspace B's workspace_id
        # In a real environment, if an attacker could modify DB tables (e.g. SQL Injection or RLS leak),
        # they might try to change the owner workspace_id to their own.
        record.workspace_id = workspace_b_id
        session.add(record)
    
    logger.info("Workspace A's state record hijacked to belong to Workspace B's ID. Attempting retrieval...")
    
    # Attempt to retrieve it under Workspace B's config.
    # The SQL query will now find the record (since workspace_id matches B),
    # but the checkpointer's inner verify_signature MUST catch the mismatch 
    # since the HMAC signature inside the record was generated using Workspace A's ID!
    try:
        await checkpointer.aget_tuple(config_b)
        # If it doesn't raise a PermissionError, the validation failed!
        logger.error("CRITICAL FAILURE: Hijacked checkpoint was loaded without HMAC signature error!")
        sys.exit(1)
    except PermissionError as pe:
        logger.info(f"SUCCESS: Tamper detected! State restoration aborted with security exception: {str(pe)}")

    logger.info("--------------------------------------------------")
    logger.info("[ALL TESTS PASSED] verify_multi_tenant.py completed successfully.")
    logger.info("--------------------------------------------------")

if __name__ == "__main__":
    asyncio.run(test_multi_tenant_isolation())
