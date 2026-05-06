-- Phase D: Webhooks Configuration Table
-- Creates the webhooks table to support custom HTTP endpoints with encrypted secrets.

CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "headers_encrypted" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for speedy workspace-level lookups
CREATE INDEX IF NOT EXISTS idx_webhooks_workspace_id ON "webhooks"("workspace_id");
-- Index for speedy name-level lookups inside a workspace
CREATE INDEX IF NOT EXISTS idx_webhooks_workspace_name ON "webhooks"("workspace_id", "name");
