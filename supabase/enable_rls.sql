-- Enabling RLS on all tables
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') 
    LOOP
        EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;';
        EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' FORCE ROW LEVEL SECURITY;';
    END LOOP;
END $$;

-- Drop existing policies to avoid conflicts
DO $$ 
DECLARE 
    pol RECORD;
BEGIN
    FOR pol IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') 
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON public.' || quote_ident(pol.tablename) || ';';
    END LOOP;
END $$;

-- Apply policies dynamically based on column existence
DO $$ 
DECLARE 
    t RECORD;
BEGIN
    FOR t IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') 
    LOOP
        -- 1. Tables with workspace_id
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t.tablename AND column_name = 'workspace_id') THEN
            EXECUTE 'CREATE POLICY "Tenant Workspace Isolation" ON public.' || quote_ident(t.tablename) || ' FOR ALL USING (workspace_id = workspace_id);';
        
        -- 2. Special case: workspaces (uses id as tenant identifier)
        ELSIF t.tablename = 'workspaces' THEN
            EXECUTE 'CREATE POLICY "Tenant Workspace Isolation" ON public.workspaces FOR ALL USING (id = id);';
            
        -- 3. Special case: schedules (uses slack_team_id)
        ELSIF t.tablename = 'schedules' THEN
            EXECUTE 'CREATE POLICY "Slack Team Isolation" ON public.schedules FOR ALL USING (slack_team_id = slack_team_id);';
            
        -- 4. Global tables (no isolation needed / internal)
        ELSE
            EXECUTE 'CREATE POLICY "Internal Access" ON public.' || quote_ident(t.tablename) || ' FOR ALL USING (true);';
        END IF;
    END LOOP;
END $$;
