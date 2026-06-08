import logging
import json
import uuid
from datetime import datetime
from typing import Dict, Any, List
from src.core.llm.client import LLMClient

logger = logging.getLogger("klawhub.core.agents.team.worker")

# Keywords that indicate the query requires code execution in a sandbox
CODE_EXECUTION_KEYWORDS = [
    "calculate", "compute", "generate csv", "generate pdf", "scrape", "crawl",
    "analyze data", "plot", "chart", "graph", "spreadsheet", "parse", "transform",
    "download", "fetch data", "api call", "http request", "run script", "execute",
    "build", "compile", "deploy", "database", "sql", "query data", "export",
    "convert file", "process file", "extract text", "ocr", "image processing"
]


def _needs_sandbox_execution(user_query: str, milestone_desc: str) -> bool:
    """Determines if the user query or milestone requires sandbox code execution.

    Simple conversational queries (greetings, introductions, questions, summaries)
    should be answered directly by the LLM without sandbox execution.
    """
    combined = (user_query + " " + milestone_desc).lower()
    return any(kw in combined for kw in CODE_EXECUTION_KEYWORDS)


async def worker_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Worker Node: Handles task execution.

    For conversational queries: returns LLM text response directly.
    For code-execution queries: generates, validates (via AST), and executes in Modal sandbox.
    """
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional AI worker.")
    context_data = state.get("context_data", [])
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    # Slack approval continuations must bypass fresh LLM planning and resume the approved action directly.
    if state.get("continuation_type") == "modal_sandbox_approval" and state.get("approved_action_id"):
        if not milestones:
            milestones = [{
                "id": 1,
                "description": state.get("original_request") or "Execute approved Modal sandbox action",
                "status": "pending",
                "assigned_to": "worker"
            }]
            active_index = 0
        elif active_index >= len(milestones):
            active_index = 0
        milestones[active_index]["assigned_to"] = "worker"

    # If the active milestone is NOT a worker milestone, skip
    if active_index >= len(milestones) or milestones[active_index].get("assigned_to") != "worker":
        logger.info(f"Worker skipping node - active milestone is assigned to: '{milestones[active_index].get('assigned_to') if active_index < len(milestones) else 'None'}'")
        return {}

    current_milestone = milestones[active_index]
    milestone_desc = current_milestone.get("description", "")
    logger.info(f"Worker processing milestone: '{milestone_desc}'")

    # Decide execution path: direct LLM response vs sandbox code execution
    if state.get("continuation_type") == "modal_sandbox_approval" and state.get("approved_action_id"):
        return await _handle_code_execution(state, current_milestone, milestones, active_index)
    if not _needs_sandbox_execution(user_query, milestone_desc):
        # --- CONVERSATIONAL PATH: Return LLM text directly ---
        return await _handle_conversational(state, current_milestone, milestones, active_index)
    else:
        # --- CODE EXECUTION PATH: Generate code, validate, execute in sandbox ---
        return await _handle_code_execution(state, current_milestone, milestones, active_index)


async def _handle_conversational(
    state: Dict[str, Any],
    current_milestone: dict,
    milestones: list,
    active_index: int
) -> Dict[str, Any]:
    """Handles conversational queries by running a local multi-turn tool execution loop.

    Permits Klawhub to inspect patterns, manage tasks, schedules, and memory securely.
    """
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional AI worker.")
    context_data = state.get("context_data", [])

    system_prompt = (
        f"You are {bot_name}, a premium AI coworker integrated into a Slack workspace.\n"
        f"Your personality is: {personality}\n\n"
        f"You have direct access to local tools for managing schedules, tasks, memory, and custom skills. "
        f"If the user asks you to perform an action on schedules, tasks, memory, or skills, or if you proactively detect a pattern "
        f"that would benefit from automation, you MUST invoke the corresponding tool by outputting a tool command wrapped in standard XML tags:\n"
        f"[TOOL:tool_name]json_payload[/TOOL]\n\n"
        f"AVAILABLE TOOLS:\n"
        f"1. schedule_control:\n"
        f"   - list: `{{\"action\": \"list\"}}`\n"
        f"   - create: `{{\"action\": \"create\", \"name\": \"Standup\", \"cron_expr\": \"0 9 * * 1-5\", \"action_text\": \"run standup\", \"timezone\": \"UTC\", \"channel_id\": \"C12345\"}}` (cron must have 5 fields)\n"
        f"   - pause: `{{\"action\": \"pause\", \"schedule_id\": \"UUID\"}}`\n"
        f"   - resume: `{{\"action\": \"resume\", \"schedule_id\": \"UUID\"}}`\n"
        f"   - delete: `{{\"action\": \"delete\", \"schedule_id\": \"UUID\"}}`\n"
        f"   - update: `{{\"action\": \"update\", \"schedule_id\": \"UUID\", \"name\": \"...\", ...}}`\n"
        f"2. task_control:\n"
        f"   - list: `{{\"action\": \"list\"}}`\n"
        f"   - create: `{{\"action\": \"create\", \"request\": \"Task request\", \"type\": \"action_item|bug_fix|research|feature_request\", \"status\": \"pending|completed\"}}`\n"
        f"   - update_status: `{{\"action\": \"update_status\", \"task_id\": \"UUID\", \"status\": \"pending|completed\"}}`\n"
        f"   - delete: `{{\"action\": \"delete\", \"task_id\": \"UUID\"}}`\n"
        f"3. memory_control:\n"
        f"   - search: `{{\"action\": \"search\", \"query\": \"Search query\"}}`\n"
        f"   - create: `{{\"action\": \"create\", \"content\": \"Memory content to remember\", \"category\": \"general|preference|context\"}}`\n"
        f"   - delete: `{{\"action\": \"delete\", \"memory_id\": \"UUID\"}}`\n"
        f"4. skill_control:\n"
        f"   - list: `{{\"action\": \"list\"}}`\n"
        f"   - create: `{{\"action\": \"create\", \"name\": \"excel_parser\", \"description\": \"parses excels\", \"source_code\": \"python_code_string\", \"entrypoint\": \"handler\", \"dependencies\": \"pandas,openpyxl\"}}`\n"
        f"   - toggle: `{{\"action\": \"toggle\", \"skill_id\": \"UUID\", \"is_active\": true|false}}`\n"
        f"   - delete: `{{\"action\": \"delete\", \"skill_id\": \"UUID\"}}`\n\n"
        f"DIRECTIONS:\n"
        f"- Output ONLY the tool tag if you need to run a tool first. Do not add any conversational text around it.\n"
        f"- The system will execute the tool and provide you with `[TOOL_RESPONSE:tool_name]json_result[/TOOL_RESPONSE]` so you can compile your final message or run subsequent tools.\n"
        f"- Once you receive the tool response, explain the action taken directly to the user in a friendly, conversational manner.\n"
    )

    workspace_id = state.get("workspace_id")
    slack_user_id = state.get("slack_user_id") or "U_AGENT"
    slack_channel_id = state.get("slack_channel_id") or ""
    slack_thread_ts = state.get("thread_id")

    import uuid
    ws_uuid = uuid.UUID(str(workspace_id))

    # Fetch few-shot learning style adaptation patterns
    few_shot_context = await _get_few_shot_examples(ws_uuid)
    if few_shot_context:
        system_prompt += few_shot_context

    if context_data:
        system_prompt += f"\nAvailable context:\n{context_data}\n"

    llm = LLMClient()
    current_query = user_query
    conversation_history = list(state.get("history") or [])

    MAX_ITERATIONS = 3
    final_output = ""

    try:
        for iteration in range(MAX_ITERATIONS):
            logger.info(f"Conversational Tool Loop Iteration {iteration + 1}/{MAX_ITERATIONS}")
            response = await llm.chat_completion(
                system_prompt=system_prompt,
                history=conversation_history,
                user_query=current_query,
                mode="STANDARD_CHAT"
            )

            content = response["content"].strip()
            final_output = content

            # Check for [TOOL:name]...[/TOOL] pattern
            start_tag = "[TOOL:"
            end_tag = "[/TOOL]"

            if start_tag in content and end_tag in content:
                try:
                    tag_start = content.find(start_tag)
                    tag_end = content.find(end_tag)

                    tool_clause = content[tag_start : tag_end + len(end_tag)]
                    tool_header = content[tag_start : content.find("]", tag_start)]
                    tool_name = tool_header.split(":")[1].strip()

                    payload_str = content[content.find("]", tag_start) + 1 : tag_end].strip()
                    payload = json.loads(payload_str)

                    logger.info(f"Conversational loop parsed tool call: {tool_name} with params: {payload}")

                    result = None
                    if tool_name == "schedule_control":
                        from src.core.tools.schedule_control import ScheduleControl
                        action = payload.get("action")
                        if action == "list":
                            result = await ScheduleControl.list_schedules(ws_uuid)
                        elif action == "create":
                            channel = payload.get("channel_id") or slack_channel_id
                            result = await ScheduleControl.create_schedule(
                                workspace_id=ws_uuid,
                                slack_user_id=slack_user_id,
                                name=payload.get("name", "Scheduled Task"),
                                cron_expr=payload.get("cron_expr"),
                                action=payload.get("action_text"),
                                channel_id=channel,
                                timezone=payload.get("timezone", "UTC")
                            )
                        elif action == "pause":
                            result = await ScheduleControl.toggle_schedule_status(
                                workspace_id=ws_uuid,
                                schedule_id=uuid.UUID(payload.get("schedule_id")),
                                is_active=False
                            )
                        elif action == "resume":
                            result = await ScheduleControl.toggle_schedule_status(
                                workspace_id=ws_uuid,
                                schedule_id=uuid.UUID(payload.get("schedule_id")),
                                is_active=True
                            )
                        elif action == "delete":
                            result = await ScheduleControl.delete_schedule(
                                workspace_id=ws_uuid,
                                schedule_id=uuid.UUID(payload.get("schedule_id"))
                            )
                        elif action == "update":
                            result = await ScheduleControl.update_schedule(
                                workspace_id=ws_uuid,
                                schedule_id=uuid.UUID(payload.get("schedule_id")),
                                name=payload.get("name"),
                                cron_expr=payload.get("cron_expr"),
                                action=payload.get("action_text"),
                                channel_id=payload.get("channel_id"),
                                timezone=payload.get("timezone")
                            )
                        else:
                            result = {"error": f"Unknown schedule_control action: {action}"}

                    elif tool_name == "task_control":
                        from src.core.tools.task_control import TaskControl
                        action = payload.get("action")
                        if action == "list":
                            result = await TaskControl.list_tasks(ws_uuid)
                        elif action == "create":
                            result = await TaskControl.create_task(
                                workspace_id=ws_uuid,
                                slack_user_id=slack_user_id,
                                request=payload.get("request"),
                                type=payload.get("type", "action_item"),
                                status=payload.get("status", "pending"),
                                channel_id=slack_channel_id,
                                thread_ts=slack_thread_ts
                            )
                        elif action == "update_status":
                            result = await TaskControl.update_task_status(
                                workspace_id=ws_uuid,
                                task_id=uuid.UUID(payload.get("task_id")),
                                status=payload.get("status")
                            )
                        elif action == "delete":
                            result = await TaskControl.delete_task(
                                workspace_id=ws_uuid,
                                task_id=uuid.UUID(payload.get("task_id"))
                            )
                        else:
                            result = {"error": f"Unknown task_control action: {action}"}

                    elif tool_name == "memory_control":
                        from src.core.tools.memory_control import MemoryControl
                        action = payload.get("action")
                        if action == "create":
                            result = await MemoryControl.create_memory(
                                workspace_id=ws_uuid,
                                slack_user_id=slack_user_id,
                                content=payload.get("content"),
                                category=payload.get("category", "general")
                            )
                        elif action == "search":
                            result = await MemoryControl.search_memories(
                                workspace_id=ws_uuid,
                                query=payload.get("query"),
                                limit=payload.get("limit", 5)
                            )
                        elif action == "delete":
                            result = await MemoryControl.delete_memory(
                                workspace_id=ws_uuid,
                                memory_id=uuid.UUID(payload.get("memory_id"))
                            )
                        else:
                            result = {"error": f"Unknown memory_control action: {action}"}

                    elif tool_name == "skill_control":
                        from src.core.tools.skill_control import SkillControl
                        action = payload.get("action")
                        if action == "list":
                            result = await SkillControl.list_skills(ws_uuid)
                        elif action == "create":
                            result = await SkillControl.create_skill(
                                workspace_id=ws_uuid,
                                name=payload.get("name"),
                                description=payload.get("description"),
                                source_code=payload.get("source_code"),
                                entrypoint=payload.get("entrypoint", "handler"),
                                repo_url=payload.get("repo_url"),
                                dependencies=payload.get("dependencies")
                            )
                        elif action == "toggle":
                            result = await SkillControl.toggle_skill_status(
                                workspace_id=ws_uuid,
                                skill_id=uuid.UUID(payload.get("skill_id")),
                                is_active=payload.get("is_active")
                            )
                        elif action == "delete":
                            result = await SkillControl.delete_skill(
                                workspace_id=ws_uuid,
                                skill_id=uuid.UUID(payload.get("skill_id"))
                            )
                        else:
                            result = {"error": f"Unknown skill_control action: {action}"}
                    else:
                        result = {"error": f"Tool '{tool_name}' is not registered."}

                    conversation_history.append({"role": "assistant", "content": content})
                    conversation_history.append({"role": "user", "content": f"[TOOL_RESPONSE:{tool_name}]{json.dumps(result)}[/TOOL_RESPONSE]"})
                    current_query = f"Here is the result of your tool invocation: {json.dumps(result)}. Please formulate your final response to the user."

                except Exception as e:
                    logger.error(f"Error executing local tool '{tool_name}' in conversational loop: {e}", exc_info=True)
                    conversation_history.append({"role": "assistant", "content": content})
                    conversation_history.append({"role": "user", "content": f"[TOOL_ERROR:{tool_name}]{str(e)}[/TOOL_ERROR]"})
                    current_query = f"An error occurred while running the tool: {str(e)}. Please inform the user and suggest next steps."
            else:
                logger.info("Conversational tool loop completed with final response.")
                break

        # Clean final response content of any tool clauses
        if start_tag in final_output:
            final_output = final_output.split(start_tag)[0].strip()

        if not final_output:
            final_output = "_No response generated by coworker._"

        updated_milestones = list(milestones)
        for m in updated_milestones:
            m["status"] = "completed"

        return {
            "worker_output": final_output,
            "milestones": updated_milestones,
            "errors": []
        }
    except Exception as e:
        logger.error(f"Worker conversational response failed: {str(e)}", exc_info=True)
        return {
            "errors": [f"Worker response error: {str(e)}"]
        }


async def _handle_code_execution(
    state: Dict[str, Any],
    current_milestone: dict,
    milestones: list,
    active_index: int
) -> Dict[str, Any]:
    """Handles queries that require code generation and sandbox execution with a stateful Approval Card check."""
    from src.integrations.sandbox import sandbox_client
    from src.core.evolution.compiler import ASTSafetyScanner, SecurityError
    from src.db.pool import get_db_session
    from src.db.models import PendingAction
    from sqlmodel import select
    import uuid

    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional AI worker.")
    context_data = state.get("context_data", [])
    workspace_id = state.get("workspace_id")
    slack_channel_id = state.get("slack_channel_id") or ""
    slack_thread_ts = state.get("thread_id")

    ws_uuid = uuid.UUID(str(workspace_id))
    milestone_desc = current_milestone.get("description", "")

    # Helper function to build Block Kit Approval Card
    def build_approval_card(action_id: uuid.UUID, desc: str, code_preview: str) -> list:
        return [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "⚠️ Sandbox Action Approval Required",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{bot_name}* has generated a Python script to execute inside the Modal Sandbox to complete:\n> *{desc}*"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Script Preview:*\n```python\n{code_preview}\n```"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✅ Approve & Run"},
                        "style": "primary",
                        "action_id": "approve_action",
                        "value": str(action_id)
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "❌ Reject"},
                        "style": "danger",
                        "action_id": "reject_action",
                        "value": str(action_id)
                    }
                ]
            }
        ]

    # Check database for an explicit approved action first, then fall back to this thread huddle.
    existing_action = None
    approved_action_id = state.get("approved_action_id")
    async with get_db_session() as session:
        if approved_action_id:
            try:
                explicit_stmt = select(PendingAction).where(
                    PendingAction.id == uuid.UUID(str(approved_action_id)),
                    PendingAction.workspace_id == ws_uuid,
                    PendingAction.tool_name == "modal_sandbox"
                )
                existing_action = (await session.execute(explicit_stmt)).scalar_one_or_none()
            except ValueError:
                return {"errors": [f"Invalid approved sandbox action id: {approved_action_id}"]}

        if not existing_action:
            statement = select(PendingAction).where(
                PendingAction.workspace_id == ws_uuid,
                PendingAction.tool_name == "modal_sandbox"
            ).order_by(PendingAction.created_at.desc())

            result = await session.execute(statement)
            actions = result.scalars().all()
            for act in actions:
                if act.params.get("thread_ts") == slack_thread_ts and act.status in ["pending", "approved", "rejected"]:
                    existing_action = act
                    break

    if approved_action_id and not existing_action:
        return {
            "errors": [f"Approved sandbox action was not found or is outside this workspace: {approved_action_id}"],
            "milestones": milestones
        }

    # If action was already rejected, return error
    if existing_action and existing_action.status == "rejected":
        logger.warning(f"Sandbox code execution rejected by user for thread {slack_thread_ts}")
        return {
            "errors": [f"❌ Sandbox execution was rejected by the user."],
            "milestones": milestones
        }

    # If action is still pending approval, return reminder
    if existing_action and existing_action.status == "pending":
        logger.info(f"Sandbox action {existing_action.id} is awaiting user approval.")
        return {
            "worker_output": "⚠️ Awaiting approval for sandbox code execution huddle. Please approve the card in the thread above.",
            "milestones": milestones,
            "errors": []
        }

    # If no pending action exists, generate code and create approval card
    if not existing_action:
        # Check if the query is a request to execute an active custom database skill
        custom_skill = None
        if "execute skill" in user_query.lower() or "run skill" in user_query.lower():
            words = user_query.lower().split()
            for i, word in enumerate(words):
                if word in ["skill", "skills"] and i + 1 < len(words):
                    candidate = words[i+1].strip(",.?!()'`\"")
                    from src.db.models import Skill
                    async with get_db_session() as session:
                        stmt = select(Skill).where(
                            Skill.workspace_id == ws_uuid,
                            Skill.name == candidate,
                            Skill.is_active == True
                        )
                        res = await session.execute(stmt)
                        custom_skill = res.scalar_one_or_none()
                    if custom_skill:
                        break

        if custom_skill:
            logger.info(f"Custom skill '{custom_skill.name}' retrieved from database. Bypassing LLM generation.")
            python_code = custom_skill.source_code
            milestone_desc = f"Execute custom skill: {custom_skill.name} ({custom_skill.description})"
        else:
            system_prompt = (
                f"You are the specialist Worker node for {bot_name}, a proactive AI coworker.\n"
                f"Your personality is: {personality}\n\n"
                f"Your task is to write a single, self-contained Python script to solve this milestone: '{milestone_desc}'\n"
                f"The user's query is: '{user_query}'\n"
                f"You have the following RAG database context available:\n{context_data}\n\n"
                f"Write high-quality, professional code. Enforce clean error handling. Print the final results to stdout.\n"
                f"You are limited to whitelisted utility packages (pandas, numpy, requests, csv, json, math, datetime, slack_sdk, document_generator).\n"
                f"Do NOT write 'eval()', 'exec()', or 'open()', or use forbidden modules, as they will be blocked by the safety scanner.\n\n"
                f"SPECIAL CAPABILITY: DOCUMENT GENERATION\n"
                f"The workspace has the 'document_generator' skill installed, which allows you to compile premium, high-fidelity corporate documents natively. "
                f"When you need to create a PDF, Excel sheet (XLSX), Word document (DOCX), or PowerPoint slide deck (PPTX), you MUST import and use 'document_generator'.\n"
                f"Always use the following high-fidelity APIs: \n"
                f"- PDF Generation:\n"
                f"  ```python\n"
                f"  import document_generator\n"
                f"  html_content = '<html><body><h1>PDF Title</h1></body></html>'\n"
                f"  document_generator.generate_pdf(html_content, 'filename.pdf')\n"
                f"  print('Generated PDF successfully')\n"
                f"  ```\n"
                f"- Spreadsheet/XLSX Generation:\n"
                f"  ```python\n"
                f"  import document_generator\n"
                f"  headers = ['Header 1', 'Header 2']\n"
                f"  data = [['Row 1 val 1', 'Row 1 val 2']]\n"
                f"  document_generator.generate_xlsx(data, 'filename.xlsx', headers=headers)\n"
                f"  print('Generated XLSX successfully')\n"
                f"  ```\n"
                f"Return the code strictly wrapped in a single markdown code block: ```python ... ```"
            )

            # Fetch few-shot learning style adaptation patterns
            few_shot_context = await _get_few_shot_examples(ws_uuid)
            if few_shot_context:
                system_prompt += few_shot_context

            llm = LLMClient()
            response = await llm.chat_completion(
                system_prompt=system_prompt,
                history=[],
                user_query=f"Generate the Python script to complete the active milestone: '{milestone_desc}'",
                mode="VETERAN_ENGINEERING"
            )

            content = response["content"]
            python_code = _extract_python_code(content)

            if not python_code:
                raise ValueError("Worker failed to extract clean python code block from LLM response.")

        # Create PendingAction in DB
        new_action = PendingAction(
            workspace_id=ws_uuid,
            slack_user_id=state.get("slack_user_id") or "U_AGENT",
            slack_channel_id=slack_channel_id,
            tool_name="modal_sandbox",
            params={"code": python_code, "milestone": milestone_desc, "thread_ts": slack_thread_ts},
            status="pending"
        )

        async with get_db_session() as session:
            session.add(new_action)
            await session.commit()

        # Post beautiful approval block card huddle to Slack thread
        from src.integrations.providers.slack.client import SlackClient
        slack_client_instance = SlackClient(ws_uuid)

        code_lines = python_code.splitlines()
        preview = "\n".join(code_lines[:8]) + ("\n# ... [code truncated]" if len(code_lines) > 8 else "")
        blocks = build_approval_card(new_action.id, milestone_desc, preview)

        logger.info(f"Posting sandbox approval card {new_action.id} to Slack channel {slack_channel_id} thread {slack_thread_ts}")
        await slack_client_instance.post_message(
            channel_id=slack_channel_id,
            text=f"⚠️ Human approval required to execute sandbox code.",
            blocks=blocks,
            thread_ts=slack_thread_ts
        )

        return {
            "worker_output": "⚠️ I have proposed a high-risk sandbox code execution. Please review and approve/reject it in the card above.",
            "milestones": milestones,
            "errors": []
        }

    # If action has been approved, retrieve code and execute it
    python_code = existing_action.params.get("code")
    logger.info(f"Sandbox action {existing_action.id} APPROVED. Proceeding to compile and execute...")

    from src.integrations.providers.slack.client import SlackClient
    slack_client_instance = SlackClient(ws_uuid)

    slack_sdk_client = None
    progress_ts = None
    try:
        slack_sdk_client = await slack_client_instance.get_sdk_client()
        # Post initial compilation progress checklist to thread
        progress_res = await slack_client_instance.post_message(
            channel_id=slack_channel_id,
            text="🔍 *Coworker Progress Checklist:*\n• ⏳ AST Static Safety Scan\n• ⏳ Modal Sandbox Compilation & Execution",
            thread_ts=slack_thread_ts
        )
        progress_ts = progress_res.get("ts") if progress_res else None
    except Exception as pe:
        logger.error(f"Failed to post initial progressive checklist: {pe}")

    try:
        # --- AST Static Safety Inbound Audit ---
        logger.info("Worker passing generated script to ASTSafetyScanner...")
        if progress_ts and slack_sdk_client:
            try:
                await slack_sdk_client.chat_update(
                    channel=slack_channel_id,
                    ts=progress_ts,
                    text="🔍 *Coworker Progress Checklist:*\n• 🔄 Running AST Static Safety Scan...\n• ⏳ Modal Sandbox Compilation & Execution"
                )
            except Exception as pe:
                logger.error(f"Failed to update progress status: {pe}")

        scanner = ASTSafetyScanner(python_code)
        scanner.scan()
        logger.info("AST validation SUCCESS. No security risks detected.")

        if progress_ts and slack_sdk_client:
            try:
                await slack_sdk_client.chat_update(
                    channel=slack_channel_id,
                    ts=progress_ts,
                    text="🔍 *Coworker Progress Checklist:*\n• ✅ AST Static Safety Scan Approved\n• 🔄 Executing Python script in Modal Cloud Sandbox..."
                )
            except Exception as pe:
                logger.error(f"Failed to update progress status: {pe}")

        # --- Sandbox Outbound Execution ---
        logger.info("Worker initiating Modal sandbox execution...")
        result = await sandbox_client.execute_code(python_code, language="python", workspace_id=workspace_id)

        # Mark pending action as completed in DB
        async with get_db_session() as session:
            statement = select(PendingAction).where(PendingAction.id == existing_action.id)
            db_act = (await session.execute(statement)).scalar_one_or_none()
            if db_act:
                db_act.status = "completed"
                db_act.updated_at = datetime.utcnow()
                await session.commit()

        if result.get("success"):
            stdout = result.get("stdout", "").strip()
            logger.info("Sandbox execution completed successfully.")

            if progress_ts and slack_sdk_client:
                try:
                    await slack_sdk_client.chat_update(
                        channel=slack_channel_id,
                        ts=progress_ts,
                        text="🔍 *Coworker Progress Checklist:*\n• ✅ AST Static Safety Scan Approved\n• ✅ Modal Cloud Sandbox Executed Successfully 🚀"
                    )
                except Exception as pe:
                    logger.error(f"Failed to update progress status: {pe}")

            updated_milestones = list(milestones)
            updated_milestones[active_index]["status"] = "completed"

            return {
                "worker_output": stdout,
                "milestones": updated_milestones,
                "errors": [],
                "generated_files": result.get("generated_files", [])
            }
        else:
            stderr = result.get("stderr", "").strip()
            logger.error(f"Sandbox execution failed: {stderr}")
            if progress_ts and slack_sdk_client:
                try:
                    await slack_sdk_client.chat_update(
                        channel=slack_channel_id,
                        ts=progress_ts,
                        text="🔍 *Coworker Progress Checklist:*\n• ✅ AST Static Safety Scan Approved\n• ❌ Modal Cloud Sandbox Execution Failed"
                    )
                except Exception as pe:
                    logger.error(f"Failed to update progress status: {pe}")
            return {
                "errors": [f"Sandbox runtime error: {stderr}"]
            }

    except SecurityError as se:
        logger.critical(f"Worker security scan BLOCKED malicious generated code: {str(se)}")
        if progress_ts and slack_sdk_client:
            try:
                await slack_sdk_client.chat_update(
                    channel=slack_channel_id,
                    ts=progress_ts,
                    text="🔍 *Coworker Progress Checklist:*\n• ❌ AST Static Safety Scan Blocked Malicious Code 🛡️\n• ⏳ Modal Sandbox Compilation & Execution"
                )
            except Exception as pe:
                logger.error(f"Failed to update progress status: {pe}")
        return {
            "errors": [f"AST Safety Blocked: {str(se)}"]
        }
    except Exception as e:
        logger.error(f"Worker failed to execute task: {str(e)}", exc_info=True)
        if progress_ts and slack_sdk_client:
            try:
                await slack_sdk_client.chat_update(
                    channel=slack_channel_id,
                    ts=progress_ts,
                    text="🔍 *Coworker Progress Checklist:*\n• ✅ AST Static Safety Scan Approved\n• ❌ Modal Cloud Sandbox Execution Halted with Errors"
                )
            except Exception as pe:
                logger.error(f"Failed to update progress status: {pe}")
        return {
            "errors": [f"Worker task exception: {str(e)}"]
        }

def _extract_python_code(text: str) -> str:
    """Safely extracts markdown python code block or returns text."""
    text = text.strip()
    if "```python" in text:
        return text.split("```python")[1].split("```")[0].strip()
    elif "```" in text:
        return text.split("```")[1].split("```")[0].strip()
    return text


async def _get_few_shot_examples(workspace_id: uuid.UUID) -> str:
    """Queries positive and negative WorkflowLearning examples to inject into system prompts."""
    from src.db.pool import get_db_session
    from src.db.models import WorkflowLearning
    from sqlmodel import select

    try:
        async with get_db_session() as session:
            # Positive examples: rating == 5, ordered by created_at desc (limit 3)
            pos_stmt = select(WorkflowLearning).where(
                WorkflowLearning.workspace_id == workspace_id,
                WorkflowLearning.rating == 5
            ).order_by(WorkflowLearning.created_at.desc()).limit(3)
            pos_res = await session.execute(pos_stmt)
            pos_examples = pos_res.scalars().all()

            # Negative examples: rating == 1, ordered by created_at desc (limit 3)
            neg_stmt = select(WorkflowLearning).where(
                WorkflowLearning.workspace_id == workspace_id,
                WorkflowLearning.rating == 1
            ).order_by(WorkflowLearning.created_at.desc()).limit(3)
            neg_res = await session.execute(neg_stmt)
            neg_examples = neg_res.scalars().all()

        context = ""
        if pos_examples:
            context += "\n--- APPROVED STYLE/BEHAVIOR PATTERNS (DO THESE) ---\n"
            for ex in pos_examples:
                context += f"User query/trigger: {ex.trigger_prompt}\nHelpful Response: {ex.correction}\n\n"
        if neg_examples:
            context += "\n--- DISAPPROVED STYLE/BEHAVIOR PATTERNS (AVOID THESE) ---\n"
            for ex in neg_examples:
                context += f"User query/trigger: {ex.trigger_prompt}\nUnhelpful/Incorrect Response: {ex.correction}\nAvoid this behavior/format.\n\n"
        return context
    except Exception as e:
        logger.error(f"Error loading few shot examples: {e}")
        return ""

