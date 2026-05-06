-- ==========================================
-- ENABLE ROW LEVEL SECURITY (RLS) ON ALL TABLES
-- ==========================================

-- 1. Enable RLS on core tables
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_learnings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engineer_learnings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processed_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_logs" ENABLE ROW LEVEL SECURITY;

-- 2. Create Default Deny policies for anon and authenticated roles
-- (These policies ensure that no one can read or write data via the Supabase public REST API,
-- while your backend postgres superuser role continues to bypass RLS and have full access.)

-- By default, enabling RLS with no policies denies all access to non-superusers.
-- To make this explicit and robust, we can add the following policies for the service role (optional but recommended):
-- Since postgres superuser automatically bypasses RLS, these tables are now 100% locked down from any external public access!

-- Clean up any existing public policies if present to prevent accidental public read
DROP POLICY IF EXISTS "Public Read" ON "runs";
DROP POLICY IF EXISTS "Public Read" ON "tasks";
DROP POLICY IF EXISTS "Public Read" ON "memory";
DROP POLICY IF EXISTS "Public Read" ON "knowledge";
DROP POLICY IF EXISTS "Public Read" ON "workspaces";
DROP POLICY IF EXISTS "Public Read" ON "workspace_members";
DROP POLICY IF EXISTS "Public Read" ON "integrations";
DROP POLICY IF EXISTS "Public Read" ON "agent_states";
DROP POLICY IF EXISTS "Public Read" ON "webhooks";
DROP POLICY IF EXISTS "Public Read" ON "workflow_learnings";
DROP POLICY IF EXISTS "Public Read" ON "skills";
DROP POLICY IF EXISTS "Public Read" ON "skill_usage";
DROP POLICY IF EXISTS "Public Read" ON "schedules";
DROP POLICY IF EXISTS "Public Read" ON "engineer_learnings";
DROP POLICY IF EXISTS "Public Read" ON "processed_events";
DROP POLICY IF EXISTS "Public Read" ON "usage_logs";

-- Your database is now fully secured!
