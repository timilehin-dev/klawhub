import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, String, text, Index, UniqueConstraint
from sqlalchemy.types import UserDefinedType
from sqlalchemy.dialects.postgresql import JSONB, UUID

class PGVector(UserDefinedType):
    """Custom compile pgvector type to handle raw float list serialization and deserialization."""
    def __init__(self, dimensions: int = 384):
        self.dimensions = dimensions

    def get_col_spec(self, **kw):
        return f"vector({self.dimensions})"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            if isinstance(value, list):
                return "[" + ",".join(map(str, value)) + "]"
            return value
        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            if isinstance(value, str):
                cleaned = value.strip("[]")
                if not cleaned:
                    return []
                return [float(x) for x in cleaned.split(",")]
            return value
        return process

class Workspace(SQLModel, table=True):
    __tablename__ = "workspaces"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    slack_team_id: str = Field(sa_column=Column(String, unique=True, nullable=False))
    slack_bot_user_id: str = Field(nullable=False)
    bot_token: Optional[str] = Field(default=None)
    name: str = Field(nullable=False)
    domain: Optional[str] = Field(default=None)
    plan: str = Field(default="free", nullable=False)
    monthly_run_limit: int = Field(default=50, nullable=False)
    stripe_customer_id: Optional[str] = Field(default=None)
    stripe_subscription_id: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True, nullable=False)
    agent_name: str = Field(default="Klawhub", nullable=False)
    agent_personality: Optional[str] = Field(default=None)
    enabled_skills: List[str] = Field(
        default=["web_search", "puppeteer_scraping", "python_sandbox", "pdf_generator"],
        sa_column=Column(JSONB, nullable=False, server_default=text("'[\"web_search\",\"puppeteer_scraping\",\"python_sandbox\",\"pdf_generator\"]'::jsonb"))
    )
    installed_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    last_heartbeat_briefing_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()"), "onupdate": text("now()")})

class WorkspaceMember(SQLModel, table=True):
    __tablename__ = "workspace_members"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    slack_user_name: Optional[str] = Field(default=None)
    slack_user_email: Optional[str] = Field(default=None)
    is_workspace_admin: bool = Field(default=False, nullable=False)
    last_active_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_workspace_members_workspace_id", "workspace_id"),
    )

class AgentState(SQLModel, table=True):
    __tablename__ = "agent_states"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    agent_name: str = Field(nullable=False)
    state: Dict[str, Any] = Field(default={}, sa_column=Column(JSONB, nullable=False, server_default=text("'{}'::jsonb")))
    last_active_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    
    __table_args__ = (
        UniqueConstraint("workspace_id", "agent_name", name="agent_states_workspace_id_agent_name_unique"),
    )

class Integration(SQLModel, table=True):
    __tablename__ = "integrations"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    provider: str = Field(nullable=False)
    status: str = Field(default="active", nullable=False)
    access_token_encrypted: str = Field(nullable=False)
    refresh_token_encrypted: Optional[str] = Field(default=None)
    expires_at: Optional[datetime] = Field(default=None)
    scope: Optional[str] = Field(default=None)
    integration_metadata: Dict[str, Any] = Field(default={}, sa_column=Column("metadata", JSONB, server_default=text("'{}'::jsonb")))
    external_account_id: Optional[str] = Field(default=None)
    external_account_name: Optional[str] = Field(default=None)
    external_account_email: Optional[str] = Field(default=None)
    last_used_at: Optional[datetime] = Field(default=None)
    error_count: int = Field(default=0, nullable=False)
    last_error: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        UniqueConstraint("workspace_id", "provider", name="unique_workspace_provider"),
        Index("idx_integrations_workspace_provider", "workspace_id", "provider"),
    )

class DocumentChunk(SQLModel, table=True):
    __tablename__ = "document_chunks"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    source_id: str = Field(nullable=False)
    source_type: str = Field(nullable=False)
    content: str = Field(nullable=False)
    embedding: Optional[List[float]] = Field(default=None, sa_column=Column(PGVector(384), nullable=True))
    chunk_metadata: Dict[str, Any] = Field(default={}, sa_column=Column("metadata", JSONB, server_default=text("'{}'::jsonb")))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_chunks_workspace_source", "workspace_id", "source_id"),
    )

class Knowledge(SQLModel, table=True):
    __tablename__ = "knowledge"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    entity_type: str = Field(nullable=False)
    entity_name: str = Field(nullable=False)
    data: Dict[str, Any] = Field(default={}, sa_column=Column(JSONB, nullable=False, server_default=text("'{}'::jsonb")))
    source: Optional[str] = Field(default=None)
    embedding: Optional[List[float]] = Field(default=None, sa_column=Column(PGVector(384), nullable=True))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_knowledge_workspace_id", "workspace_id"),
    )

class MCPServer(SQLModel, table=True):
    __tablename__ = "mcp_servers"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    name: str = Field(nullable=False)
    url: str = Field(nullable=False)
    status: str = Field(default="active", nullable=False)
    auth_config: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    tools_schema: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_mcp_servers_workspace_id", "workspace_id"),
    )

class Memory(SQLModel, table=True):
    __tablename__ = "memory"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    content: str = Field(nullable=False)
    category: str = Field(default="general")
    embedding: Optional[List[float]] = Field(default=None, sa_column=Column(PGVector(384), nullable=True))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_memory_workspace_user", "workspace_id", "slack_user_id"),
    )

class PendingAction(SQLModel, table=True):
    __tablename__ = "pending_actions"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    slack_channel_id: str = Field(nullable=False)
    tool_name: str = Field(nullable=False)
    params: Dict[str, Any] = Field(sa_column=Column(JSONB, nullable=False))
    status: str = Field(default="pending", nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_pending_actions_workspace_id", "workspace_id"),
    )

class ProcessedEvent(SQLModel, table=True):
    __tablename__ = "processed_events"
    
    event_id: str = Field(primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_processed_events_created", "created_at"),
    )

class Run(SQLModel, table=True):
    __tablename__ = "runs"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    slack_channel_id: str = Field(nullable=False)
    slack_thread_ts: Optional[str] = Field(default=None)
    request: str = Field(nullable=False)
    status: str = Field(default="pending")
    pm_spec: Optional[str] = Field(default=None)
    code: Optional[str] = Field(default=None)
    code_language: str = Field(default="python")
    test_result: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    final_output: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_runs_workspace_status", "workspace_id", "status"),
    )

class Schedule(SQLModel, table=True):
    __tablename__ = "schedules"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    slack_team_id: Optional[str] = Field(default=None)
    name: str = Field(nullable=False)
    cron_expr: str = Field(nullable=False)
    timezone: str = Field(default="UTC")
    action: str = Field(nullable=False)
    channel_id: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)
    last_triggered_at: Optional[datetime] = Field(default=None)
    last_run_status: Optional[str] = Field(default=None)
    consecutive_successes: int = Field(default=0)
    fail_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_schedules_team_active", "slack_team_id", "is_active"),
        Index("idx_schedules_workspace_id", "workspace_id"),
    )

class Skill(SQLModel, table=True):
    __tablename__ = "skills"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    name: str = Field(nullable=False)
    description: str = Field(nullable=False)
    category: str = Field(default="general")
    repo_url: Optional[str] = Field(default=None)
    file_path: Optional[str] = Field(default=None)
    entrypoint: str = Field(default="handler")
    source_code: str = Field(default="")
    dependencies: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_skills_workspace_id", "workspace_id"),
        Index("idx_skills_workspace_name", "workspace_id", "name", unique=True),
    )


class SkillUsage(SQLModel, table=True):
    __tablename__ = "skill_usage"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    skill_name: str = Field(nullable=False)
    slack_user_id: str = Field(nullable=False)
    slack_channel_id: str = Field(nullable=False)
    request: str = Field(nullable=False)
    outcome: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_skill_usage_workspace_id", "workspace_id"),
    )

class Task(SQLModel, table=True):
    __tablename__ = "tasks"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    slack_channel_id: str = Field(nullable=False)
    slack_thread_ts: Optional[str] = Field(default=None)
    type: str = Field(nullable=False)
    request: str = Field(nullable=False)
    status: str = Field(default="pending")
    result: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    output_filename: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_tasks_workspace_status", "workspace_id", "status"),
    )

class UsageLog(SQLModel, table=True):
    __tablename__ = "usage_logs"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: Optional[str] = Field(default=None)
    agent_name: str = Field(nullable=False)
    provider: str = Field(default="ollama", nullable=False)
    model: str = Field(nullable=False)
    prompt_tokens: int = Field(default=0)
    completion_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    duration_ms: Optional[int] = Field(default=None)
    success: bool = Field(default=True)
    error_message: Optional[str] = Field(default=None)
    run_id: Optional[uuid.UUID] = Field(default=None, sa_type=UUID(as_uuid=True))
    task_id: Optional[uuid.UUID] = Field(default=None, sa_type=UUID(as_uuid=True))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_usage_logs_workspace_created", "workspace_id", "created_at"),
    )

class Webhook(SQLModel, table=True):
    __tablename__ = "webhooks"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    name: str = Field(nullable=False)
    url: str = Field(nullable=False)
    method: str = Field(default="POST", nullable=False)
    headers_encrypted: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        Index("idx_webhooks_workspace_id", "workspace_id"),
    )

class WorkflowLearning(SQLModel, table=True):
    __tablename__ = "workflow_learnings"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True, sa_type=UUID(as_uuid=True))
    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", sa_type=UUID(as_uuid=True), nullable=False)
    slack_user_id: str = Field(nullable=False)
    message_ts: Optional[str] = Field(default=None)
    reaction: Optional[str] = Field(default=None)
    category: str = Field(default="general", nullable=False)
    trigger_prompt: str = Field(nullable=False)
    feedback: str = Field(nullable=False)
    correction: str = Field(nullable=False)
    rating: int = Field(default=1, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"server_default": text("now()")})

    __table_args__ = (
        UniqueConstraint("workspace_id", "slack_user_id", "message_ts", "reaction", name="unique_workflow_learning"),
    )
