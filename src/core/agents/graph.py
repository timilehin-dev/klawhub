import logging
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, START, END

# Import the 7 cognitive nodes
from src.core.agents.team.sentinel import sentinel_node
from src.core.agents.team.orchestrator import orchestrator_node
from src.core.agents.team.explorer import explorer_node
from src.core.agents.team.worker import worker_node
from src.core.agents.team.reviewer import reviewer_node
from src.core.agents.team.critic import critic_node
from src.core.agents.team.auditor import auditor_node

# Import multi-tenant secure checkpointer
# Using MemorySaver as each serverless invocation is isolated;
# the custom HMACCheckpointSaver lacks the aput_writes method required by newer LangGraph
from langgraph.checkpoint.memory import MemorySaver

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
    """Routes execution after Worker node execution depending on success or errors."""
    errors = state.get("errors", [])
    if errors:
        logger.warning("Worker node raised runtime or security errors. Routing back to Orchestrator for self-healing replanning.")
        return "orchestrator"
    
    logger.info("Worker node executed successfully. Routing to Reviewer for functional audit.")
    return "reviewer"


def reviewer_router(state: AgentState) -> str:
    """Routes execution after Reviewer functional audit."""
    errors = state.get("errors", [])
    if errors:
        logger.warning("Reviewer rejected the Worker's functional output. Routing back to Orchestrator for correction/replan.")
        return "orchestrator"
    
    logger.info("Reviewer node approved the output. Routing to Critic for safety and red-teaming checks.")
    return "critic"


def critic_router(state: AgentState) -> str:
    """Routes execution after Critic security red-teaming."""
    errors = state.get("errors", [])
    if errors:
        logger.warning("Critic node rejected the output due to security/integrity concerns. Routing back to Orchestrator.")
        return "orchestrator"
    
    logger.info("Critic node approved. Routing to Auditor for outbound leak firewall check.")
    return "auditor"


# --- Graph Topology Construction ---

def create_coworker_graph() -> StateGraph:
    """Constructs and wires up the 7-node LangGraph topology with transition structures."""
    workflow = StateGraph(AgentState)

    # 1. Add all cognitive specialist nodes
    workflow.add_node("sentinel", sentinel_node)
    workflow.add_node("orchestrator", orchestrator_node)
    workflow.add_node("explorer", explorer_node)
    workflow.add_node("worker", worker_node)
    workflow.add_node("reviewer", reviewer_node)
    workflow.add_node("critic", critic_node)
    workflow.add_node("auditor", auditor_node)

    # 2. Configure entry point and static edges
    workflow.add_edge(START, "sentinel")
    workflow.add_edge("sentinel", "orchestrator")
    workflow.add_edge("explorer", "orchestrator")
    workflow.add_edge("auditor", "orchestrator")

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
            "reviewer": "reviewer"
        }
    )

    workflow.add_conditional_edges(
        "reviewer",
        reviewer_router,
        {
            "orchestrator": "orchestrator",
            "critic": "critic"
        }
    )

    workflow.add_conditional_edges(
        "critic",
        critic_router,
        {
            "orchestrator": "orchestrator",
            "auditor": "auditor"
        }
    )

    return workflow


# Compile the production-ready runnable graph backed by in-memory checkpointer
checkpointer = MemorySaver()
coworker_app = create_coworker_graph().compile(checkpointer=checkpointer)
