export interface ComposioAuthResponse {
  redirectUrl: string;
  connectionId?: string;
}

export async function getComposioAuthUrl(
  workspaceId: string,
  authConfigId: string,
  callbackUrl: string
): Promise<ComposioAuthResponse | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error("[Composio] COMPOSIO_API_KEY is not set");
    return null;
  }

  try {
    // We use the modern connected_accounts/link endpoint for managed auth
    const res = await fetch("https://backend.composio.dev/api/v3.1/connected_accounts/link", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_config_id: authConfigId,
        user_id: workspaceId,
        redirect_url: callbackUrl,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error("[Composio] Failed to get auth URL. Status:", res.status, "ConfigID:", authConfigId, "Error:", error);
      return null;
    }

    const data = await res.json();
    return {
      redirectUrl: data.redirectUrl || data.redirect_url,
    };
  } catch (err) {
    console.error("[Composio] Auth URL Fetch Error:", err);
    return null;
  }
}

/**
 * Get the Composio MCP Tool Router configuration for a specific workspace.
 */
export async function getComposioMcpConfig(workspaceId: string): Promise<{ url: string; headers: Record<string, string> } | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;

  try {
    // 1. Create a session for the user/workspace via the Tool Router API
    const res = await fetch("https://backend.composio.dev/api/v3.1/tool_router/session", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: workspaceId,
      }),
    });

    if (!res.ok) {
      console.error("[Composio] Failed to create tool router session:", await res.text());
      return null;
    }
    const data = await res.json();
    const sessionId = data.id || data.session_id;

    // 2. Return the Tool Router URL with the session context
    return {
      url: `https://mcp.composio.dev/tool-router/sse?sessionId=${sessionId}`,
      headers: {
        "x-api-key": apiKey,
      },
    };
  } catch (err) {
    console.error("[Composio] Error getting MCP config:", err);
    return null;
  }
}
