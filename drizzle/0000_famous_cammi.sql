CREATE TABLE "agent_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"agent_name" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_states_workspace_id_agent_name_unique" UNIQUE("workspace_id","agent_name")
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(384),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "engineer_learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" text NOT NULL,
	"domain" text NOT NULL,
	"task_type" text NOT NULL,
	"mistake" text NOT NULL,
	"correction" text NOT NULL,
	"verdict" text NOT NULL,
	"spec_snippet" text,
	"code_snippet" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"external_account_id" text,
	"external_account_name" text,
	"external_account_email" text,
	"last_used_at" timestamp with time zone,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "unique_workspace_provider" UNIQUE("workspace_id","provider")
);
--> statement-breakpoint
CREATE TABLE "knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slack_user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_name" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text,
	"embedding" vector(384),
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"auth_config" jsonb,
	"tools_schema" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slack_user_id" text NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'general',
	"embedding" vector(384),
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slack_user_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_thread_ts" text,
	"request" text NOT NULL,
	"status" text DEFAULT 'pending',
	"pm_spec" text,
	"code" text,
	"code_language" text DEFAULT 'python',
	"test_result" jsonb,
	"final_output" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slack_user_id" text NOT NULL,
	"slack_team_id" text,
	"name" text NOT NULL,
	"cron_expr" text NOT NULL,
	"timezone" text DEFAULT 'UTC',
	"action" text NOT NULL,
	"channel_id" text,
	"is_active" boolean DEFAULT true,
	"last_triggered_at" timestamp with time zone,
	"last_run_status" text,
	"consecutive_successes" integer DEFAULT 0,
	"fail_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skill_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_name" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"request" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'general',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slack_user_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_thread_ts" text,
	"type" text NOT NULL,
	"request" text NOT NULL,
	"status" text DEFAULT 'pending',
	"result" jsonb,
	"output_filename" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slack_user_id" text,
	"agent_name" text NOT NULL,
	"provider" text DEFAULT 'ollama' NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0,
	"completion_tokens" integer DEFAULT 0,
	"total_tokens" integer DEFAULT 0,
	"duration_ms" integer,
	"success" boolean DEFAULT true,
	"error_message" text,
	"run_id" uuid,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"method" text DEFAULT 'POST' NOT NULL,
	"headers_encrypted" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slack_user_id" text NOT NULL,
	"message_ts" text,
	"reaction" text,
	"category" text DEFAULT 'general' NOT NULL,
	"trigger_prompt" text NOT NULL,
	"feedback" text NOT NULL,
	"correction" text NOT NULL,
	"rating" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "unique_workflow_learning" UNIQUE("workspace_id","slack_user_id","message_ts","reaction")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_user_name" text,
	"slack_user_email" text,
	"is_workspace_admin" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_bot_user_id" text NOT NULL,
	"bot_token" text,
	"name" text NOT NULL,
	"domain" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"monthly_run_limit" integer DEFAULT 50 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"agent_name" text DEFAULT 'Klawhub' NOT NULL,
	"agent_personality" text,
	"enabled_skills" jsonb DEFAULT '["web_search","puppeteer_scraping","python_sandbox","pdf_generator"]'::jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now(),
	"last_heartbeat_briefing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "workspaces_slack_team_id_unique" UNIQUE("slack_team_id")
);
--> statement-breakpoint
ALTER TABLE "agent_states" ADD CONSTRAINT "agent_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_learnings" ADD CONSTRAINT "workflow_learnings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chunks_workspace_source" ON "document_chunks" USING btree ("workspace_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_integrations_workspace_provider" ON "integrations" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "idx_memory_workspace_user" ON "memory" USING btree ("workspace_id","slack_user_id");--> statement-breakpoint
CREATE INDEX "idx_processed_events_created" ON "processed_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_runs_workspace_status" ON "runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_schedules_team_active" ON "schedules" USING btree ("slack_team_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_tasks_workspace_status" ON "tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_usage_logs_workspace_created" ON "usage_logs" USING btree ("workspace_id","created_at");