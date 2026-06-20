"""
Inngest message handler for KlawHub.

Processes `slack/event` and `slack/command` events dispatched by the Go gateway.
Uses the shared inngest_client from `src.core.inngest_client`.
"""
import time
import json
from src.config import settings
from src.core.inngest_client import inngest_client
from src.db.operations import (
    get_workspace_by_slack_team_id,
    save_agent_state,
    log_usage,
)
from src.integrations.slack.context_loader import load_thread_context
from src.core.agents.graph import agent_graph
from src.core.tools.slack_tools import post_slack_message, add_slack_reaction
import inngest


@inngest_client.create_function(
    fn_id="handle-slack-message-event",
    trigger=inngest.TriggerEvent(event="slack/event"),
    retries=2,
    concurrency=[inngest.Concurrency(limit=50)],
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

    # Ignore non-user message subtypes (message_changed, message_deleted, etc.)
    msg_subtype = inner_event.get("subtype")
    if msg_subtype and msg_subtype not in ("", None, "thread_broadcast"):
        return {"status": "ignored", "reason": f"Non-user message subtype: {msg_subtype}"}

    channel_type = inner_event.get("channel_type", "")
    event_text = inner_event.get("text", "")

    # bot_user_id is stored in the settings JSONB column
    settings = workspace.get("settings", {})
    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except (json.JSONDecodeError, TypeError):
            settings = {}
    bot_user_id = settings.get("bot_user_id", "")

    # Only respond if:
    # 1. It's a DM (IM channel), OR
    # 2. The bot is @-mentioned in the message
    if channel_type != "im" and bot_user_id and f"<@{bot_user_id}>" not in event_text and f"<@ {bot_user_id}>" not in event_text:
        return {"status": "ignored", "reason": "Not a DM or mention"}

    channel_id = inner_event.get("channel")
    ts = inner_event.get("ts")
    thread_ts = inner_event.get("thread_ts") or ts

    # 2. Add 👀 reaction to acknowledge receipt
    await step.run(
        "add-reaction-processing",
        lambda: add_slack_reaction(workspace_id, channel_id, ts, "eyes")
    )

    # 3. Load the thread context (sliding-window trimmed)
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

        # Compute HMAC signature for agent state integrity
        import hashlib, hmac as hmac_mod
        state_payload_str = json.dumps({k: str(v)[:500] for k, v in result.items() if k != "messages"}, sort_keys=True)
        computed_hmac = hmac_mod.new(
            settings.HMAC_SECRET.encode() if settings.HMAC_SECRET else b"default",
            state_payload_str.encode(),
            hashlib.sha256
        ).hexdigest()

        # Persist agent state for crash recovery
        await save_agent_state(
            workspace_id=workspace_id,
            thread_ts=thread_ts,
            channel_id=channel_id,
            agent_name="general",
            state_payload={k: v for k, v in result.items() if k != "messages"},
            hmac_sig=computed_hmac,
        )

        # Extract token usage from LLM response (if available in result)
        prompt_tokens = result.get("prompt_tokens", 0)
        completion_tokens = result.get("completion_tokens", 0)
        
        # Log usage telemetry
        await log_usage(
            workspace_id=workspace_id,
            slack_user_id=inner_event.get("user"),
            agent_name="general",
            skill_used=result.get("skill_used"),
            sandbox_function=None,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
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
        # 5. Replace 👀 with ✅ to indicate completion
        await step.run(
            "add-reaction-done",
            lambda: add_slack_reaction(workspace_id, channel_id, ts, "white_check_mark")
        )
        return {"status": "success", "logs": state_result.get("logs", [])}

    # 5. Replace 👀 with ❓ to indicate no response generated
    await step.run(
        "add-reaction-no-response",
        lambda: add_slack_reaction(workspace_id, channel_id, ts, "question")
    )
    return {"status": "no_response", "logs": state_result.get("logs", [])}


@inngest_client.create_function(
    fn_id="handle-slack-slash-command",
    trigger=inngest.TriggerEvent(event="slack/command"),
    retries=2,
    concurrency=[inngest.Concurrency(limit=50)],
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
