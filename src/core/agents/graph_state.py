from typing import TypedDict, List, Dict, Any, Optional


class AgentState(TypedDict):
    # Workspace & Slack context
    workspace_id: str
    channel_id: str
    thread_ts: str

    # Conversation history
    messages: List[Dict[str, str]]

    # Routing
    next_node: str              # 'general' | 'planner' | 'qa' | 'end'

    # Planner state
    current_task: Optional[str]
    planner_card_ts: Optional[str]
    milestones: Optional[List[Dict[str, Any]]]
    planner_depth: int          # Recursion guard — max 1 level deep

    # Execution logs
    logs: List[str]

    # Output pipeline
    output: str                 # Draft answer from General Agent
    final_response: str         # DLP-redacted, QA-approved answer

    # Token usage tracking (populated by general_node)
    prompt_tokens: int          # Total prompt tokens across all iterations
    completion_tokens: int      # Total completion tokens across all iterations
    skill_used: Optional[str]   # Name of the skill used (if any)
