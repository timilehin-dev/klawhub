-- Phase C: Qdrant FastEmbed Vector Search & HNSW Indexing
-- Enables pgvector extension, creates high-speed HNSW indexes for cosine distance matches,
-- and configures row-level security (RLS) for absolute tenant workspace isolation.

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding columns (type vector(384) for fast BGE-small-en model) if not exists
ALTER TABLE "memory" ADD COLUMN IF NOT EXISTS "embedding" vector(384);
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "embedding" vector(384);

-- 3. Create high-speed HNSW (Hierarchical Navigable Small World) distance indexes for cosine search
-- Use vector_cosine_ops for cosine similarity search (using the <=> operator)
CREATE INDEX IF NOT EXISTS idx_memory_embedding_hnsw ON "memory" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_hnsw ON "knowledge" USING hnsw (embedding vector_cosine_ops);

-- 4. Enable Row Level Security (RLS) for tenant isolation
ALTER TABLE "memory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge" ENABLE ROW LEVEL SECURITY;

-- 5. Establish Workspace Row-Level Security Policies to guarantee tenant data separation
-- Ensuring a tenant workspace can never read or leak rows belonging to other workspaces.
DROP POLICY IF EXISTS "Tenant Workspace Isolation" ON "memory";
CREATE POLICY "Tenant Workspace Isolation" ON "memory"
  FOR ALL
  USING (
    "workspace_id" IS NULL OR 
    "workspace_id" IN (
      SELECT "workspace_id" FROM "workspace_members" 
      WHERE "slack_user_id" = current_setting('request.jwt.claim.slack_user_id', true) AND "workspace_id" = current_setting('request.jwt.claim.workspace_id', true)
    )
  );

DROP POLICY IF EXISTS "Tenant Workspace Isolation" ON "knowledge";
CREATE POLICY "Tenant Workspace Isolation" ON "knowledge"
  FOR ALL
  USING (
    "workspace_id" IS NULL OR 
    "workspace_id" IN (
      SELECT "workspace_id" FROM "workspace_members" 
      WHERE "slack_user_id" = current_setting('request.jwt.claim.slack_user_id', true) AND "workspace_id" = current_setting('request.jwt.claim.workspace_id', true)
    )
  );
