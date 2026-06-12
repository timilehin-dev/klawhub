import logging
import uuid
import asyncio
from datetime import datetime
import pytz
from sqlmodel import select, func
from croniter import croniter
import inngest

from src.db.pool import get_db_session
from src.db.models import Schedule, Workspace, Skill, AgentState
from src.workflows.inngest_app import inngest_client
from src.integrations.providers.slack.client import SlackClient

logger = logging.getLogger("klawhub.workflows.message_handler")

async def extract_text_from_slack_file(file_info: dict, slack_token: str) -> str:
    """Downloads a file from Slack and extracts its text contents, delegating PDFs/Docs to Modal Sandbox."""
    url = file_info.get("url_private")
    name = file_info.get("name", "file")
    mimetype = file_info.get("mimetype", "")
    
    if not url:
        return ""
        
    logger.info(f"Extracting text from Slack file '{name}' ({mimetype})")
    
    import httpx
    headers = {"Authorization": f"Bearer {slack_token}"}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, follow_redirects=True)
            if response.status_code != 200:
                logger.error(f"Failed to download Slack file '{name}': HTTP {response.status_code}")
                return f"[Failed to download file '{name}' from Slack]"
                
            file_bytes = response.content
    except Exception as e:
        logger.error(f"HTTP error downloading Slack file '{name}': {e}")
        return f"[Error downloading file '{name}': {str(e)}]"

    # Delegate heavy PDF, DOCX, XLSX document parsing to the Modal Sandbox's high-fidelity parse_document endpoint
    import os
    ext = os.path.splitext(name)[1].lower()
    if mimetype == "application/pdf" or ext in [".pdf", ".docx", ".xlsx", ".xls"]:
        try:
            import base64
            from src.config import settings
            
            file_b64 = base64.b64encode(file_bytes).decode('utf-8')
            
            payload = {
                "type": "parse_document",
                "file": file_b64,
                "filename": name
            }
            
            # Authenticate with Modal using expected webhook secret header
            sandbox_headers = {
                "X-Webhook-Secret": settings.modal_webhook_secret,
                "Content-Type": "application/json"
            }
            
            logger.info(f"Delegating high-fidelity parsing of '{name}' to Modal sandbox...")
            async with httpx.AsyncClient(timeout=90.0) as client:
                resp = await client.post(
                    settings.modal_function_url,
                    json=payload,
                    headers=sandbox_headers
                )
                
            if resp.status_code == 200:
                res_json = resp.json()
                if res_json.get("success"):
                    logger.info(f"Successfully parsed document '{name}' remotely via sandbox.")
                    return res_json.get("text", "")
                else:
                    err_msg = res_json.get("error", "Unknown sandbox error")
                    logger.error(f"Sandbox failed to parse document '{name}': {err_msg}")
                    return f"[Error parsing document '{name}' inside sandbox: {err_msg}]"
            else:
                logger.error(f"Sandbox HTTP error {resp.status_code} parsing document '{name}': {resp.text}")
                return f"[Error parsing document '{name}': Sandbox returned HTTP {resp.status_code}]"
        except Exception as e:
            logger.error(f"Exception delegating document parsing for '{name}': {e}", exc_info=True)
            return f"[Error delegating document parsing for '{name}': {str(e)}]"
            
    # Standard text/JSON/CSV decoding
    try:
        return file_bytes.decode("utf-8", errors="ignore")
    except Exception as e:
        logger.error(f"Failed to decode text file '{name}': {e}")
        return f"[Error decoding text file '{name}': {str(e)}]"


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

    # Fetch thread transcript and files if this message is in a thread
    has_thread = slack_event.get("thread_ts") is not None
    compiled_transcript = ""
    thread_files = []
    structured_history = []

    if has_thread:
        async def fetch_thread_data() -> dict:
            try:
                replies = await slack_client.get_thread_replies(channel_id, slack_event.get("thread_ts"))
                transcript_lines = []
                files = []
                history = []
                for msg in replies:
                    # Form transcript entry
                    if msg.get("bot_id") or msg.get("user") == workspace.slack_bot_user_id:
                        user_label = workspace.agent_name or "Klawhub"
                    else:
                        user = msg.get("user", "unknown")
                        user_label = f"<@{user}>"
                    text = msg.get("text", "")
                    transcript_lines.append(f"{user_label}: {text}")
                    
                    # Accumulate structured thread history
                    # Skip the current message (the one currently being processed) to avoid duplicating it as the user_query
                    if msg.get("ts") != message_ts:
                        is_bot = msg.get("bot_id") or msg.get("user") == workspace.slack_bot_user_id
                        role = "assistant" if is_bot else "user"
                        hist_text = msg.get("text", "")
                        if not is_bot and workspace.slack_bot_user_id:
                            bot_mention_tag = f"<@{workspace.slack_bot_user_id}>"
                            hist_text = hist_text.replace(bot_mention_tag, "").strip()
                        history.append({"role": role, "content": hist_text})
                    
                    # Accumulate any files uploaded inside the thread replies
                    msg_files = msg.get("files", [])
                    if msg_files:
                        files.extend(msg_files)
                return {
                    "transcript": "\n".join(transcript_lines),
                    "files": files,
                    "history": history
                }
            except Exception as e:
                logger.error(f"Failed to fetch thread replies: {e}")
                return {"transcript": "", "files": [], "history": []}
                
        thread_data = await ctx.step.run("fetch-thread-data", fetch_thread_data)
        compiled_transcript = thread_data.get("transcript", "")
        thread_files = thread_data.get("files", [])
        structured_history = thread_data.get("history", [])

    # Process any attached files (PDF, CSV, TXT, etc.)
    attached_files_content = []
    slack_files = list(slack_event.get("files", []))
    
    # Merge thread files to avoid missing files uploaded earlier in the thread context
    for f in thread_files:
        if f.get("id") not in [sf.get("id") for sf in slack_files]:
            slack_files.append(f)

    if slack_files:
        async def process_slack_files() -> list:
            # Force load credentials first to populate slack_client.access_token
            await slack_client.get_sdk_client()
            token = slack_client.access_token
            
            results = []
            for file_info in slack_files:
                name = file_info.get("name", "file")
                content = await extract_text_from_slack_file(file_info, token)
                if content:
                    results.append(f"Content of attached file '{name}':\n\n{content}")
            return results

        attached_files_content = await ctx.step.run("process-attached-files", process_slack_files)

    # Detect if user asks to summarize the conversation thread itself
    # If they are mentioning a "file", "document", "pdf", etc., or have uploaded files,
    # it is a file-summary/analysis request, NOT a Slack thread transcript summary request!
    has_attached_files = len(slack_files) > 0 or len(attached_files_content) > 0
    mentions_file = any(kw in user_query.lower() for kw in ["file", "document", "pdf", "attachment", "doc", "script", "pitch", "slide"])
    
    is_summary_request = (
        any(kw in user_query.lower() for kw in ["summarize", "action items", "transcript", "summary"]) 
        and not (has_attached_files or mentions_file)
    )

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
            "recursion_limit": 150,
            "configurable": {
                "workspace_id": str(workspace.id),
                "thread_id": thread_ts
            }
        }
        state = {
            "workspace_id": str(workspace.id),
            "thread_id": thread_ts,
            "user_query": user_query,
            "context_data": attached_files_content,
            "history": structured_history,
            "slack_user_id": slack_event.get("user"),
            "slack_channel_id": channel_id,
            "slack_message_ts": message_ts,
            "slack_thread_ts": thread_ts,
            "continuation_type": event_data.get("continuationType"),
            "approved_action_id": event_data.get("approvedActionId"),
            "original_request": event_data.get("originalRequest")
        }
        
        try:
            final_state = await coworker_app.ainvoke(state, config)
            
            # Extract worker output and check for errors
            worker_output = final_state.get("worker_output", "")
            errors = final_state.get("errors", [])
            generated_files = final_state.get("generated_files", [])
        except Exception as e:
            logger.error(f"Coworker graph execution failed: {e}", exc_info=True)
            worker_output = ""
            errors = [f"Coworker execution failed or timed out: {str(e)}"]
            generated_files = []
        
        return {
            "worker_output": worker_output,
            "errors": errors,
            "generated_files": generated_files
        }

    agent_result = await ctx.step.run("process-message", run_agent)
    worker_output = agent_result.get("worker_output", "")
    errors = agent_result.get("errors", [])
    generated_files = agent_result.get("generated_files", [])

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
                
            # Automatically upload any generated document/data assets returned by the sandbox
            if generated_files and not errors:
                import base64
                for file_info in generated_files:
                    name = file_info.get("name", "document")
                    data_b64 = file_info.get("data_b64", "")
                    if data_b64:
                        try:
                            logger.info(f"Decoding and uploading generated file '{name}' to Slack channel/thread...")
                            file_bytes = base64.b64decode(data_b64)
                            await slack_client.upload_file(
                                channel_id=channel_id,
                                content=file_bytes,
                                filename=name,
                                title=name,
                                thread_ts=thread_ts
                            )
                        except Exception as upload_err:
                            logger.error(f"Failed to upload generated file '{name}' to Slack: {upload_err}")

        except Exception as e:
            logger.error(f"Failed to post message or upload generated files to Slack channel {channel_id}: {e}")
            
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
        
        if "monitor silence" in action.lower():
            try:
                logger.info(f"Running Silence Detector scanner for channel {channel_id}...")
                
                # Fetch recent conversation history from channel
                messages = await slack_client.get_history(channel_id, limit=20)
                
                # Find threads active in the last 7 days
                import time
                now_ts = time.time()
                one_day_sec = 24 * 60 * 60
                seven_days_sec = 7 * one_day_sec
                
                thread_parents = []
                for msg in messages:
                    ts_val = float(msg.get("ts", 0))
                    if now_ts - ts_val > seven_days_sec:
                        continue
                    if msg.get("reply_count", 0) > 0:
                        thread_parents.append(msg)
                        
                logger.info(f"Silence Detector: found {len(thread_parents)} active threads to scan.")
                
                # Fetch workspace details to get bot user id
                async with get_db_session() as session:
                    workspace = await session.get(Workspace, workspace_id)
                bot_user_id = workspace.slack_bot_user_id if workspace else None
                
                for parent in thread_parents:
                    parent_ts = parent.get("ts")
                    replies = await slack_client.get_thread_replies(channel_id, parent_ts)
                    if not replies:
                        continue
                        
                    last_msg = replies[-1]
                    last_ts = float(last_msg.get("ts", 0))
                    
                    if now_ts - last_ts > one_day_sec:
                        # Unresolved questions or tasks check
                        thread_text = "\n".join([r.get("text", "") for r in replies])
                        has_question = "?" in parent.get("text", "") or any(kw in thread_text.lower() for kw in ["unresolved", "stuck", "pending", "outstanding", "blocker", "help", "need"])
                        
                        from src.db.models import Task
                        async with get_db_session() as session:
                            stmt = select(func.count(Task.id)).where(
                                Task.workspace_id == workspace_id,
                                Task.slack_thread_ts == parent_ts,
                                Task.status == "pending"
                            )
                            tasks_res = await session.execute(stmt)
                            pending_tasks_count = tasks_res.scalar() or 0
                            
                        if pending_tasks_count > 0 or has_question:
                            # Verify that Klawhub hasn't already bumped this thread in the last 24h
                            last_bump_by_bot = False
                            for reply in reversed(replies):
                                if reply.get("user") == bot_user_id or reply.get("bot_id"):
                                    if "gone quiet" in reply.get("text", ""):
                                        last_bump_by_bot = True
                                        break
                                        
                            if not last_bump_by_bot:
                                bump_msg = (
                                    f"👋 *Hey team! Just checking in — this thread seems to have gone quiet.* \n"
                                    f"• Was this resolved, or is anyone still stuck? \n"
                                )
                                if pending_tasks_count > 0:
                                    bump_msg += f"• There are *{pending_tasks_count} pending tasks* still logged for this thread."
                                    
                                await slack_client.post_message(
                                    channel_id=channel_id,
                                    text=bump_msg,
                                    thread_ts=parent_ts
                                )
                                logger.info(f"Gently bumped thread {parent_ts} in channel {channel_id} due to silence.")
                                
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
                        db_schedule.fail_count = 0
                        db_schedule.updated_at = datetime.utcnow()
                        await session.commit()
            except Exception as e:
                logger.error(f"Error in Silence Detector cron task: {e}", exc_info=True)
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
                        db_schedule.updated_at = datetime.utcnow()
                        await session.commit()
            return

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
                "recursion_limit": 150,
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
            try:
                final_state = await coworker_app.ainvoke(state, config)
                
                worker_output = final_state.get("worker_output", "")
                errors = final_state.get("errors", [])
                generated_files = final_state.get("generated_files", [])
            except Exception as e:
                logger.error(f"Coworker cron graph execution failed: {e}", exc_info=True)
                worker_output = ""
                errors = [f"Coworker execution failed or timed out: {str(e)}"]
                generated_files = []
            
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
                
                # Automatically upload any generated document/data assets returned by the sandbox
                if generated_files and not errors:
                    import base64
                    for file_info in generated_files:
                        name = file_info.get("name", "document")
                        data_b64 = file_info.get("data_b64", "")
                        if data_b64:
                            try:
                                logger.info(f"Decoding and uploading generated file '{name}' to Slack channel/thread...")
                                file_bytes = base64.b64decode(data_b64)
                                await slack_client.upload_file(
                                    channel_id=channel_id,
                                    content=file_bytes,
                                    filename=name,
                                    title=name,
                                    thread_ts=thread_ts
                                )
                            except Exception as upload_err:
                                logger.error(f"Failed to upload generated file '{name}' to Slack: {upload_err}")
                
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
