from langgraph.graph import StateGraph, END
from src.core.agents.graph_state import AgentState
from src.core.agents.nodes.general import general_node
from src.core.agents.nodes.planner import planner_node
from src.core.agents.nodes.qa import qa_node

# Create graph
workflow = StateGraph(AgentState)

# Add agent nodes
workflow.add_node("general", general_node)
workflow.add_node("planner", planner_node)
workflow.add_node("qa", qa_node)

# Set General Agent as entrypoint
workflow.set_entry_point("general")

# Routing logic
def router(state: AgentState) -> str:
    next_dest = state.get("next_node", "end")
    if next_dest == "general":
        return "general"
    elif next_dest == "planner":
        return "planner"
    elif next_dest == "qa":
        return "qa"
    else:
        return END

# Add conditional edges
workflow.add_conditional_edges(
    "general",
    router,
    {
        "general": "general",
        "planner": "planner",
        "qa": "qa",
        END: END
    }
)

workflow.add_conditional_edges(
    "planner",
    router,
    {
        "general": "general",
        "qa": "qa",
        END: END
    }
)

workflow.add_conditional_edges(
    "qa",
    router,
    {
        "general": "general",
        END: END
    }
)

# Compile graph
agent_graph = workflow.compile()
