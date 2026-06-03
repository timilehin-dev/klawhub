import logging
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlmodel import select
from src.db.pool import get_db_session
from src.db.models import Task

logger = logging.getLogger("klawhub.core.tools.task_control")

# --- Validation constants ---
VALID_TASK_TYPES = {"action_item", "bug_fix", "research", "feature_request"}
VALID_TASK_STATUSES = {"pending", "completed"}
MAX_REQUEST_LENGTH = 4000


def _validate_type(task_type: str) -> str:
    """Validates task type against allow-list. Returns canonical lowercase value."""
    normalized = (task_type or "action_item").strip().lower()
    if normalized not in VALID_TASK_TYPES:
        raise ValueError(
            f"Invalid task type '{task_type}'. Must be one of: {sorted(VALID_TASK_TYPES)}"
        )
    return normalized


def _validate_status(status: str) -> str:
    """Validates task status against allow-list. Returns canonical lowercase value."""
    normalized = (status or "pending").strip().lower()
    if normalized not in VALID_TASK_STATUSES:
        raise ValueError(
            f"Invalid task status '{status}'. Must be one of: {sorted(VALID_TASK_STATUSES)}"
        )
    return normalized


class TaskControl:
    """Multi-tenant safe task management controller.

    Guarantees absolute data isolation by requiring workspace_id validation
    across all operations (create, list, update_status, delete).
    """

    @classmethod
    async def create_task(
        cls,
        workspace_id: uuid.UUID,
        slack_user_id: str,
        request: str,
        type: str = "action_item",
        status: str = "pending",
        channel_id: Optional[str] = None,
        thread_ts: Optional[str] = None
    ) -> Dict[str, Any]:
        """Creates and persists a new task for the workspace."""
        logger.info(f"Creating task for workspace {workspace_id} by user {slack_user_id}")

        # --- Input validation ---
        clean_request = (request or "").strip()
        if not clean_request:
            raise ValueError("Task request text is required.")
        if len(clean_request) > MAX_REQUEST_LENGTH:
            raise ValueError(f"Task request exceeds {MAX_REQUEST_LENGTH} characters.")
        valid_type = _validate_type(type)
        valid_status = _validate_status(status)

        new_task = Task(
            workspace_id=workspace_id,
            slack_user_id=slack_user_id,
            slack_channel_id=channel_id or "",
            slack_thread_ts=thread_ts,
            type=valid_type,
            request=clean_request,
            status=valid_status
        )

        async with get_db_session() as session:
            session.add(new_task)
            await session.commit()

            logger.info(f"Successfully created task {new_task.id} for workspace {workspace_id}")
            return {
                "status": "success",
                "message": f"Task successfully created.",
                "task": {
                    "id": str(new_task.id),
                    "request": new_task.request,
                    "type": new_task.type,
                    "status": new_task.status,
                    "created_at": new_task.created_at.isoformat() if new_task.created_at else None
                }
            }

    @classmethod
    async def list_tasks(cls, workspace_id: uuid.UUID) -> List[Dict[str, Any]]:
        """Lists all tasks securely scoped to the active workspace_id."""
        logger.info(f"Listing tasks for workspace {workspace_id}")

        async with get_db_session() as session:
            statement = select(Task).where(Task.workspace_id == workspace_id).order_by(Task.created_at.desc())
            result = await session.execute(statement)
            tasks = result.scalars().all()

            return [
                {
                    "id": str(t.id),
                    "request": t.request,
                    "type": t.type,
                    "status": t.status,
                    "created_at": t.created_at.isoformat() if t.created_at else None
                }
                for t in tasks
            ]

    @classmethod
    async def get_task(
        cls,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID
    ) -> Dict[str, Any]:
        """Retrieves a single task by ID, scoped to the active workspace.

        Returns a friendly dict (not raises) when the task is missing so the
        worker