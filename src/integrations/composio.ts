export interface ComposioAuthResponse {
  redirectUrl: string;
  connectionId?: string;
}

export async function getComposioAuthUrl(
  userId: string,
  app: string,
  callbackUrl: string
): Promise<ComposioAuthResponse | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error("[Composio] COMPOSIO_API_KEY is not set");
    return null;
  }

  try {
    // 1. Create a session for the user
    const sessionRes = await fetch("https://backend.composio.dev/api/v3.1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        connectedAccount: {
          userId: userId,
        },
      }),
    });

    if (!sessionRes.ok) {
      const error = await sessionRes.text();
      console.error("[Composio] Failed to create session:", error);
      return null;
    }

    const sessionData = await sessionRes.json();
    const sessionId = sessionData.id;

    // 2. Get the authorization URL
    const authRes = await fetch(`https://backend.composio.dev/api/v3.1/sessions/${sessionId}/authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        app: app,
        callbackUrl: callbackUrl,
      }),
    });

    if (!authRes.ok) {
      const error = await authRes.text();
      console.error("[Composio] Failed to get auth URL:", error);
      return null;
    }

    const authData = await authRes.json();
    return {
      redirectUrl: authData.redirectUrl,
      connectionId: authData.connectionId,
    };
  } catch (err) {
    console.error("[Composio] Error initiating connection:", err);
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
    // 1. Create a session for the user/workspace
    const res = await fetch("https://backend.composio.dev/api/v3.1/sessions", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connectedAccount: {
          userId: workspaceId,
        },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // 2. Return the Tool Router URL with the session context
    return {
      url: `https://mcp.composio.dev/tool-router/sse?sessionId=${data.id}`,
      headers: {
        "x-api-key": apiKey,
      },
    };
  } catch (err) {
    console.error("[Composio] Error getting MCP config:", err);
    return null;
  }
}
