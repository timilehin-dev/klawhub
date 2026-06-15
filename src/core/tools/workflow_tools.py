import json
import httpx
from typing import Dict, Any, List, Optional
from src.db.operations import create_workflow, list_workflows, update_workflow, delete_workflow
from src.config import settings

async def create_workflow_tool(workspace_id: str, name: str, description: Optional[str], trigger_type: str, trigger_config: Dict[str, Any], steps: List[Dict[str, Any]], created_by: Optional[str] = None) -> str:
    """Creates a new automation workflow with defined trigger and sequential execution steps."""
    try:
        workflow_id = await create_workflow(
            workspace_id=workspace_id,
            name=name,
            description=description,
            trigger_type=trigger_type,
            trigger_config=trigger_config,
            steps=steps,
            created_by=created_by
        )
        return f"Successfully created workflow '{name}' with ID: {workflow_id}"
    except Exception as e:
        return f"Error creating workflow: {str(e)}"

async def list_workflows_tool(workspace_id: str) -> str:
    """Lists all automated workflows in the workspace."""
    try:
        workflows = await list_workflows(workspace_id)
        if not workflows:
            return "No workflows found in this workspace."
            
        output = ["**Workspace Automation Workflows:**"]
        for w in workflows:
            status = "Active" if w.get("is_active", True) else "Inactive"
            output.append(
                f"- **{w['name']}** (ID: `{w['id']}`)\n"
                f"  Trigger: `{w['trigger_type']}` | Steps: {len(json.loads(w['steps']) if isinstance(w['steps'], str) else w['steps'])} | Status: {status}"
            )
        return "\n".join(output)
    except Exception as e:
        return f"Error listing workflows: {str(e)}"

async def update_workflow_tool(workflow_id: str, updates: Dict[str, Any]) -> str:
    """Updates an automation workflow (e.g., toggles active status, edits configuration, or modifies steps)."""
    try:
        await update_workflow(workflow_id, updates)
        return f"Successfully updated workflow {workflow_id}."
    except Exception as e:
        return f"Error updating workflow: {str(e)}"

async def delete_workflow_tool(workflow_id: str) -> str:
    """Deletes an automation workflow."""
    try:
        await delete_workflow(workflow_id)
        return f"Successfully deleted workflow {workflow_id}."
    except Exception as e:
        return f"Error deleting workflow: {str(e)}"

async def trigger_workflow_tool(workflow_id: str, input_data: Dict[str, Any]) -> str:
    """Manually triggers the execution of an automation workflow by dispatching to Inngest."""
    inngest_url = "https://event.inngest.com/e/" + settings.INNGEST_EVENT_KEY
    payload = {
        "name": "workflow/trigger",
        "data": {
            "workflow_id": workflow_id,
            "input_data": input_data
        }
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(inngest_url, json=payload)
            if resp.status_code >= 200 and resp.status_code < 300:
                return f"Successfully triggered workflow {workflow_id} execution."
            return f"Failed to trigger: Inngest returned status code {resp.status_code}"
    except Exception as e:
        return f"Error triggering workflow execution: {str(e)}"
