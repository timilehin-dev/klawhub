import type { OAuthProviderConfig } from "./providers/registry";
import { getProviderCredentials } from "./providers/registry";
import { createIntegration } from "./store";

/**
 * Build the OAuth authorization URL for a provider.
 */
export function buildAuthUrl(provider: OAuthProviderConfig, state: string, redirectUri: string): string {
  const { clientId } = getProviderCredentials(provider);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    ...(provider.scopes.length > 0 ? { scope: provider.scopes.join(provider.scopeSeparator || " ") } : {}),
    ...provider.extraAuthParams,
  });
  return `${provider.authUrl}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  provider: OAuthProviderConfig,
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}> {
  const { clientId, clientSecret } = getProviderCredentials(provider);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    ...provider.extraTokenParams,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider.acceptsJson) {
    headers["Accept"] = "application/json";
  }

  let resp: Response | null = null;
  for (let i = 0; i <= 2; i++) {
    try {
      resp = await fetch(provider.tokenUrl, {
        method: "POST",
        headers,
        body: body.toString(),
      });
      if (resp.ok) break;
      if (i === 2) {
        const errorText = await resp.text();
        throw new Error(`Token exchange failed (${resp.status}): ${errorText}`);
      }
    } catch (err) {
      if (i === 2) throw err;
    }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }

  if (!resp || !resp.ok) throw new Error("Token exchange failed after retries");

  let data: Record<string, unknown>;
  if (provider.acceptsJson) {
    data = await resp.json();
  } else {
    const text = await resp.text();
    data = Object.fromEntries(new URLSearchParams(text));
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) || undefined,
    expiresIn: data.expires_in as number | undefined,
    scope: (data.scope as string) || undefined,
  };
}

/**
 * Full flow: exchange code, create integration record, fetch account info.
 */
export async function completeOAuthFlow(
  provider: OAuthProviderConfig,
  code: string,
  redirectUri: string,
  workspaceId: string
) {
  const tokens = await exchangeCodeForTokens(provider, code, redirectUri);

  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000)
    : undefined;

  const accountInfo = await fetchAccountInfo(provider, tokens.accessToken);

    const integration = await createIntegration({
    workspaceId,
    provider: provider.id as "google" | "github",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    scope: tokens.scope,
    externalAccountId: accountInfo.id,
    externalAccountName: accountInfo.name,
    externalAccountEmail: accountInfo.email,
  });
 
  return integration;
}
 
/**
 * Fetch account info (id, name, email) from provider API using the access token.
 */
async function fetchAccountInfo(
  provider: OAuthProviderConfig,
  accessToken: string
): Promise<{ id: string; name?: string; email?: string }> {
  try {
    switch (provider.id) {
      case "google": {
        const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await resp.json();
        return { id: data.id || data.sub, name: data.name, email: data.email };
      }
      case "github": {
        const resp = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
          },
        });
        const data = await resp.json();
        return { id: String(data.id), name: data.login, email: data.email };
      }
      default:
        return { id: "unknown" };
    }
  } catch {
    return { id: "unknown" };
  }
}
