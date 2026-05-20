import logging
from typing import Dict, Any
from src.core.llm.client import LLMClient

logger = logging.getLogger("klawhub.core.agents.team.reviewer")

async def reviewer_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Reviewer Node: Audits and verifies the functional correctness of Worker execution output."""
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional quality control auditor.")
    worker_output = state.get("worker_output", "")
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    if not worker_output:
        return {}

    current_milestone_desc = "None"
    if active_index < len(milestones):
        current_milestone_desc = milestones[active_index].get("description", "")

    logger.info(f"Reviewer node auditing output for milestone: '{current_milestone_desc}'")

    system_prompt = (
        f"You are the specialist Reviewer node for {bot_name}, a proactive AI coworker.\n"
        f"Your personality is: {personality}\n\n"
        f"Your task is to review the functional accuracy and completeness of the Worker node's output.\n"
        f"Target query: '{user_query}'\n"
        f"Target milestone description: '{current_milestone_desc}'\n"
        f"Worker output:\n{worker_output}\n\n"
        f"Confirm if the output successfully satisfies the milestone specifications.\n"
        f"If the output is correct, respond with exactly: APPROVED\n"
        f"If there are issues or missing information, provide highly detailed feedback explaining what needs fixing."
    )

    llm = LLMClient()
    try:
        response = await llm.chat_completion(
            system_prompt=system_prompt,
            history=[],
            user_query="Evaluate the Worker output and provide your verdict (APPROVED or detailed feedback).",
            mode="STANDARD_CHAT"
        )

        feedback = response["content"].strip()
        
        if "APPROVED" in feedback.upper():
            logger.info("Reviewer verdict: APPROVED")
            return {
                "reviewer_feedback": "APPROVED",
                "errors": []
            }
        else:
            logger.warning(f"Reviewer rejected output: {feedback}")
            return {
                "reviewer_feedback": feedback,
                "errors": [f"Reviewer rejection: {feedback}"]
            }
    except Exception as e:
        logger.error(f"Reviewer failed to audit task: {str(e)}", exc_info=True)
        return {
            "errors": [f"Reviewer node failure: {str(e)}"]
        }
