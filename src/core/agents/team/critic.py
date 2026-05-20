import logging
from typing import Dict, Any
from src.core.llm.client import LLMClient

logger = logging.getLogger("klawhub.core.agents.team.critic")

async def critic_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Critic Node: Red-teams the execution outputs for security flaws, resource hogs, and boundary errors."""
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Elite red-teaming systems engineer.")
    worker_output = state.get("worker_output", "")
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    if not worker_output:
        return {}

    current_milestone_desc = "None"
    if active_index < len(milestones):
        current_milestone_desc = milestones[active_index].get("description", "")

    logger.info(f"Critic node red-teaming output for milestone: '{current_milestone_desc}'")

    system_prompt = (
        f"You are the specialist Critic node for {bot_name}, a proactive AI coworker.\n"
        f"Your personality is: {personality}\n\n"
        f"Your task is to critically analyze (red-team) the Worker node's output for:\n"
        f"1. Security Vulnerabilities: Any dynamic token leakage, injection flaws, or sandbox escape attempts.\n"
        f"2. Edge Cases: Handling of empty datasets, null outputs, and divide-by-zero problems.\n"
        f"3. Architectural Integrity: Inconsistencies or code execution errors.\n\n"
        f"Target query: '{user_query}'\n"
        f"Worker output:\n{worker_output}\n\n"
        f"Confirm if the output is completely safe, reliable, and production-ready.\n"
        f"If correct, respond with exactly: APPROVED\n"
        f"If there are any vulnerabilities or severe edge-case flaws, explain them in detail."
    )

    llm = LLMClient()
    try:
        response = await llm.chat_completion(
            system_prompt=system_prompt,
            history=[],
            user_query="Red-team this Worker output and provide your verdict (APPROVED or detailed issues).",
            mode="STANDARD_CHAT"
        )

        feedback = response["content"].strip()
        
        if "APPROVED" in feedback.upper():
            logger.info("Critic verdict: APPROVED")
            return {
                "critic_feedback": "APPROVED",
                "errors": []
            }
        else:
            logger.warning(f"Critic rejected output due to concerns: {feedback}")
            return {
                "critic_feedback": feedback,
                "errors": [f"Critic red-team rejection: {feedback}"]
            }
    except Exception as e:
        logger.error(f"Critic failed to audit task: {str(e)}", exc_info=True)
        return {
            "errors": [f"Critic node failure: {str(e)}"]
        }
