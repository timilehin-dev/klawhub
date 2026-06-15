from typing import Dict, Any, Optional
from src.db.operations import create_task, list_tasks, update_task, delete_task

async def create_task_tool(workspace_id: str, title: str, description: Optional[str] = None, priority: str = "medium", payload: Optional[Dict[str, Any]] = None, created_by: Optional[str] = None) -> str:
    """Creates a new task in the workspace for tracking and agent assignment."""
    try:
        task_id = await create_task(
            workspace_id=workspace_id,
            title=title,
            description=description,
            status="pending",
            priority=priority,
            payload=payload or {},
            created_by=created_by
        )
        return f"Successfully created task '{title}' with ID: {task_id}"
    except Exception as e:
        return f"Error creating task: {str(e)}"

async def list_tasks_tool(workspace_id: str, status: Optional[str] = None) -> str:
    """Lists workspace tasks, optionally filtered by status (pending, running, completed, failed, paused)."""
    try:
        tasks = await list_tasks(workspace_id, status)
        if not tasks:
            filter_msg = f" with status '{status}'" if status else ""
            return f"No tasks found in this workspace{filter_msg}."
            
        output = [f"**Workspace Tasks ({status or 'All'}):**"]
        for t in tasks:
            due = t.get("due_at", "No due date")
            assigned = t.get("assigned_agent", "Unassigned")
            output.append(
                f"- **{t['title']}** (ID: `{t['id']}`)\n"
                f"  Status: `{t['status']}` | Priority: `{t['priority']}` | Assigned: {assigned} | Due: {due}"
            )
        return "\n".join(output)
    except Exception as e:
        return f"Error listing tasks: {str(e)}"

async def update_task_tool(task_id: str, updates: Dict[str, Any]) -> str:
    """Updates a task's status, priority, description, or execution logs/results."""
    try:
        await update_task(task_id, updates)
        return f"Successfully updated task {task_id}."
    except Exception as e:
        return f"Error updating task: {str(e)}"

async def delete_task_tool(task_id: str) -> str:
    """Removes a task from the workspace."""
    try:
        await delete_task(task_id)
        return f"Successfully deleted task {task_id}."
    except Exception as e:
        return f"Error deleting task: {str(e)}"
