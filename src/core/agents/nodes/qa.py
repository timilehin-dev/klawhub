from src.core.agents.graph_state import AgentState
from src.core.security.dlp_auditor import dlp_auditor
from src.core.llm.client import llm_client

QA_PROMPT = """
You are the QA Auditor Agent in KlawHub.
Your task is to review the drafted response before it is sent to Slack.

Draft Response:
---
{draft}
---

Review Guidelines:
1. Ensure the draft response is coherent and fully addresses the user query.
2. Verify there are no factual hallucinations or contradictions.
3. Check for structural formatting issues.

If the response is 100% correct and ready to send, reply with exactly: APPROVED
If there are issues, explain them in detail so the General Agent can correct them.
"""

async def qa_node(state: AgentState) -> AgentState:
    """Outbound quality gate auditing draft outputs for security and factual correctness."""
    draft = state.get("output", "")
    
    # 1. DLP Firewall scan (Credentials/token leak redaction)
    state["logs"].append("DLP firewall scanning outbound draft...")
    redacted_draft = dlp_auditor.audit_and_redact(draft)
    
    # 2. Factual validation check via LLM
    state["logs"].append("QA Auditor checking factual coherence...")
    prompt = QA_PROMPT.format(draft=redacted_draft)
    
    res = await llm_client.chat_completion([{"role": "user", "content": prompt}], temperature=0.0)
    verdict = res.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

    if "APPROVED" in verdict:
        # QA Passed!
        state["logs"].append("QA Check: PASSED.")
        state["final_response"] = redacted_draft
        state["next_node"] = "end"
    else:
        # QA Failed. Determine if we should attempt self-correction
        qa_failures = [log for log in state["logs"] if "QA Check: FAILED" in log]
        
        if len(qa_failures) < 2:
            state["logs"].append(f"QA Check: FAILED. Reason: {verdict}")
            # Redirect back to General for correction
            state["messages"].append({
                "role": "user",
                "content": (
                    f"[QA Audit Feedback]: The drafted response failed audit with the following feedback:\n{verdict}\n"
                    "Please rewrite the response, addressing these issues."
                )
            })
            state["next_node"] = "general"
        else:
            # Prevent infinite self-correction loops - force pass after 2 failures but log a warning
            state["logs"].append("QA Check: FAILED (Max correction loops reached). Forcing bypass.")
            state["final_response"] = redacted_draft + "\n\n_(QA: Max correction attempts reached. Output may require review.)_"
            state["next_node"] = "end"
            
    return state
