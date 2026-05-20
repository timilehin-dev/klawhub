import logging
from typing import Dict, Any, List
from src.core.llm.client import LLMClient
from src.integrations.sandbox import sandbox_client
from src.core.evolution.compiler import ASTSafetyScanner, SecurityError

logger = logging.getLogger("klawhub.core.agents.team.worker")

async def worker_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Worker Node: Generates, validates (via AST), and executes custom task operations.
    
    Uses SandboxClient to run operations in a secure Modal container.
    """
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional AI worker.")
    context_data = state.get("context_data", [])
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    # If the active milestone is NOT a worker milestone, skip
    if active_index >= len(milestones) or milestones[active_index].get("assigned_to") != "worker":
        logger.info(f"Worker skipping node - active milestone is assigned to: '{milestones[active_index].get('assigned_to') if active_index < len(milestones) else 'None'}'")
        return {}

    current_milestone = milestones[active_index]
    logger.info(f"Worker processing milestone: '{current_milestone.get('description')}'")

    system_prompt = (
        f"You are the specialist Worker node for {bot_name}, a proactive AI coworker.\n"
        f"Your personality is: {personality}\n\n"
        f"Your task is to write a single, self-contained Python script to solve this milestone: '{current_milestone.get('description')}'\n"
        f"The user's query is: '{user_query}'\n"
        f"You have the following RAG database context available:\n{context_data}\n\n"
        f"Write high-quality, professional code. Enforce clean error handling. Print the final results to stdout.\n"
        f"You are limited to whitelisted utility packages (pandas, numpy, requests, csv, json, math, datetime, slack_sdk).\n"
        f"Do NOT write 'eval()', 'exec()', 'open()', or use 'os' or 'subprocess' modules, as they will be blocked by the safety scanner.\n"
        f"Return the code strictly wrapped in a single markdown code block: ```python ... ```"
    )

    llm = LLMClient()
    try:
        response = await llm.chat_completion(
            system_prompt=system_prompt,
            history=[],
            user_query=f"Generate the Python script to complete the active milestone: '{current_milestone.get('description')}'",
            mode="VETERAN_ENGINEERING"
        )

        content = response["content"]
        python_code = _extract_python_code(content)

        if not python_code:
            raise ValueError("Worker failed to extract clean python code block from LLM response.")

        # --- AST Static Safety Inbound Audit ---
        logger.info("Worker passing generated script to ASTSafetyScanner...")
        scanner = ASTSafetyScanner(python_code)
        # Will raise SecurityError if forbidden tokens/imports are present
        scanner.scan()
        logger.info("AST validation SUCCESS. No security risks detected.")

        # --- Sandbox Outbound Execution ---
        logger.info("Worker initiating Modal sandbox execution...")
        workspace_id = state.get("workspace_id")
        result = await sandbox_client.execute_code(python_code, language="python", workspace_id=workspace_id)

        if result.get("success"):
            stdout = result.get("stdout", "").strip()
            logger.info("Sandbox execution completed successfully.")
            
            # Mark milestone as completed
            updated_milestones = list(milestones)
            updated_milestones[active_index]["status"] = "completed"
            
            return {
                "worker_output": stdout,
                "milestones": updated_milestones,
                "errors": []
            }
        else:
            stderr = result.get("stderr", "").strip()
            logger.error(f"Sandbox execution failed: {stderr}")
            return {
                "errors": [f"Sandbox runtime error: {stderr}"]
            }

    except SecurityError as se:
        logger.critical(f"Worker security scan BLOCKED malicious generated code: {str(se)}")
        return {
            "errors": [f"AST Safety Blocked: {str(se)}"]
        }
    except Exception as e:
        logger.error(f"Worker failed to execute task: {str(e)}", exc_info=True)
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
