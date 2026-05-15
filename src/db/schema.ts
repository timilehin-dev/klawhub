import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, customType, unique, index } from "drizzle-orm/pg-core";
import type { Intent } from "@/types";

// ── Custom pgvector Column Type ──

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(384)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/[\[\]]/g, "")
      .split(",")
      .map((v) => parseFloat(v));
  },
});

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ── Workspaces: one per Slack workspace that installs Klawhub ──

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackTeamId: text("slack_team_id").notNull().unique(),
  slackBotUserId: text("slack_bot_user_id").notNull(),
  botToken: text("bot_token"),
  name: text("name").notNull(),
  domain: text("domain"),
  plan: text("plan").$type<"free" | "pro" | "enterprise">().default("free").notNull(),
  monthlyRunLimit: integer("monthly_run_limit").default(50).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  isActive: boolean("is_active").default(true).notNull(),
  agentName: text("agent_name").default("Klawhub").notNull(),
  agentPersonality: text("agent_personality"),
  enabledSkills: jsonb("enabled_skills").$type<string[]>().default(["web_search", "puppeteer_scraping", "python_sandbox", "pdf_generator"]).notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Runs: tracks app/script build requests ──

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  slackThreadTs: text("slack_thread_ts"),
  request: text("request").notNull(),
  status: text("status")
    .$type<"pending" | "pm" | "pending_approval" | "coding" | "qa" | "done" | "error">()
    .default("pending"),
  pmSpec: text("pm_spec"),
  code: text("code"),
  codeLanguage: text("code_language").default("python"),
  testResult: jsonb("test_result").$type<{ passed: boolean; output?: string; error?: string }>(),
  finalOutput: text("final_output"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_runs_workspace_status").on(t.workspaceId, t.status),
]);

// ── Tasks: tracks document, research, analytics requests ──

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  slackThreadTs: text("slack_thread_ts"),
  type: text("type").$type<"document" | "research" | "analytics">().notNull(),
  request: text("request").notNull(),
  status: text("status")
    .$type<"pending" | "pending_approval" | "processing" | "done" | "error">()
    .default("pending"),
  result: jsonb("result"),
  outputFilename: text("output_filename"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_tasks_workspace_status").on(t.workspaceId, t.status),
]);

// ── Memory: per-user persistent context ──

export const memory = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  content: text("content").notNull(),
  category: text("category").default("general"),
  embedding: vector("embedding"),
  searchVector: tsvector("search_vector"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_memory_workspace_user").on(t.workspaceId, t.slackUserId),
]);

// ── Skills: registry of coworker capabilities ──

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  category: text("category").default("general"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Skill Usage: tracks skill invocations for learning ──

export const skillUsage = pgTable("skill_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  skillName: text("skill_name").notNull(),
  slackUserId: text("slack_user_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  request: text("request").notNull(),
  outcome: text("outcome").$type<"success" | "error" | "attempted">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Schedules: user-created and system-level scheduled tasks ──

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  slackTeamId: text("slack_team_id"),
  name: text("name").notNull(),
  cronExpr: text("cron_expr").notNull(),
  timezone: text("timezone").default("UTC"),
  action: text("action").notNull(),
  channelId: text("channel_id"),
  isActive: boolean("is_active").default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  lastRunStatus: text("last_run_status").$type<"success" | "error" | "skipped">(),
  consecutiveSuccesses: integer("consecutive_successes").default(0),
  failCount: integer("fail_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_schedules_team_active").on(t.slackTeamId, t.isActive),
]);

// ── Knowledge: structured entity memory (projects, people, events) ──

export const knowledge = pgTable("knowledge", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  entityType: text("entity_type").notNull().$type<"project" | "person" | "event" | "standing_item" | "technology" | "preference" | "relationship">(),
  entityName: text("entity_name").notNull(),
  data: jsonb("data").notNull().default({}),
  source: text("source"),
  embedding: vector("embedding"),
  searchVector: tsvector("search_vector"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Document Chunks: granular memory for RAG ──

export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  sourceType: text("source_type").$type<"gdrive" | "slack" | "github" | "upload">().notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_chunks_workspace_source").on(t.workspaceId, t.sourceId),
]);

// ── Workspace Members: Slack users who have used Klawhub in a workspace ──

export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  slackUserName: text("slack_user_name"),
  slackUserEmail: text("slack_user_email"),
  isWorkspaceAdmin: boolean("is_workspace_admin").default(false).notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Integrations: OAuth connections to external services ──

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().$type<"google_drive" | "github" | "google">(),
  status: text("status").$type<"active" | "expired" | "error" | "disconnected">().default("active").notNull(),
  accessToken: text("access_token_encrypted").notNull(),
  refreshToken: text("refresh_token_encrypted"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scope: text("scope"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  externalAccountId: text("external_account_id"),
  externalAccountName: text("external_account_name"),
  externalAccountEmail: text("external_account_email"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  errorCount: integer("error_count").default(0).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_integrations_workspace_provider").on(t.workspaceId, t.provider),
]);

// ── Webhooks: custom integration targets ──

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  method: text("method").default("POST").notNull(),
  headersEncrypted: text("headers_encrypted"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Engineer Learnings: stores QA feedback and corrections for continuous improvement ──

export const engineerLearnings = pgTable("engineer_learnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  language: text("language").notNull(),
  domain: text("domain").notNull(),
  taskType: text("task_type").notNull(),
  mistake: text("mistake").notNull(),
  correction: text("correction").notNull(),
  verdict: text("verdict").$type<"pass" | "fail">().notNull(),
  specSnippet: text("spec_snippet"),
  codeSnippet: text("code_snippet"),
  runId: uuid("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Processed Events: DB-backed dedup ──

export const processedEvents = pgTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_processed_events_created").on(t.createdAt),
]);

// ── Agent States: persistent state for A2A coordination ──

export const agentStates = pgTable("agent_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull().$type<"general" | "pm" | "researcher" | "engineer" | "qa" | "analyst">(),
  state: jsonb("state").notNull().default({}),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  unique("agent_states_workspace_id_agent_name_unique").on(t.workspaceId, t.agentName),
]);

// ── Usage Logs: track every LLM call for observability + billing ──

export const usageLogs = pgTable("usage_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id"),
  agentName: text("agent_name").notNull(),
  provider: text("provider").notNull().default("ollama"),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").default(0),
  completionTokens: integer("completion_tokens").default(0),
  totalTokens: integer("total_tokens").default(0),
  durationMs: integer("duration_ms"),
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  runId: uuid("run_id"),
  taskId: uuid("task_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_usage_logs_workspace_created").on(t.workspaceId, t.createdAt),
]);

// ── Workflow Learnings ──

export const workflowLearnings = pgTable("workflow_learnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  category: text("category").default("general").notNull(),
  triggerPrompt: text("trigger_prompt").notNull(),
  feedback: text("feedback").notNull(),
  correction: text("correction").notNull(),
  rating: integer("rating").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Pending Actions: stores tool calls that require human approval (HITL) ──

export const pendingActions = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  toolName: text("tool_name").notNull(),
  params: jsonb("params").notNull(),
  status: text("status").$type<"pending" | "approved" | "rejected">().default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── MCP Servers: dynamically attached external tool providers ──
export const mcpServers = pgTable("mcp_servers", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  status: text("status").$type<"active" | "error" | "disabled">().default("active").notNull(),
  authConfig: jsonb("auth_config"), // optional API keys or headers for the MCP server
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const INTENTS: Intent[] = ["build", "document", "research", "analytics", "chat", "unclear"];
