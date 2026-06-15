"""
Inngest message handler for KlawHub.

Processes `slack/event` and `slack/command` events dispatched by the Go gateway.
Uses the shared inngest_client from `src.core.inngest_client`.
"""
import time
from src.core.inngest_client import inngest_client
from src.db.operations import (
    get_workspace_by_slack_team_id,
    save_agent_state,
    log_usage,
)
from src.integrations.slack.context_loader import load_thread_context
from src.core.agents.graph import agent_graph
from src.core.tools.slack_tools import post_slack_message
import inngest


@inngest_client.create_function(
    fn_id="handle-slack-message-event",
    trigger=inngest.Trigger(event="slack/event"),
    retries=2,
    concurrency=50,
)
async def handle_slack_message_event(ctx: inngest.Context, step: inngest.Step):
    event_payload = ctx.event.data
    slack_team_id = event_payload.get("team_id")

    # 1. Fetch workspace by Slack team ID
    workspace = await step.run(
        "fetch-workspace",
        lambda: get_workspace_by_slack_team_id(slack_team_id)
    )
    if not workspace:
        return {"status": "ignored", "reason": f"Workspace not configured for team {slack_team_id}"}

    workspace_id = workspace["id"]
    inner_event = event_payload.get("event", {})

    # Ignore bot messages to prevent loopbacks
    if inner_event.get("bot_id") or inner_event.get("app_id"):
        return {"status": "ignored", "reason": "Bot message ignored"}

    channel_id = inner_event.get("channel")
    ts = inner_event.get("ts")
    thread_ts = inner_event.get("thread_ts") or ts

    # 2. Load the thread context (sliding-window trimmed)
    messages = await step.run(
        "load-thread-context",
        lambda: load_thread_context(workspace_id, channel_id, thread_ts)
    )

    # 3. Invoke LangGraph Cognitive Agent Graph
    async def run_agents():
        t0 = time.monotonic()
        initial_state = {
            "workspace_id": workspace_id,
            "channel_id": channel_id,
            "thread_ts": thread_ts,
            "messages": messages,
            "next_node": "general",
            "current_task": None,
            "planner_card_ts": None,
            "milestones": None,
            "planner_depth": 0,
            "logs": [],
            "output": "",
            "final_response": "",
        }
        result = await agent_graph.ainvoke(initial_state)
        latency_ms = int((time.monotonic() - t0) * 1000)

        # Persist agent state for crash recovery
        await save_agent_state(
            workspace_id=workspace_id,
            thread_ts=thread_ts,
            channel_id=channel_id,
            agent_name="general",
            state_payload={k: v for k, v in result.items() if k != "messages"},
            hmac_sig="",
        )

        # Log usage telemetry
        await log_usage(
            workspace_id=workspace_id,
            slack_user_id=inner_event.get("user"),
            agent_name="general",
            skill_used=None,
            sandbox_function=None,
            prompt_tokens=0,  # TODO: track from llm_client
            completion_tokens=0,
            latency_ms=latency_ms,
            status="success" if result.get("final_response") else "no_response",
        )
        return result

    state_result = await step.run("run-cognitive-graph", run_agents)

    # 4. Post final response back to Slack thread
    final_response = state_result.get("final_response")
    if final_response:
        await step.run(
            "post-slack-response",
            lambda: post_slack_message(
                workspace_id=workspace_id,
                channel_id=channel_id,
                text=final_response,
                thread_ts=thread_ts,
            )
        )
        return {"status": "success", "logs": state_result.get("logs", [])}

    return {"status": "no_response", "logs": state_result.get("logs", [])}


@inngest_client.create_function(
    fn_id="handle-slack-slash-command",
    trigger=inngest.Trigger(event="slack/command"),
    retries=2,
    concurrency=50,
)
async def handle_slack_slash_command(ctx: inngest.Context, step: inngest.Step):
    cmd_payload = ctx.event.data
    slack_team_id = cmd_payload.get("team_id")

    workspace = await step.run(
        "fetch-workspace-cmd",
        lambda: get_workspace_by_slack_team_id(slack_team_id)
    )
    if not workspace:
        return {"status": "ignored"}

    workspace_id = workspace["id"]
    channel_id = cmd_payload.get("channel_id")
    command = cmd_payload.get("command")
    text = cmd_payload.get("text", "").strip()
    user_id = cmd_payload.get("user_id")

    async def run_command_agents():
        t0 = time.monotonic()
        initial_state = {
            "workspace_id": workspace_id,
            "channel_id": channel_id,
            "thread_ts": "",
            "messages": [
                {"role": "user", "content": f"Slash command: {command} {text}"}
            ],
            "next_node": "general",
            "current_task": None,
            "planner_card_ts": None,
            "milestones": None,
            "planner_depth": 0,
            "logs": [],
            "output": "",
            "final_response": "",
        }
        result = await agent_graph.ainvoke(initial_state)
        latency_ms = int((time.monotonic() - t0) * 1000)
        await log_usage(
            workspace_id=workspace_id,
            slack_user_id=user_id,
            agent_name="general",
            skill_used=None,
            sandbox_function=None,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=latency_ms,
            status="success" if result.get("final_response") else "no_response",
        )
        return result

    state_result = await step.run("run-command-graph", run_command_agents)
    final_response = state_result.get("final_response")

    if final_response:
        await step.run(
            "post-command-slack-response",
            lambda: post_slack_message(
                workspace_id=workspace_id,
                channel_id=channel_id,
                text=final_response,
            )
        )
        return {"status": "success"}

    return {"status": "no_response"}
