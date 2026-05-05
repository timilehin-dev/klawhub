/**
 * DB-backed event deduplication.
 *
 * Replaces the in-memory Set which dies on Vercel serverless cold starts.
 * Uses INSERT ... ON CONFLICT DO NOTHING for atomic, race-condition-free dedup.
 * Old events are cleaned up probabilistically on each call (~1% chance).
 */

import { getDb } from "@/db";
import { processedEvents } from "@/db/schema";
import { sql } from "drizzle-orm";

const DEDUP_WINDOW_SECONDS = 600; // 10 minutes — covers Slack's full retry window

/**
 * Try to "claim" an event for processing.
 * Returns true if this is a NEW event (caller should process it).
 * Returns false if it was already claimed (caller should skip it).
 *
 * Uses ON CONFLICT DO NOTHING — no race conditions, no deadlocks.
 */
export async function claimEvent(eventId: string): Promise<boolean> {
  try {
    const result = await getDb()
      .insert(processedEvents)
      .values({ eventId })
      .onConflictDoNothing()
      .returning({ id: processedEvents.eventId });

    return result.length > 0;
  } catch (err) {
    // Fail-open: if DB is down, allow processing (Slack will dedup via event_id retry)
    console.error("[DEDUP] DB error (fail-open):", err instanceof Error ? err.message : err);
    return true;
  }
}

/**
 * Delete processed events older than the dedup window.
 * Called probabilistically (~1% of events) to keep the table lean.
 */
export async function cleanupOldEvents(): Promise<void> {
  try {
    await getDb()
      .delete(processedEvents)
      .where(
        sql`${processedEvents.createdAt} < now() - interval '${sql.raw(String(DEDUP_WINDOW_SECONDS))} seconds'`
      );
  } catch {
    // Non-critical
  }
}
