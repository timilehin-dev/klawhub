-- ==========================================
-- IMPLEMENT RLS WITH CUSTOM SESSION VARIABLES
-- ==========================================
-- This migration enables proper Row Level Security (RLS) using custom session variables.
-- The app.current_workspace_id session variable is set by the application to enforce
-- multi-tenant data isolation at the database level.

-- 1. Create a function to set the workspace ID session variable
-- This will be called by the application when establishing a database connection
CREATE OR REPLACE FUNCTION set_workspace_id(workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Set the custom session variable for RLS policies
    PERFORM set_config('app.current_workspace_id', workspace_id::TEXT, true);
END;
$$;

-- 2. Create a helper function to get the current workspace ID from session
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    ws_id TEXT;
BEGIN
    ws_id := current_setting('app.current_workspace_id', true);
    IF ws_id IS NULL OR ws_id = '' THEN
        RETURN NULL;
    END IF;
    RETURN ws_id::UUID;
END;
$$;

-- 2b. Create a helper function to check if the current session is a "system" session
-- that intentionally bypasses RLS. This is set by get_db_session(bypass_rls=True) in
-- the Python codebase for cron jobs, workspace bootstrap, and other cross-tenant queries.
-- Policies that include is_system_session() will permit the operation even if
-- current_workspace_id() does not match the row.
CREATE OR REPLACE FUNCTION is_system_session()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.bypass_rls', true), ''),
        'false'
    )::BOOLEAN;
$$;

-- 3. Create RLS policies for workspaces table
-- Allow reading only own workspace
DROP POLICY IF EXISTS "RLS: workspaces select" ON "workspaces";
CREATE POLICY "RLS: workspaces select" ON "workspaces"
FOR SELECT
USING (id = current_workspace_id() OR is_system_session());

-- 4. Create RLS policies for other core tables
-- AgentStates: Only see states for your workspace
DROP POLICY IF EXISTS "RLS: agent_states select" ON "agent_states";
CREATE POLICY "RLS: agent_states select" ON "agent_states"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: agent_states insert" ON "agent_states";
CREATE POLICY "RLS: agent_states insert" ON "agent_states"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: agent_states update" ON "agent_states";
CREATE POLICY "RLS: agent_states update" ON "agent_states"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: agent_states delete" ON "agent_states";
CREATE POLICY "RLS: agent_states delete" ON "agent_states"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 5. Skills table policies
DROP POLICY IF EXISTS "RLS: skills select" ON "skills";
CREATE POLICY "RLS: skills select" ON "skills"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: skills insert" ON "skills";
CREATE POLICY "RLS: skills insert" ON "skills"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: skills update" ON "skills";
CREATE POLICY "RLS: skills update" ON "skills"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: skills delete" ON "skills";
CREATE POLICY "RLS: skills delete" ON "skills"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 6. Schedules table policies
DROP POLICY IF EXISTS "RLS: schedules select" ON "schedules";
CREATE POLICY "RLS: schedules select" ON "schedules"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: schedules insert" ON "schedules";
CREATE POLICY "RLS: schedules insert" ON "schedules"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: schedules update" ON "schedules";
CREATE POLICY "RLS: schedules update" ON "schedules"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: schedules delete" ON "schedules";
CREATE POLICY "RLS: schedules delete" ON "schedules"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 7. Integrations table policies
DROP POLICY IF EXISTS "RLS: integrations select" ON "integrations";
CREATE POLICY "RLS: integrations select" ON "integrations"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: integrations insert" ON "integrations";
CREATE POLICY "RLS: integrations insert" ON "integrations"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: integrations update" ON "integrations";
CREATE POLICY "RLS: integrations update" ON "integrations"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: integrations delete" ON "integrations";
CREATE POLICY "RLS: integrations delete" ON "integrations"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 8. Webhooks table policies
DROP POLICY IF EXISTS "RLS: webhooks select" ON "webhooks";
CREATE POLICY "RLS: webhooks select" ON "webhooks"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: webhooks insert" ON "webhooks";
CREATE POLICY "RLS: webhooks insert" ON "webhooks"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: webhooks update" ON "webhooks";
CREATE POLICY "RLS: webhooks update" ON "webhooks"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: webhooks delete" ON "webhooks";
CREATE POLICY "RLS: webhooks delete" ON "webhooks"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 9. Tasks table policies
DROP POLICY IF EXISTS "RLS: tasks select" ON "tasks";
CREATE POLICY "RLS: tasks select" ON "tasks"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: tasks insert" ON "tasks";
CREATE POLICY "RLS: tasks insert" ON "tasks"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: tasks update" ON "tasks";
CREATE POLICY "RLS: tasks update" ON "tasks"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: tasks delete" ON "tasks";
CREATE POLICY "RLS: tasks delete" ON "tasks"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 10. Memory table policies
DROP POLICY IF EXISTS "RLS: memory select" ON "memory";
CREATE POLICY "RLS: memory select" ON "memory"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: memory insert" ON "memory";
CREATE POLICY "RLS: memory insert" ON "memory"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: memory update" ON "memory";
CREATE POLICY "RLS: memory update" ON "memory"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: memory delete" ON "memory";
CREATE POLICY "RLS: memory delete" ON "memory"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 11. Knowledge table policies
DROP POLICY IF EXISTS "RLS: knowledge select" ON "knowledge";
CREATE POLICY "RLS: knowledge select" ON "knowledge"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: knowledge insert" ON "knowledge";
CREATE POLICY "RLS: knowledge insert" ON "knowledge"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: knowledge update" ON "knowledge";
CREATE POLICY "RLS: knowledge update" ON "knowledge"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: knowledge delete" ON "knowledge";
CREATE POLICY "RLS: knowledge delete" ON "knowledge"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 12. Runs table policies
DROP POLICY IF EXISTS "RLS: runs select" ON "runs";
CREATE POLICY "RLS: runs select" ON "runs"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: runs insert" ON "runs";
CREATE POLICY "RLS: runs insert" ON "runs"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: runs update" ON "runs";
CREATE POLICY "RLS: runs update" ON "runs"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: runs delete" ON "runs";
CREATE POLICY "RLS: runs delete" ON "runs"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 13. UsageLogs table policies
DROP POLICY IF EXISTS "RLS: usage_logs select" ON "usage_logs";
CREATE POLICY "RLS: usage_logs select" ON "usage_logs"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: usage_logs insert" ON "usage_logs";
CREATE POLICY "RLS: usage_logs insert" ON "usage_logs"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: usage_logs update" ON "usage_logs";
CREATE POLICY "RLS: usage_logs update" ON "usage_logs"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: usage_logs delete" ON "usage_logs";
CREATE POLICY "RLS: usage_logs delete" ON "usage_logs"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 14. WorkspaceMembers table policies (special case - join table)
DROP POLICY IF EXISTS "RLS: workspace_members select" ON "workspace_members";
CREATE POLICY "RLS: workspace_members select" ON "workspace_members"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: workspace_members insert" ON "workspace_members";
CREATE POLICY "RLS: workspace_members insert" ON "workspace_members"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: workspace_members update" ON "workspace_members";
CREATE POLICY "RLS: workspace_members update" ON "workspace_members"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: workspace_members delete" ON "workspace_members";
CREATE POLICY "RLS: workspace_members delete" ON "workspace_members"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 15. ProcessedEvents table policies
DROP POLICY IF EXISTS "RLS: processed_events select" ON "processed_events";
CREATE POLICY "RLS: processed_events select" ON "processed_events"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: processed_events insert" ON "processed_events";
CREATE POLICY "RLS: processed_events insert" ON "processed_events"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: processed_events update" ON "processed_events";
CREATE POLICY "RLS: processed_events update" ON "processed_events"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: processed_events delete" ON "processed_events";
CREATE POLICY "RLS: processed_events delete" ON "processed_events"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 16. SkillUsage table policies
DROP POLICY IF EXISTS "RLS: skill_usage select" ON "skill_usage";
CREATE POLICY "RLS: skill_usage select" ON "skill_usage"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: skill_usage insert" ON "skill_usage";
CREATE POLICY "RLS: skill_usage insert" ON "skill_usage"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: skill_usage update" ON "skill_usage";
CREATE POLICY "RLS: skill_usage update" ON "skill_usage"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: skill_usage delete" ON "skill_usage";
CREATE POLICY "RLS: skill_usage delete" ON "skill_usage"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 17. WorkflowLearnings table policies
DROP POLICY IF EXISTS "RLS: workflow_learnings select" ON "workflow_learnings";
CREATE POLICY "RLS: workflow_learnings select" ON "workflow_learnings"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: workflow_learnings insert" ON "workflow_learnings";
CREATE POLICY "RLS: workflow_learnings insert" ON "workflow_learnings"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: workflow_learnings update" ON "workflow_learnings";
CREATE POLICY "RLS: workflow_learnings update" ON "workflow_learnings"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: workflow_learnings delete" ON "workflow_learnings";
CREATE POLICY "RLS: workflow_learnings delete" ON "workflow_learnings"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 18. EngineerLearnings table policies
DROP POLICY IF EXISTS "RLS: engineer_learnings select" ON "engineer_learnings";
CREATE POLICY "RLS: engineer_learnings select" ON "engineer_learnings"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: engineer_learnings insert" ON "engineer_learnings";
CREATE POLICY "RLS: engineer_learnings insert" ON "engineer_learnings"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: engineer_learnings update" ON "engineer_learnings";
CREATE POLICY "RLS: engineer_learnings update" ON "engineer_learnings"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: engineer_learnings delete" ON "engineer_learnings";
CREATE POLICY "RLS: engineer_learnings delete" ON "engineer_learnings"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 19. PendingActions table policies
DROP POLICY IF EXISTS "RLS: pending_actions select" ON "pending_actions";
CREATE POLICY "RLS: pending_actions select" ON "pending_actions"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: pending_actions insert" ON "pending_actions";
CREATE POLICY "RLS: pending_actions insert" ON "pending_actions"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: pending_actions update" ON "pending_actions";
CREATE POLICY "RLS: pending_actions update" ON "pending_actions"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: pending_actions delete" ON "pending_actions";
CREATE POLICY "RLS: pending_actions delete" ON "pending_actions"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 20. DocumentChunks table policies
DROP POLICY IF EXISTS "RLS: document_chunks select" ON "document_chunks";
CREATE POLICY "RLS: document_chunks select" ON "document_chunks"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: document_chunks insert" ON "document_chunks";
CREATE POLICY "RLS: document_chunks insert" ON "document_chunks"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: document_chunks update" ON "document_chunks";
CREATE POLICY "RLS: document_chunks update" ON "document_chunks"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: document_chunks delete" ON "document_chunks";
CREATE POLICY "RLS: document_chunks delete" ON "document_chunks"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- 21. MCPServers table policies
DROP POLICY IF EXISTS "RLS: mcp_servers select" ON "mcp_servers";
CREATE POLICY "RLS: mcp_servers select" ON "mcp_servers"
FOR SELECT
USING (workspace_id = current_workspace_id() OR is_system_session() OR workspace_id IS NULL);

DROP POLICY IF EXISTS "RLS: mcp_servers insert" ON "mcp_servers";
CREATE POLICY "RLS: mcp_servers insert" ON "mcp_servers"
FOR INSERT
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: mcp_servers update" ON "mcp_servers";
CREATE POLICY "RLS: mcp_servers update" ON "mcp_servers"
FOR UPDATE
USING (workspace_id = current_workspace_id() OR is_system_session())
WITH CHECK (workspace_id = current_workspace_id() OR is_system_session());

DROP POLICY IF EXISTS "RLS: mcp_servers delete" ON "mcp_servers";
CREATE POLICY "RLS: mcp_servers delete" ON "mcp_servers"
FOR DELETE
USING (workspace_id = current_workspace_id() OR is_system_session());

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE 'RLS with custom session variables migration completed successfully.';
    RAISE NOTICE 'Note: bypass_rls flag is set by get_db_session(bypass_rls=True) for system-level queries.';
END;
$$;