export interface OAuthProviderConfig {
  id: string;                            // e.g. "google_drive"
  name: string;                          // e.g. "Google Drive"
  logo: string;                          // emoji or icon identifier
  authUrl: string;                       // authorization endpoint
  tokenUrl: string;                      // token exchange endpoint
  refreshUrl?: string;                   // token refresh endpoint (defaults to tokenUrl)
  clientIdEnv: string;                   // env var name for client ID
  clientSecretEnv: string;               // env var name for client secret
  scopes: string[];                      // scopes to request
  scopeSeparator?: string;               // defaults to " "
  extraAuthParams?: Record<string, string>; // provider-specific auth params
  extraTokenParams?: Record<string, string>; // provider-specific token params
  acceptsJson?: boolean;                 // token endpoint accepts JSON (vs form-encoded)
  refreshTokenGrantType?: string;        // defaults to "refresh_token"
}

export const providers: Record<string, OAuthProviderConfig> = {
  google_drive: {
    id: "google_drive",
    name: "Google Drive",
    logo: "google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    refreshUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    scopeSeparator: " ",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
    },
    acceptsJson: true,
  },

  github: {
    id: "github",
    name: "GitHub",
    logo: "github",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    scopes: ["repo", "read:org", "read:user", "issues", "pull_requests"],
    scopeSeparator: " ",
    acceptsJson: true,
  },

  notion: {
    id: "notion",
    name: "Notion",
    logo: "notion",
    authUrl: "https://auth.notion.com/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    scopes: [], // Notion scopes are configured at integration creation, not in auth URL
    scopeSeparator: ",",
    acceptsJson: false, // Notion uses form-encoded token exchange
    extraTokenParams: {
      grant_type: "authorization_code",
    },
  },

  linear: {
    id: "linear",
    name: "Linear",
    logo: "linear",
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://linear.app/oauth/token",
    clientIdEnv: "LINEAR_CLIENT_ID",
    clientSecretEnv: "LINEAR_CLIENT_SECRET",
    scopes: ["read", "write"],
    scopeSeparator: ",",
    acceptsJson: true,
  },

  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    logo: "hubspot",
    authUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
    scopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.companies.read",
      "crm.objects.companies.write",
      "crm.objects.deals.read",
      "crm.objects.deals.write",
      "crm.schemas.contacts.read",
    ],
    scopeSeparator: " ",
    acceptsJson: false,
    extraAuthParams: {
      optional_scope: "",
    },
  },
};

export function getProvider(providerId: string): OAuthProviderConfig | undefined {
  return providers[providerId];
}

export function getProviderCredentials(provider: OAuthProviderConfig): { clientId: string; clientSecret: string } {
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId) throw new Error(`${provider.clientIdEnv} is not set`);
  if (!clientSecret) throw new Error(`${provider.clientSecretEnv} is not set`);
  return { clientId, clientSecret };
}
