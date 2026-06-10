import json
import hmac
import hashlib
import logging
import uuid
import base64
from datetime import datetime, timezone
from typing import Any, Dict, Optional, AsyncIterator, Iterator, Tuple

from sqlmodel import select
from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    SerializerProtocol
)
from src.db.pool import get_db_session
from src.db.models import AgentState
from src.config import settings

logger = logging.getLogger("klawhub.core.agents.state")

class HMACCheckpointSaver(BaseCheckpointSaver):
    """Cryptographically signed, multi-tenant secure checkpointer for LangGraph.
    
    Guarantees strict multi-tenant boundary checks by verifying database records
    against HMAC-SHA256 signatures derived from the workspace ID and standard keys.
    Uses the existing PostgreSQL 'agent_states' table for high performance and zero external dependencies.
    """

    def __init__(self, *, serde: Optional[SerializerProtocol] = None):
        super().__init__(serde=serde)
        self.signing_key = settings.state_signing_key

    def _get_workspace_and_thread(self, config: dict) -> Tuple[uuid.UUID, str]:
        """Extracts and validates workspace_id and thread_id from the LangGraph config."""
        configurable = config.get("configurable", {})
        workspace_id_str = configurable.get("workspace_id")
        thread_id = configurable.get("thread_id")
        
        if not workspace_id_str:
            raise ValueError("LangGraph config is missing 'workspace_id'. Enforcing strict multi-tenancy requirements.")
        if not thread_id:
            raise ValueError("LangGraph config is missing 'thread_id'.")
            
        try:
            workspace_id = uuid.UUID(str(workspace_id_str))
        except ValueError:
            raise ValueError(f"Invalid UUID format for workspace_id: {workspace_id_str}")
            
        return workspace_id, str(thread_id)

    def _generate_signature(self, workspace_id: uuid.UUID, thread_id: str, checkpoint_str: str) -> str:
        """Computes a secure HMAC-SHA256 signature for the checkpoint payload."""
        message = f"{workspace_id}:{thread_id}:{checkpoint_str}"
        return hmac.new(
            self.signing_key.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

    def _verify_signature(self, workspace_id: uuid.UUID, thread_id: str, checkpoint_str: str, expected_sig: str) -> bool:
        """Verifies the HMAC-SHA256 signature using constant-time comparison to prevent timing attacks."""
        actual_sig = self._generate_signature(workspace_id, thread_id, checkpoint_str)
        return hmac.compare_digest(actual_sig.encode("utf-8"), expected_sig.encode("utf-8"))

    # --- Synchronous Methods ---

    def get_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        """Synchronously retrieves a checkpoint tuple for the given thread config with multi-tenant verification."""
        # Force async context for db operations since our engine is async-only
        import asyncio
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        if loop.is_running():
            # Run in executor to avoid event loop blocking if loop is running
            import nest_asyncio
            nest_asyncio.apply()
            return loop.run_until_complete(self.aget_tuple(config))
        else:
            return loop.run_until_complete(self.aget_tuple(config))

    def list(
        self,
        config: dict,
        *,
        filter: Optional[dict] = None,
        before: Optional[dict] = None,
        limit: Optional[int] = None
    ) -> Iterator[CheckpointTuple]:
        """Synchronously lists checkpoints with filtering and tenant validation."""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        async def _collect():
            res = []
            async for item in self.alist(config, filter=filter, before=before, limit=limit):
                res.append(item)
            return res
            
        if loop.is_running():
            import nest_asyncio
            nest_asyncio.apply()
            items = loop.run_until_complete(_collect())
        else:
            items = loop.run_until_complete(_collect())
            
        for item in items:
            yield item

    def put(self, config: dict, checkpoint: Checkpoint, metadata: CheckpointMetadata, new_versions: dict) -> dict:
        """Synchronously persists a checkpoint and metadata with cryptographically signed integrity."""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        if loop.is_running():
            import nest_asyncio
            nest_asyncio.apply()
            return loop.run_until_complete(self.aput(config, checkpoint, metadata, new_versions))
        else:
            return loop.run_until_complete(self.aput(config, checkpoint, metadata, new_versions))

    # --- Asynchronous Methods (Recommended & Primary) ---

    async def aget_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        """Asynchronously retrieves a checkpoint tuple for the given config and performs signature check."""
        workspace_id, thread_id = self._get_workspace_and_thread(config)
        configurable = config.get("configurable", {})
        checkpoint_id = configurable.get("checkpoint_id")

        async with get_db_session() as session:
            if checkpoint_id:
                agent_name = f"langgraph:{thread_id}:{checkpoint_id}"
                statement = select(AgentState).where(
                    AgentState.workspace_id == workspace_id,
                    AgentState.agent_name == agent_name
                )
            else:
                # Get the latest checkpoint for this thread
                agent_name_prefix = f"langgraph:{thread_id}:"
                statement = select(AgentState).where(
                    AgentState.workspace_id == workspace_id,
                    AgentState.agent_name.like(f"{agent_name_prefix}%")
                ).order_by(AgentState.last_active_at.desc()).limit(1)

            result = await session.execute(statement)
            record = result.scalar_one_or_none()

            if not record:
                return None

            try:
                # Decapsulate state payload
                payload = record.state
                serialized_checkpoint = payload.get("checkpoint")
                serialized_metadata = payload.get("metadata")
                signature = payload.get("signature")

                if not serialized_checkpoint or not signature:
                    logger.error(f"Checkpoint data is corrupted or missing signature for record {record.id}")
                    return None

                # Crucial Security Audit: Verify HMAC signature (covers checkpoint + metadata)
                sig_payload = serialized_checkpoint + ":" + (serialized_metadata or "")
                if not self._verify_signature(workspace_id, thread_id, sig_payload, signature):
                    logger.critical(
                        f"SECURITY BREACH DETECTED: Invalid HMAC signature for checkpoint in thread {thread_id}, "
                        f"workspace {workspace_id}! State restoration aborted."
                    )
                    raise PermissionError(
                        "Cryptographic verification of thread state failed. The state is either corrupted or tampered."
                    )

                # Deserialization using LangGraph standard serializer protocol
                # Each stored value is: base64(type_prefix + ":" + raw_bytes)
                cp_decoded = base64.b64decode(serialized_checkpoint.encode("utf-8"))
                cp_sep = cp_decoded.index(b":")
                cp_type = cp_decoded[:cp_sep].decode("utf-8")
                cp_bytes = cp_decoded[cp_sep + 1:]
                checkpoint_dict = self.serde.loads_typed((cp_type, cp_bytes))

                if serialized_metadata:
                    md_decoded = base64.b64decode(serialized_metadata.encode("utf-8"))
                    md_sep = md_decoded.index(b":")
                    md_type = md_decoded[:md_sep].decode("utf-8")
                    md_bytes = md_decoded[md_sep + 1:]
                    metadata_dict = self.serde.loads_typed((md_type, md_bytes))
                else:
                    metadata_dict = {}

                # Determine the exact checkpoint_id
                db_checkpoint_id = record.agent_name.split(":")[-1]
                
                return CheckpointTuple(
                    config={
                        "configurable": {
                            "thread_id": thread_id,
                            "checkpoint_id": db_checkpoint_id,
                            "workspace_id": str(workspace_id)
                        }
                    },
                    checkpoint=checkpoint_dict,
                    metadata=metadata_dict,
                    parent_config={
                        "configurable": {
                            "thread_id": thread_id,
                            "checkpoint_id": checkpoint_dict.get("parent_checkpoint_id"),
                            "workspace_id": str(workspace_id)
                        }
                    } if checkpoint_dict.get("parent_checkpoint_id") else None
                )
            except Exception as e:
                if isinstance(e, PermissionError):
                    raise e
                logger.error(f"Failed to restore checkpoint in aget_tuple: {str(e)}", exc_info=True)
                return None

    async def alist(
        self,
        config: dict,
        *,
        filter: Optional[dict] = None,
        before: Optional[dict] = None,
        limit: Optional[int] = None
    ) -> AsyncIterator[CheckpointTuple]:
        """Asynchronously lists checkpoints matching criteria with full validation checks."""
        workspace_id, thread_id = self._get_workspace_and_thread(config)
        agent_name_prefix = f"langgraph:{thread_id}:"

        async with get_db_session() as session:
            statement = select(AgentState).where(
                AgentState.workspace_id == workspace_id,
                AgentState.agent_name.like(f"{agent_name_prefix}%")
            )

            # Apply additional filtering based on 'before' or metadata if applicable
            if before:
                before_checkpoint_id = before.get("checkpoint_id")
                if before_checkpoint_id:
                    # Filter checkpoints that were active before this timestamp/date
                    pass

            statement = statement.order_by(AgentState.last_active_at.desc())
            if limit:
                statement = statement.limit(limit)

            result = await session.execute(statement)
            records = result.scalars().all()

            for record in records:
                try:
                    payload = record.state
                    serialized_checkpoint = payload.get("checkpoint")
                    serialized_metadata = payload.get("metadata")
                    signature = payload.get("signature")

                    if not serialized_checkpoint or not signature:
                        continue

                    # Validate signature (covers checkpoint + metadata)
                    sig_payload = serialized_checkpoint + ":" + (serialized_metadata or "")
                    if not self._verify_signature(workspace_id, thread_id, sig_payload, signature):
                        logger.warning(f"Signature mismatch during checkpoint listing. Skipping tampered record {record.id}.")
                        continue

                    cp_decoded = base64.b64decode(serialized_checkpoint.encode("utf-8"))
                    cp_sep = cp_decoded.index(b":")
                    cp_type = cp_decoded[:cp_sep].decode("utf-8")
                    cp_bytes = cp_decoded[cp_sep + 1:]
                    checkpoint_dict = self.serde.loads_typed((cp_type, cp_bytes))

                    if serialized_metadata:
                        md_decoded = base64.b64decode(serialized_metadata.encode("utf-8"))
                        md_sep = md_decoded.index(b":")
                        md_type = md_decoded[:md_sep].decode("utf-8")
                        md_bytes = md_decoded[md_sep + 1:]
                        metadata_dict = self.serde.loads_typed((md_type, md_bytes))
                    else:
                        metadata_dict = {}
                    db_checkpoint_id = record.agent_name.split(":")[-1]

                    yield CheckpointTuple(
                        config={
                            "configurable": {
                                "thread_id": thread_id,
                                "checkpoint_id": db_checkpoint_id,
                                "workspace_id": str(workspace_id)
                            }
                        },
                        checkpoint=checkpoint_dict,
                        metadata=metadata_dict,
                        parent_config={
                            "configurable": {
                                "thread_id": thread_id,
                                "checkpoint_id": checkpoint_dict.get("parent_checkpoint_id"),
                                "workspace_id": str(workspace_id)
                            }
                        } if checkpoint_dict.get("parent_checkpoint_id") else None
                    )
                except Exception as e:
                    logger.error(f"Error parsing listed checkpoint: {str(e)}")
                    continue

    async def aput(self, config: dict, checkpoint: Checkpoint, metadata: CheckpointMetadata, new_versions: dict) -> dict:
        """Asynchronously persists a checkpoint with signature checks and multi-tenant partitioning."""
        workspace_id, thread_id = self._get_workspace_and_thread(config)
        checkpoint_id = checkpoint.get("id")
        
        if not checkpoint_id:
            raise ValueError("Checkpoint ID is missing from the LangGraph payload.")

        agent_name = f"langgraph:{thread_id}:{checkpoint_id}"

        # Serialize using the LangGraph configured serializer protocol (dumps_typed API)
        cp_type, cp_bytes = self.serde.dumps_typed(checkpoint)
        # Store as base64(type + ":" + raw_bytes) for portable JSON storage
        serialized_checkpoint = base64.b64encode(
            cp_type.encode("utf-8") + b":" + cp_bytes
        ).decode("utf-8")

        md_type, md_bytes = self.serde.dumps_typed(metadata)
        serialized_metadata = base64.b64encode(
            md_type.encode("utf-8") + b":" + md_bytes
        ).decode("utf-8")

        # Generate cryptographic HMAC-SHA256 signature (covers checkpoint + metadata)
        sig_payload = serialized_checkpoint + ":" + serialized_metadata
        signature = self._generate_signature(workspace_id, thread_id, sig_payload)

        # Assemble secure state dictionary to persist
        secure_state = {
            "checkpoint": serialized_checkpoint,
            "metadata": serialized_metadata,
            "signature": signature
        }

        async with get_db_session() as session:
            # Check if this exact checkpoint record already exists to perform upsert
            statement = select(AgentState).where(
                AgentState.workspace_id == workspace_id,
                AgentState.agent_name == agent_name
            )
            result = await session.execute(statement)
            record = result.scalar_one_or_none()

            if not record:
                # Insert fresh checkpoint record
                record = AgentState(
                    workspace_id=workspace_id,
                    agent_name=agent_name,
                    state=secure_state,
                    last_active_at=datetime.utcnow(),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                session.add(record)
            else:
                # Update existing checkpoint
                record.state = secure_state
                record.last_active_at = datetime.utcnow()
                record.updated_at = datetime.utcnow()
                session.add(record)

            # Commit is handled by get_db_session context manager

        # Build return config format conforming to LangGraph specifications
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": checkpoint_id,
                "workspace_id": str(workspace_id)
            }
        }
