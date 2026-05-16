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
  useComposio?: boolean;                 // whether to allow Composio for this provider
  composioConfigId?: string;             // Composio Auth Config ID (NanoID)
}

export const providers: Record<string, OAuthProviderConfig> = {
  google: {
    id: "google",
    name: "Google Workspace",
    logo: "google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    refreshUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    scopeSeparator: " ",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
    },
    acceptsJson: true,
    useComposio: true,
    composioConfigId: "ac_m4Hex1RtO6ja",
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
    useComposio: true,
    composioConfigId: "ac_Q1V0hUWLBrAE",
  },
  notion: {
    id: "notion",
    name: "Notion",
    logo: "notion",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    scopes: [], // Notion uses fixed scopes based on integration settings
    acceptsJson: true,
    extraAuthParams: {
      owner: "user",
      response_type: "code",
    },
    useComposio: true,
    composioConfigId: "ac_Lym7Y2op39jF",
  },
  salesforce: {
    id: "salesforce",
    name: "Salesforce",
    logo: "salesforce",
    authUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    clientIdEnv: "SALESFORCE_CLIENT_ID",
    clientSecretEnv: "SALESFORCE_CLIENT_SECRET",
    scopes: ["api", "refresh_token", "offline_access"],
    scopeSeparator: " ",
    acceptsJson: true,
    useComposio: true,
    composioConfigId: "ac_Kx7npfitil06",
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    logo: "hubspot",
    authUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
    scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read"],
    scopeSeparator: " ",
    acceptsJson: true,
    useComposio: true,
    composioConfigId: "ac_EEVqj5RkFERO",
  },
  linear: {
    id: "linear",
    name: "Linear",
    logo: "linear",
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    clientIdEnv: "LINEAR_CLIENT_ID",
    clientSecretEnv: "LINEAR_CLIENT_SECRET",
    scopes: ["read", "write"],
    scopeSeparator: " ",
    acceptsJson: true,
    useComposio: true,
    composioConfigId: "ac_jkMpaU7Tnrfs",
  },
  jira: {
    id: "jira",
    name: "Jira",
    logo: "jira",
    authUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    clientIdEnv: "JIRA_CLIENT_ID",
    clientSecretEnv: "JIRA_CLIENT_SECRET",
    scopes: ["read:jira-work", "write:jira-work", "offline_access"],
    scopeSeparator: " ",
    acceptsJson: true,
    extraAuthParams: {
      audience: "api.atlassian.com",
      prompt: "consent",
    },
    useComposio: true,
    composioConfigId: "ac_SAWyHxqh07U3",
  },
};

export function getProvider(providerId: string): OAuthProviderConfig | undefined {
  return providers[providerId];
}

export function getProviderCredentials(provider: OAuthProviderConfig): { clientId: string; clientSecret: string; isComposio?: boolean } {
  const clientId = process.env[provider.clientIdEnv] || process.env[`NEXT_PUBLIC_${provider.clientIdEnv}`];
  const clientSecret = process.env[provider.clientSecretEnv] || process.env[`NEXT_PUBLIC_${provider.clientSecretEnv}`];
  
  if (!clientId || !clientSecret) {
    // Check if Composio is enabled as a fallback
    if (process.env.COMPOSIO_API_KEY) {
      return { clientId: "composio", clientSecret: "composio", isComposio: true };
    }
    
    if (!clientId) throw new Error(`${provider.clientIdEnv} is not set`);
    if (!clientSecret) throw new Error(`${provider.clientSecretEnv} is not set`);
  }
  
  return { clientId: clientId!, clientSecret: clientSecret!, isComposio: false };
}
