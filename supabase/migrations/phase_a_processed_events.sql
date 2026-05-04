-- Phase A: DB-backed event dedup
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- This table survives Vercel serverless cold starts (unlike in-memory Sets)

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient cleanup of old events
CREATE INDEX IF NOT EXISTS idx_processed_events_created_at
ON processed_events (created_at);

-- Note: Old events are cleaned up automatically by the app (~1% chance per event).
-- Manual cleanup if needed:
-- DELETE FROM processed_events WHERE created_at < NOW() - INTERVAL '10 minutes';
