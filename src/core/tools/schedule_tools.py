from typing import Dict, Any, List, Optional
from src.db.operations import create_schedule, list_schedules, update_schedule, delete_schedule
from croniter import croniter

def validate_cron(cron_expr: str) -> bool:
    """Validates if a string is a valid 5-field cron expression."""
    try:
        return croniter.is_valid(cron_expr)
    except Exception:
        return False

async def create_schedule_tool(workspace_id: str, name: str, schedule_type: str, cron_expr: Optional[str], channel_id: Optional[str], payload: Dict[str, Any], created_by: Optional[str] = None) -> str:
    """Creates a new cron schedule, standup, or reminder for a workspace."""
    if cron_expr and not validate_cron(cron_expr):
        return "Error: Invalid cron expression format. Must be standard 5 fields (e.g. '*/5 * * * *')."
    
    try:
        schedule_id = await create_schedule(
            workspace_id=workspace_id,
            name=name,
            schedule_type=schedule_type,
            cron_expr=cron_expr,
            channel_id=channel_id,
            payload=payload,
            created_by=created_by
        )
        return f"Successfully created schedule '{name}' with ID: {schedule_id}"
    except Exception as e:
        return f"Error creating schedule: {str(e)}"

async def list_schedules_tool(workspace_id: str) -> str:
    """Lists all active and inactive schedules in the workspace."""
    try:
        schedules = await list_schedules(workspace_id)
        if not schedules:
            return "No schedules found in this workspace."
            
        output = ["**Active Workspace Schedules:**"]
        for s in schedules:
            status = "Active" if s.get("is_active", True) else "Paused"
            cron = s.get("cron_expr", "N/A")
            output.append(
                f"- **{s['name']}** (ID: `{s['id']}`)\n"
                f"  Type: {s['schedule_type']} | Cron: `{cron}` | Status: {status}"
            )
        return "\n".join(output)
    except Exception as e:
        return f"Error listing schedules: {str(e)}"

async def update_schedule_tool(schedule_id: str, updates: Dict[str, Any]) -> str:
    """Updates an existing schedule (e.g., changes cron_expr, pauses/resumes it, or modifies payload)."""
    if "cron_expr" in updates and updates["cron_expr"] and not validate_cron(updates["cron_expr"]):
        return "Error: Invalid cron expression format."
        
    try:
        await update_schedule(schedule_id, updates)
        return f"Successfully updated schedule {schedule_id}."
    except Exception as e:
        return f"Error updating schedule: {str(e)}"

async def delete_schedule_tool(schedule_id: str) -> str:
    """Deletes/removes a schedule from the workspace."""
    try:
        await delete_schedule(schedule_id)
        return f"Successfully deleted schedule {schedule_id}."
    except Exception as e:
        return f"Error deleting schedule: {str(e)}"
