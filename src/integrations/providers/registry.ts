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
};

export function getProvider(providerId: string): OAuthProviderConfig | undefined {
  return providers[providerId];
}

export function getProviderCredentials(provider: OAuthProviderConfig): { clientId: string; clientSecret: string } {
  const clientId = process.env[provider.clientIdEnv] || process.env[`NEXT_PUBLIC_${provider.clientIdEnv}`];
  const clientSecret = process.env[provider.clientSecretEnv] || process.env[`NEXT_PUBLIC_${provider.clientSecretEnv}`];
  if (!clientId) throw new Error(`${provider.clientIdEnv} is not set (checked both standard and NEXT_PUBLIC_ versions)`);
  if (!clientSecret) throw new Error(`${provider.clientSecretEnv} is not set (checked both standard and NEXT_PUBLIC_ versions)`);
  return { clientId, clientSecret };
}
