import { pgTable, uuid, text, timestamp, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import type { Intent } from "@/types";

// ── Runs: tracks app/script build requests ──

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});

// ── Tasks: tracks document, research, analytics requests ──

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});

// ── Memory: per-user persistent context ──

export const memory = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  content: text("content").notNull(),
  category: text("category").default("general"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

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
  outcome: text("outcome").$type<"success" | "error">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Schedules: user-created and system-level scheduled tasks ──

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),       // "system" for system-level schedules
  name: text("name").notNull(),
  cronExpr: text("cron_expr").notNull(),              // standard 5-field cron: "0 9 * * 1-5"
  timezone: text("timezone").default("UTC"),
  action: text("action").notNull(),                    // the prompt/task to execute
  channelId: text("channel_id"),                      // where to post results
  isActive: boolean("is_active").default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  lastRunStatus: text("last_run_status").$type<"success" | "error" | "skipped">(),
  consecutiveSuccesses: integer("consecutive_successes").default(0),
  failCount: integer("fail_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Knowledge: structured entity memory (projects, people, events) ──

export const knowledge = pgTable("knowledge", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  entityType: text("entity_type").notNull().$type<"project" | "person" | "event" | "standing_item">(),
  entityName: text("entity_name").notNull(),
  data: jsonb("data").notNull().default({}),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Workspaces: one per Slack workspace that installs Klawhub ──

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackTeamId: text("slack_team_id").notNull().unique(),   // Slack workspace/team ID
  slackBotUserId: text("slack_bot_user_id").notNull(),      // The bot's user ID in this workspace
  name: text("name").notNull(),                              // Workspace name from Slack
  domain: text("domain"),                                    // workspace slug (e.g. "acme-corp")
  plan: text("plan").$type<"free" | "pro" | "enterprise">().default("free").notNull(),
  monthlyRunLimit: integer("monthly_run_limit").default(50).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  isActive: boolean("is_active").default(true).notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Workspace Members: Slack users who have used Klawhub in a workspace ──

export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  slackUserName: text("slack_user_name"),                   // display name
  slackUserEmail: text("slack_user_email"),                 // email (if available)
  isWorkspaceAdmin: boolean("is_workspace_admin").default(false).notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Integrations: OAuth connections to external services ──

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().$type<"google_drive" | "github">(),
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
  errorCount: text("error_count").default("0").notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Intent list for classifier ──
export const INTENTS: Intent[] = ["build", "document", "research", "analytics", "chat", "unclear"];

// ── Usage Logs: track every LLM call for observability + billing ──

export const usageLogs = pgTable("usage_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});
