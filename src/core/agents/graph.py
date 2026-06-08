import logging
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, START, END

# Import the cognitive nodes
from src.core.agents.team.sentinel import sentinel_node
from src.core.agents.team.orchestrator import orchestrator_node
from src.core.agents.team.explorer import explorer_node
from src.core.agents.team.worker import worker_node
from src.core.agents.team.reviewer import reviewer_node
from src.core.agents.team.critic import critic_node
from src.core.agents.team.auditor import auditor_node

# Persistent checkpointer for serverless-safe multi-step Slack workflows
from src.core.agents.state import HMACCheckpointSaver

logger = logging.getLogger("klawhub.core.agents.graph")


class AgentState(TypedDict):
    """The unified cognitive state schema for Klawhub's multi-agent system."""
    # Strict multi-tenant identifiers
    workspace_id: str
    thread_id: str
    user_query: str
    
    # Coworker custom profile loaded by Sentinel
    bot_name: str
    bot_personality: str
    enabled_skills: List[str]
    is_high_value_trigger: bool
    
    # Structured planning milestones DAG
    milestones: List[Dict[str, Any]]
    active_milestone_index: int
    
    # Accumulated context and output payloads
    context_data: List[str]
    worker_output: str
    
    # Reviewer and Critic cognitive feedbacks
    reviewer_feedback: str
    critic_feedback: str
    auditor_alert: str
    
    # Self-healing and error routing
    errors: List[str]
    
    # Sandbox generated files
    generated_files: Optional[List[Dict[str, Any]]]
    
    # Structured thread history list (e.g. [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}])
    history: Optional[List[Dict[str, str]]]

    # Slack delivery context propagated from the gateway for tool and approval flows
    slack_user_id: Optional[str]
    slack_channel_id: Optional[str]
    slack_message_ts: Optional[str]
    slack_thread_ts: Optional[str]

    # Explicit continuation metadata for multi-step Slack actions
    continuation_type: Optional[str]
    approved_action_id: Optional[str]
    original_request: Optional[str]


# --- Transition Routers ---

def orchestrator_router(state: AgentState) -> str:
    """Determines the next cognitive step based on the active milestone configuration."""
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    if active_index >= len(milestones):
        logger.info("All planned milestones are completed successfully. Routing to END.")
        return END

    current_milestone = milestones[active_index]
    assigned_to = (current_milestone.get("assigned_to") or "").lower()

    if assigned_to == "explorer":
        logger.info(f"Orchestrator routing to Explorer for milestone {current_milestone.get('id')}.")
        return "explorer"
    elif assigned_to == "worker":
        logger.info(f"Orchestrator routing to Worker for milestone {current_milestone.get('id')}.")
        return "worker"
    else:
        logger.warning(f"Unrecognized milestone assignee '{assigned_to}'. Gracefully routing to END.")
        return END


def worker_router(state: AgentState) -> str:
    """Routes execution after Worker node.
    
    - If errors: route to orchestrator for replan (max once due to milestone capping)
    - If all milestones completed: route directly to auditor (skip reviewer/critic for speed)
    - Otherwise: route to auditor for outbound leak check
    """
    errors = state.get("errors", [])
    if errors:
        logger.warning("Worker node raised errors. Routing back to Orchestrator.")
        return "orchestrator"
    
    # Skip Reviewer and Critic LLM calls — route directly to Auditor (regex-only, fast)
    # This avoids the slow 4+ LLM round-trip loop that causes recursion limit hits
    logger.info("Worker completed successfully. Routing to Auditor for outbound safety check.")
    return "auditor"


def auditor_router(state: AgentState) -> str:
    """Routes after the Auditor's regex-based credential leak scan.
    
    - If errors (leaked credentials detected): route to orchestrator to regenerate
    - If all milestones are done: route to END
    - Otherwise: route to orchestrator for next milestone
    """
    errors = state.get("errors", [])
    if errors:
        logger.warning("Auditor detected credential leaks. Routing back to Orchestrator.")
        return "orchestrator"
    
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)
    
    # Check if all milestones are completed
    all_done = all(m.get("status") == "completed" for m in milestones) if milestones else True
    if all_done or active_index >= len(milestones):
        logger.info("All milestones completed. Routing to END.")
        return END
    
    # More milestones remain — advance
    logger.info("Auditor passed. Routing to Orchestrator for next milestone.")
    return "orchestrator"


# --- Graph Topology Construction ---

def create_coworker_graph() -> StateGraph:
    """Constructs and wires up the streamlined LangGraph topology.
    
    Simplified pipeline: Sentinel → Orchestrator → Worker → Auditor → END
    The Reviewer and Critic nodes are kept in the graph but only used for 
    code-execution paths in future iterations.
    """
    workflow = StateGraph(AgentState)

    # 1. Add cognitive nodes
    workflow.add_node("sentinel", sentinel_node)
    workflow.add_node("orchestrator", orchestrator_node)
    workflow.add_node("explorer", explorer_node)
    workflow.add_node("worker", worker_node)
    workflow.add_node("auditor", auditor_node)

    # 2. Configure entry and static edges
    workflow.add_edge(START, "sentinel")
    workflow.add_edge("sentinel", "orchestrator")
    workflow.add_edge("explorer", "orchestrator")

    # 3. Configure conditional routing edges
    workflow.add_conditional_edges(
        "orchestrator",
        orchestrator_router,
        {
            "explorer": "explorer",
            "worker": "worker",
            END: END
        }
    )

    workflow.add_conditional_edges(
        "worker",
        worker_router,
        {
            "orchestrator": "orchestrator",
            "auditor": "auditor"
        }
    )

    workflow.add_conditional_edges(
        "auditor",
        auditor_router,
        {
            "orchestrator": "orchestrator",
            END: END
        }
    )

    return workflow


# Compile the production-ready runnable graph with persistent, signed checkpoints.
checkpointer = HMACCheckpointSaver()
coworker_app = create_coworker_graph().compile(checkpointer=checkpointer)
