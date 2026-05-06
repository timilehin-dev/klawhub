import { getDb } from "./connection";
import { webhooks } from "./schema";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "@/integrations/crypto";

export interface StoredWebhook {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  method: string;
  headersEncrypted: string | null;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Register or update a custom webhook for a workspace.
 * Sensitive headers are encrypted under AES-256-GCM.
 */
export async function saveWebhook(params: {
  workspaceId: string;
  name: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const db = getDb();
  const headersEncrypted = params.headers ? encrypt(JSON.stringify(params.headers)) : null;

  // Check if a webhook with the same name already exists in this workspace
  const existing = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, params.workspaceId), eq(webhooks.name, params.name)))
    .limit(1);

  if (existing.length > 0) {
    // Update existing webhook config
    await db
      .update(webhooks)
      .set({
        url: params.url,
        method: params.method,
        headersEncrypted,
        updatedAt: new Date(),
      })
      .where(eq(webhooks.id, existing[0].id));
  } else {
    // Insert new webhook config
    await db.insert(webhooks).values({
      workspaceId: params.workspaceId,
      name: params.name,
      url: params.url,
      method: params.method,
      headersEncrypted,
    });
  }
}

/**
 * List all active custom webhooks for a workspace.
 */
export async function getWebhooks(workspaceId: string): Promise<StoredWebhook[]> {
  return getDb().select().from(webhooks).where(eq(webhooks.workspaceId, workspaceId));
}

/**
 * Fetch a single custom webhook config by its workspace-unique name.
 */
export async function getWebhookByName(workspaceId: string, name: string): Promise<StoredWebhook | null> {
  const list = await getDb()
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.name, name)))
    .limit(1);
  return list[0] || null;
}

/**
 * Decrypts encrypted stored custom headers JSON string back into key-value records.
 */
export function decryptWebhookHeaders(headersEncrypted: string | null): Record<string, string> {
  if (!headersEncrypted) return {};
  try {
    const decrypted = decrypt(headersEncrypted);
    return JSON.parse(decrypted);
  } catch (err) {
    console.error("[CRYPTO] Webhook headers decryption failed:", err);
    return {};
  }
}
