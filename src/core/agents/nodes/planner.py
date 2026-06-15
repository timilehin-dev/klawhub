import json
from src.core.llm.client import llm_client
from src.core.agents.graph_state import AgentState
from src.integrations.slack.formatter import SlackFormatter
from src.core.tools.slack_tools import post_slack_message, update_slack_message

PLANNER_PROMPT = """
You are the Planner Agent in KlawHub.
Your task is to decompose the following complex user request into 3 to 5 clear, sequential milestones.

Task Description: {task}

Respond ONLY with a JSON array of milestones. No other text.
Format:
[
  {{"id": "m1", "name": "Description of milestone 1", "status": "pending"}},
  {{"id": "m2", "name": "Description of milestone 2", "status": "pending"}}
]
"""

async def planner_node(state: AgentState) -> AgentState:
    """Orchestrates the multi-step milestone planner node."""
    workspace_id = state["workspace_id"]
    channel_id = state["channel_id"]
    thread_ts = state["thread_ts"]
    task = state["current_task"]
    
    milestones = state.get("milestones")
    card_ts = state.get("planner_card_ts")

    # Step 1: Initialize Milestones
    if not milestones:
        prompt = PLANNER_PROMPT.format(task=task)
        res = await llm_client.chat_completion([{"role": "user", "content": prompt}], temperature=0.0)
        content = res.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        
        # Parse JSON
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        try:
            milestones = json.loads(content)
            state["milestones"] = milestones
        except Exception:
            # Fallback milestone if LLM output fails to parse
            milestones = [
                {"id": "m1", "name": f"Analyze: {task[:50]}", "status": "pending"},
                {"id": "m2", "name": "Process and solve steps", "status": "pending"},
                {"id": "m3", "name": "Synthesize final response", "status": "pending"}
            ]
            state["milestones"] = milestones

        # Post the initial checklist card to Slack
        blocks = SlackFormatter.build_progress_card(
            title=f"Planner: Orchestrating Task",
            milestones=milestones,
            status_text="Decomposing task steps..."
        )
        
        try:
            card_ts = await post_slack_message(
                workspace_id=workspace_id,
                channel_id=channel_id,
                text="Planning execution...",
                thread_ts=thread_ts,
                blocks=blocks
            )
            state["planner_card_ts"] = card_ts
        except Exception as e:
            state["logs"].append(f"Failed to post Slack progress card: {e}")

    # Step 2: Handle intermediate results from running milestone
    running_milestone = None
    for m in milestones:
        if m["status"] == "running":
            running_milestone = m
            break
            
    if running_milestone:
        # General Agent just finished executing this running milestone
        running_milestone["status"] = "completed"
        state["logs"].append(f"Completed milestone: {running_milestone['name']}")
        
        # Append the General's output log as intermediate data
        state["messages"].append({
            "role": "user",
            "content": f"[Milestone Result for {running_milestone['id']}]: {state.get('output', '')}"
        })

    # Step 3: Find next milestone to execute
    next_milestone = None
    for m in milestones:
        if m["status"] == "pending":
            next_milestone = m
            break

    if next_milestone:
        # We have a next milestone, start executing it
        next_milestone["status"] = "running"
        state["logs"].append(f"Starting milestone: {next_milestone['name']}")
        
        # Update Slack progress card
        blocks = SlackFormatter.build_progress_card(
            title="Planner: Running Milestones",
            milestones=milestones,
            status_text=f"Running: {next_milestone['name']}..."
        )
        if card_ts:
            try:
                await update_slack_message(
                    workspace_id=workspace_id,
                    channel_id=channel_id,
                    ts=card_ts,
                    text="Execution in progress...",
                    blocks=blocks
                )
            except Exception as e:
                state["logs"].append(f"Slack card update failed: {e}")
                
        # Redirect state messages to focus General Agent on this milestone task
        state["messages"].append({
            "role": "user",
            "content": (
                f"Next Milestone Task to execute: {next_milestone['name']}. "
                "Please use appropriate tools to complete this specific sub-task."
            )
        })
        state["next_node"] = "general"
        return state

    # Step 4: All milestones completed!
    state["logs"].append("All milestones completed.")
    
    # Update progress card to all checkmarks
    blocks = SlackFormatter.build_progress_card(
        title="Planner: Task Completed",
        milestones=milestones,
        status_text="All milestones checked. Generating final summary..."
    )
    if card_ts:
        try:
            await update_slack_message(
                workspace_id=workspace_id,
                channel_id=channel_id,
                ts=card_ts,
                text="Task execution finished.",
                blocks=blocks
            )
        except Exception as e:
            state["logs"].append(f"Slack card update failed: {e}")

    # Prompt General to synthesize the entire conversation history into a unified response
    state["messages"].append({
        "role": "user",
        "content": (
            "All milestones have completed successfully. "
            "Please review all milestone results and write a final comprehensive overview report for the user."
        )
    })
    state["next_node"] = "general"
    return state
