import logging
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlmodel import select, delete
from croniter import croniter
from src.db.pool import get_db_session
from src.db.models import Schedule

logger = logging.getLogger("klawhub.core.tools.schedule_control")

class ScheduleControl:
    """Multi-tenant safe schedule management controller.
    
    Guarantees absolute data isolation by requiring workspace_id validation
    across all operations (create, list, pause, resume, update, delete).
    """

    @classmethod
    async def create_schedule(
        cls,
        workspace_id: uuid.UUID,
        slack_user_id: str,
        name: str,
        cron_expr: str,
        action: str,
        channel_id: Optional[str] = None,
        timezone: str = "UTC"
    ) -> Dict[str, Any]:
        """Creates and persists a new cron trigger schedule for the workspace."""
        logger.info(f"Creating schedule '{name}' for workspace {workspace_id}")
        
        # Validate cron expression
        if not cron_expr or not croniter.is_valid(cron_expr):
            raise ValueError(f"Invalid cron expression: '{cron_expr}'. Must have 5 fields.")

        new_schedule = Schedule(
            workspace_id=workspace_id,
            slack_user_id=slack_user_id,
            name=name,
            cron_expr=cron_expr,
            timezone=timezone,
            action=action,
            channel_id=channel_id,
            is_active=True
        )

        async with get_db_session() as session:
            session.add(new_schedule)
            await session.commit()
            await session.refresh(new_schedule)
            
            logger.info(f"Successfully created schedule {new_schedule.id} for workspace {workspace_id}")
            return {
                "status": "success",
                "message": f"Schedule '{name}' successfully created.",
                "schedule": {
                    "id": str(new_schedule.id),
                    "name": new_schedule.name,
                    "cron_expr": new_schedule.cron_expr,
                    "timezone": new_schedule.timezone,
                    "action": new_schedule.action,
                    "channel_id": new_schedule.channel_id,
                    "is_active": new_schedule.is_active
                }
            }

    @classmethod
    async def list_schedules(cls, workspace_id: uuid.UUID) -> List[Dict[str, Any]]:
        """Lists all active and paused schedules securely scoped to the active workspace_id."""
        logger.info(f"Listing schedules for workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Schedule).where(Schedule.workspace_id == workspace_id)
            result = await session.execute(statement)
            schedules = result.scalars().all()
            
            return [
                {
                    "id": str(s.id),
                    "name": s.name,
                    "cron_expr": s.cron_expr,
                    "timezone": s.timezone,
                    "action": s.action,
                    "channel_id": s.channel_id,
                    "is_active": s.is_active,
                    "fail_count": s.fail_count
                }
                for s in schedules
            ]

    @classmethod
    async def toggle_schedule_status(
        cls,
        workspace_id: uuid.UUID,
        schedule_id: uuid.UUID,
        is_active: bool
    ) -> Dict[str, Any]:
        """Toggles a schedule's active status securely after verifying workspace ownership."""
        status_label = "activate" if is_active else "pause"
        logger.info(f"Attempting to {status_label} schedule {schedule_id} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Schedule).where(
                Schedule.id == schedule_id,
                Schedule.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            schedule = result.scalar_one_or_none()
            
            if not schedule:
                raise ValueError(f"Schedule with ID '{schedule_id}' not found in your workspace.")
                
            schedule.is_active = is_active
            schedule.updated_at = datetime.utcnow()
            
            if is_active:
                # Reset consecutive failure counters upon manual reactivation
                schedule.fail_count = 0
            
            await session.commit()
            
            logger.info(f"Schedule {schedule_id} status updated to is_active={is_active}")
            return {
                "status": "success",
                "message": f"Schedule '{schedule.name}' has been successfully {'reactivated' if is_active else 'paused'}.",
                "schedule_id": str(schedule.id),
                "is_active": schedule.is_active
            }

    @classmethod
    async def delete_schedule(cls, workspace_id: uuid.UUID, schedule_id: uuid.UUID) -> Dict[str, Any]:
        """Permanently deletes a schedule record securely after verifying workspace ownership."""
        logger.info(f"Attempting to delete schedule {schedule_id} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            # Check ownership first
            statement = select(Schedule).where(
                Schedule.id == schedule_id,
                Schedule.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            schedule = result.scalar_one_or_none()
            
            if not schedule:
                raise ValueError(f"Schedule with ID '{schedule_id}' not found in your workspace.")
                
            await session.delete(schedule)
            await session.commit()
            
            logger.info(f"Successfully deleted schedule {schedule_id} from workspace {workspace_id}")
            return {
                "status": "success",
                "message": f"Schedule '{schedule.name}' has been successfully deleted.",
                "schedule_id": str(schedule_id)
            }

    @classmethod
    async def update_schedule(
        cls,
        workspace_id: uuid.UUID,
        schedule_id: uuid.UUID,
        name: Optional[str] = None,
        cron_expr: Optional[str] = None,
        action: Optional[str] = None,
        channel_id: Optional[str] = None,
        timezone: Optional[str] = None
    ) -> Dict[str, Any]:
        """Securly updates a schedule's configurations after ownership checks."""
        logger.info(f"Attempting to update schedule {schedule_id} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Schedule).where(
                Schedule.id == schedule_id,
                Schedule.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            schedule = result.scalar_one_or_none()
            
            if not schedule:
                raise ValueError(f"Schedule with ID '{schedule_id}' not found in your workspace.")
                
            if name is not None:
                schedule.name = name
            if cron_expr is not None:
                if not croniter.is_valid(cron_expr):
                    raise ValueError(f"Invalid cron expression: '{cron_expr}'")
                schedule.cron_expr = cron_expr
            if action is not None:
                schedule.action = action
            if channel_id is not None:
                schedule.channel_id = channel_id
            if timezone is not None:
                schedule.timezone = timezone
                
            schedule.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(schedule)
            
            logger.info(f"Successfully updated schedule {schedule_id}")
            return {
                "status": "success",
                "message": f"Schedule '{schedule.name}' successfully updated.",
                "schedule": {
                    "id": str(schedule.id),
                    "name": schedule.name,
                    "cron_expr": schedule.cron_expr,
                    "timezone": schedule.timezone,
                    "action": schedule.action,
                    "channel_id": schedule.channel_id,
                    "is_active": schedule.is_active
                }
            }
