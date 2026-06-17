"""
General Agent Node — the primary intent router and tool executor.

Fixes applied:
- Tool name validated BEFORE dict access (no more KeyError)
- Google Calendar and GitHub tools registered
- Planner delegation guarded by planner_depth counter
- workspace_id auto-injected safely
"""
import json
from src.core.llm.client import llm_client
from src.core.agents.graph_state import AgentState
from src.core.tools.web_search import search_web_tool
from src.core.tools.memory_tools import (
    remember_observation, query_memory_tool,
    add_knowledge_item, query_knowledge_tool,
)
from src.core.tools.schedule_tools import (
    create_schedule_tool, list_schedules_tool,
    update_schedule_tool, delete_schedule_tool,
)
from src.core.tools.task_tools import (
    create_task_tool, list_tasks_tool,
    update_task_tool, delete_task_tool,
)
from src.core.tools.workflow_tools import (
    create_workflow_tool, list_workflows_tool,
    update_workflow_tool, delete_workflow_tool, trigger_workflow_tool,
)
from src.core.tools.skill_runner import run_skill_tool
from src.core.tools.skill_creator import create_skill_tool
from src.core.tools.google_tools import (
    list_calendar_events_tool, create_calendar_event_tool,
    list_drive_files_tool,
    list_gmail_messages_tool, send_gmail_message_tool,
)
from src.core.tools.github_tools import (
    list_repos_tool, create_github_issue_tool,
    list_github_issues_tool, create_pull_request_tool,
)

# ── Tool Registry ─────────────────────────────────────────────────────────────
# NOTE: Every tool added here MUST also appear in SYSTEM_INSTRUCTIONS below.
TOOLS = {
    # Search & Research
    "search_web": search_web_tool,
    # Memory & Knowledge
    "remember_observation": remember_observation,
    "query_memory": query_memory_tool,
    "add_knowledge_item": add_knowledge_item,
    "query_knowledge": query_knowledge_tool,
    # Schedules
    "create_schedule": create_schedule_tool,
    "list_schedules": list_schedules_tool,
    "update_schedule": update_schedule_tool,
    "delete_schedule": delete_schedule_tool,
    # Tasks
    "create_task": create_task_tool,
    "list_tasks": list_tasks_tool,
    "update_task": update_task_tool,
    "delete_task": delete_task_tool,
    # Workflows / Automations
    "create_workflow": create_workflow_tool,
    "list_workflows": list_workflows_tool,
    "update_workflow": update_workflow_tool,
    "delete_workflow": delete_workflow_tool,
    "trigger_workflow": trigger_workflow_tool,
    # Skills
    "run_skill": run_skill_tool,
    "create_skill": create_skill_tool,
    # Google Workspace
    "list_calendar_events": list_calendar_events_tool,
    "create_calendar_event": create_calendar_event_tool,
    "list_drive_files": list_drive_files_tool,
    "list_gmail_messages": list_gmail_messages_tool,
    "send_gmail_message": send_gmail_message_tool,
    # GitHub
    "list_repos": list_repos_tool,
    "create_github_issue": create_github_issue_tool,
    "list_github_issues": list_github_issues_tool,
    "create_pull_request": create_pull_request_tool,
}

SYSTEM_INSTRUCTIONS = """
You are the General Agent in KlawHub — a self-evolving, Slack-first AI coworker.
Your goal is to process user requests accurately and completely. Use tools where necessary.

## Tool Invocation
To call a tool, respond with a JSON block inside triple-backtick markdown:
```json
{
  "tool": "tool_name",
  "args": {
    "arg1": "val1"
  }
}
```

## Available Tools

### Search & Research
- search_web(query: str, deep_research: bool)

### Memory & Knowledge
- remember_observation(workspace_id, content, memory_type?)
- query_memory(workspace_id, query, limit?)
- add_knowledge_item(workspace_id, title, content, source_url?, tags?)
- query_knowledge(workspace_id, query, limit?)

### Schedules (CRUD)
- create_schedule(workspace_id, name, schedule_type, cron_expr, channel_id, payload)
- list_schedules(workspace_id)
- update_schedule(schedule_id, updates)
- delete_schedule(schedule_id)

### Tasks (CRUD)
- create_task(workspace_id, title, description, priority, payload)
- list_tasks(workspace_id, status?)
- update_task(task_id, updates)
- delete_task(task_id)

### Workflows / Automations (CRUD)
- create_workflow(workspace_id, name, description, trigger_type, trigger_config, steps)
- list_workflows(workspace_id)
- update_workflow(workflow_id, updates)
- delete_workflow(workflow_id)
- trigger_workflow(workflow_id, input_data)

### Skills
- run_skill(slug, workspace_id, inputs)
- create_skill(workspace_id, name, slug, description, instructions, requirements, test_input)

### Google Workspace
- list_calendar_events(workspace_id, max_results?)
- create_calendar_event(workspace_id, summary, start_datetime, end_datetime, description?)
- list_drive_files(workspace_id, query?)
- list_gmail_messages(workspace_id, max_results?, query?)
- send_gmail_message(workspace_id, to, subject, body)

### GitHub
- list_repos(workspace_id)
- create_github_issue(workspace_id, repo, title, body?)
- list_github_issues(workspace_id, repo, state?)
- create_pull_request(workspace_id, repo, title, head, base, body?)

## Delegation
If the request requires complex multi-step planning, delegate:
```json
{
  "delegate_to_planner": true,
  "task_description": "Clear description of what needs to be done"
}
```

## Rules
- Always supply `workspace_id` where required.
- Never fabricate tool results. If a tool fails, report the error.
- Once you have a complete answer, respond directly in plain text (no JSON blocks).
"""


async def general_node(state: AgentState) -> AgentState:
    """Executes the General Agent — intent routing, tool calling, and response generation."""
    messages = list(state.get("messages", []))

    # Prepend system instructions if not already present
    if not any(m["role"] == "system" and "General Agent" in m["content"] for m in messages):
        messages.insert(0, {"role": "system", "content": SYSTEM_INSTRUCTIONS})

    # Track total token consumption across all tool-call iterations
    total_prompt_tokens = 0
    total_completion_tokens = 0

    for _ in range(8):  # Max 8 tool-call iterations
        res = await llm_client.chat_completion(messages, temperature=0.0)
        response_content = res.get("choices", [{}])[0].get("message", {}).get("content", "")

        # Extract token usage from LLM response
        usage = res.get("usage", {})
        total_prompt_tokens += usage.get("prompt_tokens", 0) or 0
        total_completion_tokens += usage.get("completion_tokens", 0) or 0
        state["prompt_tokens"] = total_prompt_tokens
        state["completion_tokens"] = total_completion_tokens

        # ── Check for Planner delegation ───────────────────────────────────────
        if '"delegate_to_planner": true' in response_content or '"delegate_to_planner":true' in response_content:
            # Guard against recursive planner delegation
            planner_depth = state.get("planner_depth", 0)
            if planner_depth >= 1:
                # Already inside planner orchestration — force direct execution
                messages.append({
                    "role": "user",
                    "content": (
                        "[System]: You are already inside a Planner sub-task. "
                        "Do NOT re-delegate. Solve this directly using available tools."
                    ),
                })
                continue

            try:
                start = response_content.find("{")
                end = response_content.rfind("}") + 1
                parsed = json.loads(response_content[start:end])
                state["current_task"] = parsed.get("task_description")
                state["next_node"] = "planner"
                state["planner_depth"] = planner_depth + 1
                return state
            except Exception:
                pass  # Malformed JSON — treat as regular text response

        # ── Check for Tool call ────────────────────────────────────────────────
        if "```json" in response_content:
            try:
                start = response_content.find("```json") + 7
                end = response_content.find("```", start)
                tool_json = response_content[start:end].strip()
                parsed = json.loads(tool_json)

                tool_name = parsed.get("tool")
                tool_args = parsed.get("args", {})

                # ✅ CRITICAL FIX: validate tool_name exists BEFORE dict access
                if not tool_name or tool_name not in TOOLS:
                    messages.append({"role": "assistant", "content": response_content})
                    messages.append({
                        "role": "user",
                        "content": f"[System Error]: Unknown tool '{tool_name}'. Choose from: {', '.join(TOOLS.keys())}",
                    })
                    continue

                # Auto-inject workspace_id if missing
                # Check all parameters for workspace_id, including positional args
                fn = TOOLS[tool_name]
                if "workspace_id" not in tool_args:
                    import inspect
                    sig = inspect.signature(fn)
                    if "workspace_id" in sig.parameters:
                        tool_args["workspace_id"] = state["workspace_id"]

                state["logs"].append(f"→ Calling tool: {tool_name}")
                tool_result = await TOOLS[tool_name](**tool_args)

                messages.append({"role": "assistant", "content": response_content})
                messages.append({"role": "user", "content": f"[Tool Result: {tool_name}]: {tool_result}"})
                continue

            except json.JSONDecodeError as e:
                messages.append({"role": "assistant", "content": response_content})
                messages.append({"role": "user", "content": f"[System Error]: Invalid JSON in tool call: {e}"})
                continue
            except Exception as e:
                messages.append({"role": "assistant", "content": response_content})
                messages.append({"role": "user", "content": f"[System Error]: Tool execution failed: {e}"})
                continue

        # ── Final response ─────────────────────────────────────────────────────
        state["output"] = response_content
        state["next_node"] = "qa"
        return state

    # Max iterations reached — still forward to QA
    state["output"] = "I reached the maximum number of reasoning steps. Here is my best answer so far."
    state["next_node"] = "qa"
    return state
