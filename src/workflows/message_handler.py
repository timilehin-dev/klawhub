import logging
import uuid
import asyncio
from datetime import datetime
import pytz
from sqlmodel import select
from croniter import croniter
import inngest

from src.db.pool import get_db_session
from src.db.models import Schedule, Workspace, Skill, AgentState
from src.workflows.inngest_app import inngest_client
from src.integrations.providers.slack.client import SlackClient

logger = logging.getLogger("klawhub.workflows.message_handler")

@inngest_client.create_function(
    fn_id="slack-message-handler",
    trigger=inngest.TriggerEvent(event="slack/event.received"),
    concurrency=[
        inngest.Concurrency(
            limit=3,
            key="event.data.event.channel"
        )
    ],
    retries=1
)
async def slack_message_handler(ctx: inngest.Context) -> None:
    """Slack message handler workflow.
    
    Triggered by 'slack/event.received'. Checks if the event is a message or mention,
    adds immediate visual reaction feedback, runs the cognitive graph coworker_app,
    posts the audited and redacted coworker output, and cleans up the reaction.
    """
    event_data = ctx.event.data
    slack_event = event_data.get("event", {})
    event_id = event_data.get("eventId")
    team_id = event_data.get("teamId")
    
    event_type = slack_event.get("type")
    # Only process message or app_mention events here
    if event_type not in ["message", "app_mention"]:
        logger.info(f"Ignoring non-message/mention event of type {event_type}")
        return
        
    channel_id = slack_event.get("channel")
    message_ts = slack_event.get("ts")
    thread_ts = slack_event.get("thread_ts") or message_ts
    user_query = slack_event.get("text", "")
    
    if not channel_id or not message_ts:
        logger.warning("Event is missing channel or ts. Skipping.")
        return

    # Load workspace to fetch custom profile and bot user ID boundary
    async with get_db_session() as session:
        statement = select(Workspace).where(Workspace.slack_team_id == team_id)
        result = await session.execute(statement)
        workspace = result.scalar_one_or_none()
        
    if not workspace:
        logger.warning(f"No workspace found for Slack team ID: {team_id}. Aborting handler.")
        return
        
    if not workspace.is_active:
        logger.warning(f"Workspace {workspace.id} is inactive. Aborting handler.")
        return
        
    # Prevent bot from responding to itself or other bots
    if slack_event.get("bot_id") or slack_event.get("user") == workspace.slack_bot_user_id:
        logger.info("Ignoring bot message to prevent loop loops.")
        return

    # Redundantly clean user_query of any bot mention tags to keep prompt clean
    if workspace.slack_bot_user_id:
        bot_mention_tag = f"<@{workspace.slack_bot_user_id}>"
        user_query = user_query.replace(bot_mention_tag, "").strip()

    slack_client = SlackClient(workspace.id)

    # Detect if user explicitly mentions the bot or if it's a DM
    is_explicit = (
        event_type == "app_mention" or
        (workspace.slack_bot_user_id and f"<@{workspace.slack_bot_user_id}>" in slack_event.get("text", "")) or
        channel_id.startswith("D")
    )

    if not is_explicit:
        # Step A: Evaluate question heuristic
        is_question = (
            "?" in user_query or 
            any(phrase in user_query.lower() for phrase in [
                "how do we", "how can i", "help with", "anyone know", "how to", 
                "need to find", "is there a", "can someone", "where is", "stuck on",
                "trying to", "problem with", "error running", "fail to"
            ])
        )
        if not is_question:
            logger.info("Ignoring untagged message: not a question/need.")
            return

        # Step B: Match against active workspace skills
        async def match_skills() -> list:
            async with get_db_session() as session:
                stmt = select(Skill).where(Skill.workspace_id == workspace.id, Skill.is_active == True)
                res = await session.execute(stmt)
                skills = res.scalars().all()
            
            matched = []
            tokens = set(user_query.lower().split())
            for s in skills:
                name_lower = s.name.lower()
                desc_lower = (s.description or "").lower()
                # Check if name is in the text, or if tokens match
                if name_lower in user_query.lower() or any(t in desc_lower or t in name_lower for t in tokens if len(t) > 3):
                    matched.append({
                        "id": str(s.id),
                        "name": s.name,
                        "description": s.description
                    })
            return matched

        matched_skills = await ctx.step.run("match-proactive-skills", match_skills)
        if not matched_skills:
            logger.info("Ignoring untagged question: no matching skills found.")
            return

        best_skill = matched_skills[0]

        # Step C: Anti-spam DB check to ensure Klawhub has never proactively responded to this thread
        async def check_proactive_history() -> bool:
            async with get_db_session() as session:
                stmt = select(AgentState).where(
                    AgentState.workspace_id == workspace.id,
                    AgentState.agent_name == f"proactive_suggestion:{thread_ts}"
                )
                res = await session.execute(stmt)
                return res.scalar_one_or_none() is not None

        has_responded = await ctx.step.run("check-proactive-history", check_proactive_history)
        if has_responded:
            logger.info(f"Skipping proactive suggestion: already responded in thread {thread_ts}")
            return

        # Step D: Chat frequency check to avoid interrupting huddles
        async def check_chat_frequency() -> bool:
            try:
                history = await slack_client.get_history(channel_id, limit=5)
                if len(history) >= 3:
                    timestamps = []
                    for msg in history:
                        ts_str = msg.get("ts")
                        if ts_str:
                            timestamps.append(float(ts_str))
                    if len(timestamps) >= 3:
                        timestamps.sort()
                        time_span = timestamps[-1] - timestamps[0]
                        # If 3 or more messages within 30 seconds
                        if time_span < 30.0:
                            return True
            except Exception as e:
                logger.warning(f"Error checking chat frequency: {e}")
            return False

        is_rapid = await ctx.step.run("check-chat-frequency", check_chat_frequency)
        if is_rapid:
            logger.info("Skipping proactive suggestion: channel is rapidly chatting.")
            return

        # Step E: Record proactive suggestion and post Block Kit card
        async def post_proactive_suggestion() -> None:
            # Record first to prevent race conditions
            async with get_db_session() as session:
                record = AgentState(
                    workspace_id=workspace.id,
                    agent_name=f"proactive_suggestion:{thread_ts}",
                    state={"responded": True, "ts": datetime.utcnow().isoformat(), "skill": best_skill["name"]}
                )
                session.add(record)
                await session.commit()

            blocks = [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"👋 *Hey team! I noticed you are discussing a need that my whitelisted skill `{best_skill['name']}` can resolve.*"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"> *Description*: {best_skill['description'] or 'Custom enterprise automation.'}"
                    }
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": f"🚀 Run {best_skill['name']}"},
                            "style": "primary",
                            "action_id": f"run_skill_{best_skill['name']}",
                            "value": f"{best_skill['name']}:{thread_ts}"
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "Dismiss"},
                            "style": "danger",
                            "action_id": "dismiss_suggestion"
                        }
                    ]
                }
            ]
            await slack_client.post_message(
                channel_id=channel_id,
                text=f"👋 I can help with my `{best_skill['name']}` skill!",
                blocks=blocks,
                thread_ts=thread_ts
            )

        await ctx.step.run("post-proactive-suggestion", post_proactive_suggestion)
        return

    # Detect if user asks to summarize a thread
    is_summary_request = any(kw in user_query.lower() for kw in ["summarize", "action items", "transcript", "summary"])
    has_thread = slack_event.get("thread_ts") is not None
    compiled_transcript = ""

    if has_thread:
        async def fetch_thread() -> str:
            try:
                replies = await slack_client.get_thread_replies(channel_id, slack_event.get("thread_ts"))
                transcript_lines = []
                for msg in replies:
                    if msg.get("bot_id") or msg.get("user") == workspace.slack_bot_user_id:
                        user_label = workspace.agent_name or "Klawhub"
                    else:
                        user = msg.get("user", "unknown")
                        user_label = f"<@{user}>"
                    text = msg.get("text", "")
                    transcript_lines.append(f"{user_label}: {text}")
                return "\n".join(transcript_lines)
            except Exception as e:
                logger.error(f"Failed to fetch thread replies: {e}")
                return ""
                
        compiled_transcript = await ctx.step.run("fetch-thread-replies", fetch_thread)
        
        if compiled_transcript:
            if is_summary_request:
                user_query = (
                    f"Here is the conversational thread transcript from Slack:\n"
                    f"```\n{compiled_transcript}\n```\n"
                    f"Please summarize this thread, extract the key decisions, and list the concrete action items."
                )
            else:
                user_query = (
                    f"Here is the conversational thread transcript from Slack for context:\n"
                    f"```\n{compiled_transcript}\n```\n"
                    f"User's latest message: {user_query}"
                )

    # Step 1: Add "eyes" reaction for instant visual acknowledgement
    async def add_eyes() -> None:
        try:
            await slack_client.add_reaction(channel_id, message_ts, "eyes")
        except Exception as e:
            logger.warning(f"Failed to add 'eyes' reaction: {e}")
            
    await ctx.step.run("add-reaction", add_eyes)

    # Step 2: Invoke the cognitive agent coworker graph
    async def run_agent() -> dict:
        from src.core.agents.graph import coworker_app
        config = {
            "configurable": {
                "workspace_id": str(workspace.id),
                "thread_id": thread_ts
            }
        }
        state = {
            "workspace_id": str(workspace.id),
            "thread_id": thread_ts,
            "user_query": user_query
        }
        
        final_state = await coworker_app.ainvoke(state, config)
        
        # Extract worker output and check for errors
        worker_output = final_state.get("worker_output", "")
        errors = final_state.get("errors", [])
        
        return {
            "worker_output": worker_output,
            "errors": errors
        }

    agent_result = await ctx.step.run("process-message", run_agent)
    worker_output = agent_result.get("worker_output", "")
    errors = agent_result.get("errors", [])

    # Step 3: Format and publish the audited/scrubbed result back to Slack, and remove the eyes reaction
    async def post_and_cleanup() -> None:
        output_text = worker_output
        if not output_text:
            if errors:
                output_text = f":warning: An error occurred during execution:\n" + "\n".join(f"- {e}" for e in errors)
            else:
                output_text = "_No response generated by coworker._"
                
        try:
            if is_summary_request and has_thread and not errors:
                blocks = [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": "📖 Thread Synthesis & Action Items",
                            "emoji": True
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"{output_text}"
                        }
                    },
                    {"type": "divider"},
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "👤 Assign to me"},
                                "action_id": "task_assign_me"
                            },
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "💾 Log Workspace Task"},
                                "action_id": "task_convert_dashboard"
                            },
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "✅ Mark Completed"},
                                "action_id": "task_done"
                            }
                        ]
                    }
                ]
                await slack_client.post_message(
                    channel_id=channel_id,
                    text="📖 Thread Synthesis & Action Items complete",
                    blocks=blocks,
                    thread_ts=thread_ts
                )
            else:
                await slack_client.post_message(
                    channel_id=channel_id,
                    text=output_text,
                    thread_ts=thread_ts
                )
        except Exception as e:
            logger.error(f"Failed to post message to Slack channel {channel_id}: {e}")
            
        try:
            await slack_client.remove_reaction(channel_id, message_ts, "eyes")
        except Exception as e:
            logger.warning(f"Failed to remove 'eyes' reaction: {e}")

    await ctx.step.run("post-and-cleanup", post_and_cleanup)


@inngest_client.create_function(
    fn_id="cron-schedule-runner",
    trigger=inngest.TriggerEvent(event="cron/check.schedules"),
    retries=1
)
async def cron_schedule_runner(ctx: inngest.Context) -> None:
    """Scheduled cron execution runner workflow.
    
    Triggered by 'cron/check.schedules'. Queries active schedules, determines which ones match
    the current minute using timezone-aware croniter checks, and triggers coworker_app cognitive runs.
    Automated safety check deactivates broken schedules after 3 consecutive failures.
    """
    logger.info("Executing scheduled cron check.")
    
    # Step 1: Query database for all active schedules
    async def fetch_active_schedules() -> list:
        async with get_db_session() as session:
            statement = select(Schedule).join(Workspace).where(
                Schedule.is_active == True,
                Workspace.is_active == True
            )
            result = await session.execute(statement)
            schedules = result.scalars().all()
            
            # Serialize for step storage
            return [
                {
                    "id": str(s.id),
                    "workspace_id": str(s.workspace_id),
                    "slack_user_id": s.slack_user_id,
                    "slack_team_id": s.slack_team_id,
                    "name": s.name,
                    "cron_expr": s.cron_expr,
                    "timezone": s.timezone,
                    "action": s.action,
                    "channel_id": s.channel_id,
                    "fail_count": s.fail_count
                }
                for s in schedules
            ]

    active_schedules = await ctx.step.run("fetch-active-schedules", fetch_active_schedules)
    if not active_schedules:
        logger.info("No active schedules found.")
        return

    # Helper function to match cron schedule to local timezone-aware time
    def is_schedule_due(sched: dict) -> bool:
        cron_expr = sched.get("cron_expr")
        tz_name = sched.get("timezone", "UTC")
        
        try:
            tz = pytz.timezone(tz_name)
        except Exception:
            tz = pytz.UTC
            
        now = datetime.now(tz)
        try:
            return croniter.match(cron_expr, now)
        except Exception as e:
            logger.error(f"Failed to check cron '{cron_expr}' match for schedule {sched.get('id')}: {e}")
            return False

    due_schedules = [s for s in active_schedules if is_schedule_due(s)]
    if not due_schedules:
        logger.info("No active schedules are due at this minute.")
        return
        
    logger.info(f"Found {len(due_schedules)} due schedules to execute.")

    # Step 2: Process each due schedule concurrently
    async def process_single_schedule(sched: dict) -> None:
        sched_id = uuid.UUID(sched["id"])
        workspace_id = uuid.UUID(sched["workspace_id"])
        channel_id = sched.get("channel_id")
        action = sched.get("action")
        name = sched.get("name", "Scheduled Task")
        
        if not channel_id:
            logger.warning(f"Schedule {sched_id} has no channel_id configured. Skipping.")
            return

        slack_client = SlackClient(workspace_id)
        
        # Post initial execution/huddle notification message
        is_huddle = any(kw in name.lower() or kw in action.lower() for kw in ["huddle", "standup", "retro"])
        
        try:
            if is_huddle:
                msg_text = f":wave: *{name}* has started!\n_Please check in and share your updates for the team._"
                blocks = [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f":wave: *{name}* has started!\n_Please check in and share your updates for the team._"
                        }
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "Join Huddle"},
                                "style": "primary",
                                "action_id": "huddle_join",
                                "url": "https://slack.com/features/huddles"
                            },
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "Post Update"},
                                "action_id": "huddle_post_update"
                            },
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "Excuse Me"},
                                "style": "danger",
                                "action_id": "huddle_excuse"
                            }
                        ]
                    }
                ]
            else:
                msg_text = f":clock1: *{name}*\n_Executing scheduled task..._"
                blocks = None

            post_res = await slack_client.post_message(
                channel_id=channel_id,
                text=msg_text,
                blocks=blocks
            )
            thread_ts = post_res.get("ts")
        except Exception as e:
            logger.error(f"Failed to post schedule initialization message: {e}")
            # If posting failed, we still want to run the coworker app but thread_ts is None
            thread_ts = None

        try:
            # Execute coworker app StateGraph
            config = {
                "configurable": {
                    "workspace_id": str(workspace_id),
                    "thread_id": thread_ts or str(uuid.uuid4())
                }
            }
            state = {
                "workspace_id": str(workspace_id),
                "thread_id": thread_ts or str(uuid.uuid4()),
                "user_query": action
            }
            
            from src.core.agents.graph import coworker_app
            final_state = await coworker_app.ainvoke(state, config)
            
            worker_output = final_state.get("worker_output", "")
            errors = final_state.get("errors", [])
            
            if errors:
                raise RuntimeError("\n".join(errors))
                
            if not worker_output:
                worker_output = "_No response generated by coworker._"
                
            # Post output back to thread
            if thread_ts:
                await slack_client.post_message(
                    channel_id=channel_id,
                    text=worker_output,
                    thread_ts=thread_ts
                )
                
            # Update database status to success
            async with get_db_session() as session:
                statement = select(Schedule).where(
                    Schedule.id == sched_id,
                    Schedule.workspace_id == workspace_id
                )
                db_schedule = (await session.execute(statement)).scalar_one_or_none()
                if db_schedule:
                    db_schedule.last_triggered_at = datetime.utcnow()
                    db_schedule.last_run_status = "success"
                    db_schedule.consecutive_successes = (db_schedule.consecutive_successes or 0) + 1
                    db_schedule.fail_count = 0  # Reset fail count
                    db_schedule.updated_at = datetime.utcnow()
                    await session.commit()
                    
            logger.info(f"Successfully executed schedule {sched_id} ({name})")
            
        except Exception as err:
            logger.error(f"Error executing schedule {sched_id} ({name}): {err}")
            
            # Post error description to thread
            if thread_ts:
                try:
                    err_msg = f":warning: Failed to execute scheduled action '{name}': {str(err)}"
                    await slack_client.post_message(
                        channel_id=channel_id,
                        text=err_msg,
                        thread_ts=thread_ts
                    )
                except Exception as post_err:
                    logger.error(f"Failed to post error message to thread: {post_err}")
                    
            # Increment failure counter and handle auto-deactivation
            async with get_db_session() as session:
                statement = select(Schedule).where(
                    Schedule.id == sched_id,
                    Schedule.workspace_id == workspace_id
                )
                db_schedule = (await session.execute(statement)).scalar_one_or_none()
                if db_schedule:
                    db_schedule.last_triggered_at = datetime.utcnow()
                    db_schedule.last_run_status = "failure"
                    db_schedule.consecutive_successes = 0
                    db_schedule.fail_count = (db_schedule.fail_count or 0) + 1
                    
                    if db_schedule.fail_count >= 3:
                        db_schedule.is_active = False
                        logger.warning(f"Auto-deactivating schedule {sched_id} ({name}) after 3 consecutive failures.")
                        
                    db_schedule.updated_at = datetime.utcnow()
                    await session.commit()

    # Run all due schedules concurrently using step.run
    async def run_due_schedules() -> None:
        tasks = [process_single_schedule(s) for s in due_schedules]
        await asyncio.gather(*tasks, return_exceptions=True)

    await ctx.step.run("execute-due-schedules", run_due_schedules)
