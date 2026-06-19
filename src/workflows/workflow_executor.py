"""
Workflow Executor for KlawHub.

Listens for `workflow/trigger` events dispatched by `trigger_workflow_tool`
and executes the workflow's steps sequentially.

Each step in a workflow's `steps` array has the form:
  {
    "type": "tool" | "message" | "skill",
    "tool":  "<tool_name>",          # for type=tool
    "skill": "<skill_slug>",         # for type=skill
    "channel_id": "<channel>",       # for type=message
    "text": "<message text>",        # for type=message
    "args": { ... }                  # tool/skill arguments
  }
"""
import json
import inngest
from src.core.inngest_client import inngest_client
from src.db.operations import get_workflow_by_id, log_usage
from src.core.tools.slack_tools import post_slack_message
from src.core.tools.skill_runner import run_skill_tool


@inngest_client.create_function(
    fn_id="execute-workflow",
    trigger=inngest.TriggerEvent(event="workflow/trigger"),
)
async def execute_workflow(ctx: inngest.Context, step: inngest.Step):
    """Runs a workflow's steps sequentially when triggered."""
    event_data = ctx.event.data
    workflow_id = event_data.get("workflow_id")
    input_data: dict = event_data.get("input_data", {})

    if not workflow_id:
        return {"status": "failed", "reason": "No workflow_id in event payload"}

    # 1. Fetch workflow definition
    workflow = await step.run(
        "fetch-workflow",
        lambda: get_workflow_by_id(workflow_id)
    )
    if not workflow:
        return {"status": "failed", "reason": f"Workflow {workflow_id} not found"}

    if not workflow.get("is_active", True):
        return {"status": "skipped", "reason": "Workflow is inactive"}

    workspace_id = str(workflow["workspace_id"])
    steps = workflow.get("steps", [])
    if isinstance(steps, str):
        steps = json.loads(steps)

    results = []

    # 2. Execute each step sequentially
    for idx, wf_step in enumerate(steps):
        step_type = wf_step.get("type", "tool")
        step_label = f"step-{idx+1}-{step_type}"

        if step_type == "message":
            # Post a message to Slack
            channel_id = wf_step.get("channel_id", "")
            text = wf_step.get("text", "")

            async def send_message(ws=workspace_id, ch=channel_id, txt=text):
                return await post_slack_message(workspace_id=ws, channel_id=ch, text=txt)

            result = await step.run(step_label, send_message)
            results.append({"step": idx + 1, "type": "message", "result": str(result)})

        elif step_type == "skill":
            # Execute a registered skill via Modal
            slug = wf_step.get("skill", "")
            skill_inputs = {**wf_step.get("args", {}), **input_data}

            async def run_skill_step(ws=workspace_id, s=slug, inp=skill_inputs):
                return await run_skill_tool(s, ws, inp)

            result = await step.run(step_label, run_skill_step)
            results.append({"step": idx + 1, "type": "skill", "slug": slug, "result": result})

        elif step_type == "tool":
            # Import and call a registered tool by name
            tool_name = wf_step.get("tool", "")
            tool_args = {**wf_step.get("args", {}), "workspace_id": workspace_id}

            async def run_tool_step(tn=tool_name, ta=tool_args):
                from src.core.agents.nodes.general import TOOLS
                if tn not in TOOLS:
                    return f"Unknown tool: {tn}"
                return await TOOLS[tn](**ta)

            result = await step.run(step_label, run_tool_step)
            results.append({"step": idx + 1, "type": "tool", "tool": tool_name, "result": str(result)})

        else:
            results.append({"step": idx + 1, "type": step_type, "result": "Unknown step type — skipped"})

    # 3. Log usage
    await step.run(
        "log-workflow-usage",
        lambda: log_usage(
            workspace_id=workspace_id,
            slack_user_id=None,
            agent_name="workflow_executor",
            skill_used=None,
            sandbox_function=None,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=0,
            status="success",
        )
    )

    return {"status": "success", "workflow_id": workflow_id, "steps_executed": len(results), "results": results}
