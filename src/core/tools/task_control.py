import logging
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlmodel import select
from src.db.pool import get_db_session
from src.db.models import Task

logger = logging.getLogger("klawhub.core.tools.task_control")

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
        
        new_task = Task(
            workspace_id=workspace_id,
            slack_user_id=slack_user_id,
            slack_channel_id=channel_id or "",
            slack_thread_ts=thread_ts,
            type=type,
            request=request,
            status=status
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
    async def update_task_status(
        cls,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID,
        status: str
    ) -> Dict[str, Any]:
        """Updates a task's status securely after verifying workspace ownership."""
        logger.info(f"Attempting to update status of task {task_id} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Task).where(
                Task.id == task_id,
                Task.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            task = result.scalar_one_or_none()
            
            if not task:
                raise ValueError(f"Task with ID '{task_id}' not found in your workspace.")
                
            task.status = status
            task.updated_at = datetime.utcnow()
            await session.commit()
            
            logger.info(f"Task {task_id} status updated to {status}")
            return {
                "status": "success",
                "message": f"Task status updated to '{status}'.",
                "task_id": str(task.id),
                "status_updated": task.status
            }

    @classmethod
    async def delete_task(cls, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Dict[str, Any]:
        """Permanently deletes a task record securely after verifying workspace ownership."""
        logger.info(f"Attempting to delete task {task_id} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Task).where(
                Task.id == task_id,
                Task.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            task = result.scalar_one_or_none()
            
            if not task:
                raise ValueError(f"Task with ID '{task_id}' not found in your workspace.")
                
            await session.delete(task)
            await session.commit()
            
            logger.info(f"Successfully deleted task {task_id} from workspace {workspace_id}")
            return {
                "status": "success",
                "message": f"Task has been successfully deleted.",
                "task_id": str(task_id)
            }
