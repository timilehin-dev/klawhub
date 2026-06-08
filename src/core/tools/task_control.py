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


def _serialize_task(task: Task) -> Dict[str, Any]:
    """Converts a Task model into the worker-facing response shape."""
    return {
        "id": str(task.id),
        "workspace_id": str(task.workspace_id),
        "slack_user_id": task.slack_user_id,
        "slack_channel_id": task.slack_channel_id,
        "slack_thread_ts": task.slack_thread_ts,
        "request": task.request,
        "type": task.type,
        "status": task.status,
        "result": task.result,
        "output_filename": task.output_filename,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


class TaskControl:
    """Multi-tenant safe task management controller.

    Guarantees absolute data isolation by requiring workspace_id validation
    across all operations (create, list, get, update_status, delete).
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
        thread_ts: Optional[str] = None,
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
            status=valid_status,
        )

        async with get_db_session() as session:
            session.add(new_task)
            await session.commit()

            logger.info(f"Successfully created task {new_task.id} for workspace {workspace_id}")
            return {
                "status": "success",
                "message": "Task successfully created.",
                "task": _serialize_task(new_task),
            }

    @classmethod
    async def create(
        cls,
        workspace_id: uuid.UUID,
        slack_user_id: str,
        request: str,
        type: str = "action_item",
        status: str = "pending",
        channel_id: Optional[str] = None,
        thread_ts: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Alias for create_task used by generic task-control callers."""
        return await cls.create_task(
            workspace_id=workspace_id,
            slack_user_id=slack_user_id,
            request=request,
            type=type,
            status=status,
            channel_id=channel_id,
            thread_ts=thread_ts,
        )

    @classmethod
    async def list_tasks(cls, workspace_id: uuid.UUID) -> List[Dict[str, Any]]:
        """Lists all tasks securely scoped to the active workspace_id."""
        logger.info(f"Listing tasks for workspace {workspace_id}")

        async with get_db_session() as session:
            statement = (
                select(Task)
                .where(Task.workspace_id == workspace_id)
                .order_by(Task.created_at.desc())
            )
            result = await session.execute(statement)
            tasks = result.scalars().all()

            return [_serialize_task(task) for task in tasks]

    @classmethod
    async def list(cls, workspace_id: uuid.UUID) -> List[Dict[str, Any]]:
        """Alias for list_tasks used by generic task-control callers."""
        return await cls.list_tasks(workspace_id)

    @classmethod
    async def get_task(
        cls,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID,
    ) -> Dict[str, Any]:
        """Retrieves a single task by ID, scoped to the active workspace."""
        logger.info(f"Getting task {task_id} for workspace {workspace_id}")

        async with get_db_session() as session:
            task = await cls._get_task_for_workspace(session, workspace_id, task_id)
            if not task:
                raise ValueError(f"Task with ID '{task_id}' not found in your workspace.")

            return {"status": "success", "task": _serialize_task(task)}

    @classmethod
    async def get(
        cls,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID,
    ) -> Dict[str, Any]:
        """Alias for get_task used by generic task-control callers."""
        return await cls.get_task(workspace_id=workspace_id, task_id=task_id)

    @classmethod
    async def update_task_status(
        cls,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID,
        status: str,
    ) -> Dict[str, Any]:
        """Updates a task's status after verifying workspace ownership."""
        valid_status = _validate_status(status)
        logger.info(f"Updating task {task_id} status to {valid_status} in workspace {workspace_id}")

        async with get_db_session() as session:
            task = await cls._get_task_for_workspace(session, workspace_id, task_id)
            if not task:
                raise ValueError(f"Task with ID '{task_id}' not found in your workspace.")

            task.status = valid_status
            task.updated_at = datetime.utcnow()
            await session.commit()

            logger.info(f"Successfully updated task {task_id} status to {valid_status}")
            return {
                "status": "success",
                "message": f"Task status successfully updated to '{valid_status}'.",
                "task": _serialize_task(task),
            }

    @classmethod
    async def update_status(
        cls,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID,
        status: str,
    ) -> Dict[str, Any]:
        """Alias for update_task_status used by generic task-control callers."""
        return await cls.update_task_status(
            workspace_id=workspace_id,
            task_id=task_id,
            status=status,
        )

    @classmethod
    async def delete_task(cls, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Dict[str, Any]:
        """Permanently deletes a task after verifying workspace ownership."""
        logger.info(f"Deleting task {task_id} from workspace {workspace_id}")

        async with get_db_session() as session:
            task = await cls._get_task_for_workspace(session, workspace_id, task_id)
            if not task:
                raise ValueError(f"Task with ID '{task_id}' not found in your workspace.")

            await session.delete(task)
            await session.commit()

            logger.info(f"Successfully deleted task {task_id} from workspace {workspace_id}")
            return {
                "status": "success",
                "message": "Task successfully deleted.",
                "task_id": str(task_id),
            }

    @classmethod
    async def delete(cls, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Dict[str, Any]:
        """Alias for delete_task used by generic task-control callers."""
        return await cls.delete_task(workspace_id=workspace_id, task_id=task_id)

    @staticmethod
    async def _get_task_for_workspace(session, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Optional[Task]:
        """Fetches one task by task ID and workspace ID to enforce tenant isolation."""
        statement = select(Task).where(
            Task.id == task_id,
            Task.workspace_id == workspace_id,
        )
        result = await session.execute(statement)
        return result.scalar_one_or_none()
