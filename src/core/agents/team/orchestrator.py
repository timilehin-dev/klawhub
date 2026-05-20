import logging
import json
from typing import Dict, Any, List
from src.core.llm.client import LLMClient

logger = logging.getLogger("klawhub.core.agents.team.orchestrator")

async def orchestrator_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Orchestrator Node: Takes a user query and plans a structured milestone DAG.
    
    Acts as the master project manager node inside Klawhub.
    """
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional and direct.")
    enabled_skills = state.get("enabled_skills", [])
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    # If milestones are already generated, we just evaluate progress or replan if error occurred
    if milestones:
        # Check if the previous milestone failed and needs replanning
        errors = state.get("errors", [])
        if errors:
            logger.warning(f"Orchestrator adjusting plan due to execution error: {errors[-1]}")
            # Run replanning step with LLM
            replanned = await _replan_milestones(state)
            return {
                "milestones": replanned["milestones"],
                "active_milestone_index": replanned["active_index"],
                "errors": [] # Clear error after replanning is completed
            }
        
        # Advance active milestone index if current one is done
        if active_index < len(milestones) and milestones[active_index].get("status") == "completed":
            active_index += 1
            logger.info(f"Orchestrator advancing to next milestone (index: {active_index})")
            
        return {
            "active_milestone_index": active_index
        }

    # Generate fresh plan
    logger.info(f"Orchestrator generating fresh milestone DAG for query: '{user_query}'")
    
    system_prompt = (
        f"You are the master Orchestrator node for {bot_name}, a proactive AI coworker.\n"
        f"Your personality is: {personality}\n\n"
        f"Your goal is to break down the user's complex request into a clear checklist of structured milestones.\n"
        f"The workspace has the following enabled capabilities/skills: {enabled_skills}\n\n"
        f"IMPORTANT PLANNING INSTRUCTION FOR DOCUMENT GENERATION:\n"
        f"If the user requests high-fidelity files or documents (like 'generate a PDF', 'compile an Excel sheet', 'create a Word DOCX', or 'build a PowerPoint presentation'), you must plan a milestone assigned to 'worker' to generate that specific document using the 'document_generator' skill.\n"
        f"Specify the exact file type (PDF, XLSX, DOCX, PPTX) and desired content in the milestone description so the worker executes the correct generator code.\n\n"
        f"Return the plan strictly as a JSON object inside a single markdown code block containing a list of milestones.\n"
        f"Format the JSON precisely as:\n"
        f"{{\n"
        f"  \"milestones\": [\n"
        f"    {{\"id\": 1, \"description\": \"Detailed description of milestone 1\", \"status\": \"pending\", \"assigned_to\": \"explorer\"}},\n"
        f"    {{\"id\": 2, \"description\": \"Detailed description of milestone 2\", \"status\": \"pending\", \"assigned_to\": \"worker\"}}\n"
        f"  ]\n"
        f"}}\n"
        f"Ensure there are no trailing commas or invalid JSON attributes."
    )

    llm = LLMClient()
    try:
        response = await llm.chat_completion(
            system_prompt=system_prompt,
            history=[],
            user_query=f"Analyze this query and build the milestone plan: '{user_query}'",
            mode="STANDARD_CHAT"
        )
        
        content = response["content"]
        # Extract and parse JSON block
        plan_json = _extract_json_block(content)
        parsed_plan = json.loads(plan_json)
        new_milestones = parsed_plan.get("milestones", [])
        
        logger.info(f"Orchestrator successfully compiled {len(new_milestones)} milestones.")
        return {
            "milestones": new_milestones,
            "active_milestone_index": 0
        }
    except Exception as e:
        logger.error(f"Orchestrator failed to plan milestones: {str(e)}", exc_info=True)
        # Safe default milestone block on planning failures
        fallback_milestones = [
            {"id": 1, "description": f"Gather context semantic data for: {user_query}", "status": "pending", "assigned_to": "explorer"},
            {"id": 2, "description": f"Execute operations and build final summary response", "status": "pending", "assigned_to": "worker"}
        ]
        return {
            "milestones": fallback_milestones,
            "active_milestone_index": 0,
            "errors": [f"Planning error: {str(e)}"]
        }

async def _replan_milestones(state: Dict[str, Any]) -> Dict[str, Any]:
    """Helper method to dynamically adjust the milestone plan if a defect or exception is raised.
    
    Enforces a maximum retry cap of 3 attempts per milestone to prevent infinite
    Worker → Orchestrator retry loops when external services (e.g., Ollama) are down.
    """
    milestones = list(state.get("milestones", []))
    active_index = state.get("active_milestone_index", 0)
    errors = state.get("errors", [])
    
    MAX_RETRIES = 3
    
    if active_index < len(milestones):
        current = milestones[active_index]
        retry_count = current.get("_retry_count", 0) + 1
        current["_retry_count"] = retry_count
        
        if retry_count >= MAX_RETRIES:
            # Cap reached — abort this milestone and force graph exit
            logger.error(
                f"Milestone {current.get('id')} failed after {MAX_RETRIES} attempts. "
                f"Last error: {errors[-1] if errors else 'Unknown'}. Aborting execution."
            )
            current["status"] = "failed"
            # Force all milestones to completed so orchestrator_router routes to END
            for m in milestones:
                if m.get("status") != "failed":
                    m["status"] = "completed"
            
            return {
                "milestones": milestones,
                "active_index": active_index,
                "worker_output": (
                    f":warning: I was unable to complete this task after {MAX_RETRIES} attempts. "
                    f"The last error encountered was: {errors[-1] if errors else 'an unknown issue'}. "
                    f"Please try again in a few minutes."
                )
            }
        
        current["description"] += f" (Retrying due to previous failure: {errors[-1]})"
        current["status"] = "pending"
        
    return {
        "milestones": milestones,
        "active_index": active_index
    }

def _extract_json_block(text: str) -> str:
    """Safely parses and extracts markdown code block wrapper or returns raw string."""
    text = text.strip()
    if "```json" in text:
        return text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        return text.split("```")[1].split("```")[0].strip()
    return text
