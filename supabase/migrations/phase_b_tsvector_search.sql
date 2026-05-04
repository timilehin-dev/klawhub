-- Phase B: Full-text search with tsvector
-- Adds search_vector columns to memory and knowledge tables,
-- GIN indexes for fast search, and auto-update triggers.

-- Memory table: add tsvector column + GIN index
ALTER TABLE memory ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_memory_search ON memory USING GIN (search_vector);

-- Backfill existing rows
UPDATE memory SET search_vector = to_tsvector('english', content) WHERE search_vector IS NULL;

-- Knowledge table: add tsvector column + GIN index + workspace_id
ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_knowledge_search ON knowledge USING GIN (search_vector);
ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- Backfill existing rows
UPDATE knowledge SET search_vector = to_tsvector('english', entity_name || ' ' || entity_type || ' ' || COALESCE(source::text, '')) WHERE search_vector IS NULL;

-- Auto-update trigger: memory
CREATE OR REPLACE FUNCTION memory_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memory_search_vector ON memory;
CREATE TRIGGER trg_memory_search_vector
  BEFORE INSERT OR UPDATE OF content ON memory
  FOR EACH ROW EXECUTE FUNCTION memory_search_vector_update();

-- Auto-update trigger: knowledge
CREATE OR REPLACE FUNCTION knowledge_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', NEW.entity_name || ' ' || NEW.entity_type || ' ' || COALESCE(NEW.source::text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_search_vector ON knowledge;
CREATE TRIGGER trg_knowledge_search_vector
  BEFORE INSERT OR UPDATE OF entity_name, entity_type, source ON knowledge
  FOR EACH ROW EXECUTE FUNCTION knowledge_search_vector_update();
