import { getDb } from "../db/connection";
import { integrations } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { encrypt, decrypt } from "./crypto";
import type { OAuthProviderConfig } from "./providers/registry";

// ── CRUD ──

export interface CreateIntegrationInput {
  workspaceId: string;
  provider: "google_drive" | "github";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  externalAccountId?: string;
  externalAccountName?: string;
  externalAccountEmail?: string;
}

export async function createIntegration(input: CreateIntegrationInput) {
  const [created] = await getDb()
    .insert(integrations)
    .values({
      workspaceId: input.workspaceId,
      provider: input.provider,
      accessToken: encrypt(input.accessToken),
      refreshToken: input.refreshToken ? encrypt(input.refreshToken) : null,
      expiresAt: input.expiresAt || null,
      scope: input.scope || null,
      externalAccountId: input.externalAccountId || null,
      externalAccountName: input.externalAccountName || null,
      externalAccountEmail: input.externalAccountEmail || null,
      status: "active",
    })
    .returning();
  return created;
}

export async function getIntegration(id: string) {
  const rows = await getDb().select().from(integrations).where(eq(integrations.id, id)).limit(1);
  return rows[0] || null;
}

export async function getWorkspaceIntegrations(workspaceId: string) {
  return getDb()
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.status, "active")))
    .orderBy(desc(integrations.createdAt));
}

export async function getIntegrationByProvider(workspaceId: string, provider: "google_drive" | "github") {
  const rows = await getDb()
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider), eq(integrations.status, "active")))
    .limit(1);
  return rows[0] || null;
}

export async function disconnectIntegration(id: string) {
  return getDb()
    .update(integrations)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(eq(integrations.id, id));
}

export async function updateIntegrationTokens(
  id: string,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: Date
) {
  return getDb()
    .update(integrations)
    .set({
      accessToken: encrypt(accessToken),
      ...(refreshToken ? { refreshToken: encrypt(refreshToken) } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      status: "active",
      errorCount: 0,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, id));
}

export async function markIntegrationError(id: string, error: string) {
  const existing = await getIntegration(id);
  const newCount = (existing?.errorCount || 0) + 1;
  return getDb()
    .update(integrations)
    .set({
      lastError: error,
      errorCount: newCount,
      status: newCount >= 5 ? "error" : "active",
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, id));
}

export async function touchLastUsed(id: string) {
  return getDb()
    .update(integrations)
    .set({ lastUsedAt: new Date() })
    .where(eq(integrations.id, id));
}

// ── Token Decryption ──

export function decryptAccessToken(integration: { accessToken: string }): string {
  return decrypt(integration.accessToken);
}

export function decryptRefreshToken(integration: { refreshToken: string | null }): string | null {
  if (!integration.refreshToken) return null;
  return decrypt(integration.refreshToken);
}

// ── Token Refresh ──

export async function refreshAccessToken(
  integration: { id: string; provider: "google_drive" | "github"; refreshToken: string | null; expiresAt: Date | null },
  providerConfig: OAuthProviderConfig
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date } | null> {
  const refreshToken = decryptRefreshToken(integration);
  if (!refreshToken) return null;

  const { clientId, clientSecret } = getProviderCredentialsFromConfig(providerConfig);
  const tokenUrl = providerConfig.refreshUrl || providerConfig.tokenUrl;
  const grantType = providerConfig.refreshTokenGrantType || "refresh_token";

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: grantType,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (providerConfig.acceptsJson) {
      headers["Accept"] = "application/json";
    }

    const resp = await fetch(tokenUrl, { method: "POST", headers, body: body.toString() });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Token refresh failed (${resp.status}): ${errorText}`);
    }

    let data: Record<string, unknown>;
    if (providerConfig.acceptsJson) {
      data = await resp.json();
    } else {
      const text = await resp.text();
      data = Object.fromEntries(new URLSearchParams(text));
    }

    const newAccessToken = data.access_token as string;
    if (!newAccessToken) throw new Error("No access_token in refresh response");

    const newRefreshToken = (data.refresh_token as string) || undefined;
    const expiresIn = data.expires_in as number | undefined;
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined;

    await updateIntegrationTokens(
      integration.id,
      newAccessToken,
      newRefreshToken,
      expiresAt
    );

    return { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token refresh failed";
    await markIntegrationError(integration.id, message);
    return null;
  }
}

function getProviderCredentialsFromConfig(provider: OAuthProviderConfig) {
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId) throw new Error(`${provider.clientIdEnv} is not set`);
  if (!clientSecret) throw new Error(`${provider.clientSecretEnv} is not set`);
  return { clientId, clientSecret };
}

// ── Get Valid Access Token (auto-refresh if expired) ──

export async function getValidAccessToken(
  integration: { id: string; provider: "google_drive" | "github"; accessToken: string; refreshToken: string | null; expiresAt: Date | null },
  providerConfig: OAuthProviderConfig
): Promise<string | null> {
  const now = new Date();
  const buffer = 5 * 60 * 1000; // 5 minutes
  const isExpired = integration.expiresAt
    ? new Date(integration.expiresAt).getTime() - now.getTime() < buffer
    : false;

  if (isExpired) {
    const refreshed = await refreshAccessToken(integration, providerConfig);
    return refreshed?.accessToken || null;
  }

  return decryptAccessToken(integration);
}
