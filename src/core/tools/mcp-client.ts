import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ToolDefinition } from "./registry";

const MCP_CONNECT_TIMEOUT_MS = 10_000;

export class McpToolManager {
  private clients = new Map<string, Client>();

  /**
   * Connect to an MCP server via SSE and return its available tools mapped to Klawhub ToolDefinitions.
   * Note: No in-memory tool cache — each DAG step runs in a fresh serverless context so caching
   * would never be shared. Connections are cached per-invocation only.
   */
  async connectAndFetchTools(serverUrl: string, serverName: string, authConfig?: any): Promise<ToolDefinition[]> {
    // Basic SSRF Prevention: reject localhost and private/metadata IPs
    const forbiddenPatterns = [
      /^https?:\/\/localhost/i,
      /^https?:\/\/127\.0\.0\.1/i,
      /^https?:\/\/169\.254/i,
      /^https?:\/\/10\.\d+\.\d+\.\d+/i,
      /^https?:\/\/192\.168\./i,
    ];
    if (forbiddenPatterns.some(p => p.test(serverUrl))) {
      console.warn(`[MCP][SECURITY] Blocked SSRF attempt to internal IP: ${serverUrl}`);
      return [];
    }

    try {
      const client = await this.getOrCreateClient(serverUrl, authConfig);
      const toolsRes = await client.listTools();

      const mappedTools = toolsRes.tools.map(mcpTool => {
        const params: Record<string, any> = {};
        const required = (mcpTool.inputSchema as any)?.required || [];
        const properties = (mcpTool.inputSchema as any)?.properties || {};

        for (const [key, val] of Object.entries(properties)) {
          params[key] = {
            type: (val as any).type === "integer" ? "number" : (val as any).type,
            description: (val as any).description || "",
            required: required.includes(key),
          };
        }

        return {
          name: `mcp_${serverName}_${mcpTool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
          description: `(MCP: ${serverName}) ${mcpTool.description}`,
          parameters: params,
          execute: async (args: Record<string, any>, _ctx: any) => {
            try {
              // Attempt the tool call — reconnect once on failure
              let res;
              try {
                res = await client.callTool({ name: mcpTool.name, arguments: args });
              } catch (callErr) {
                console.warn(`[MCP] Tool call failed on ${serverName}.${mcpTool.name}, attempting reconnect...`);
                const freshClient = await this.reconnect(serverUrl, serverName, authConfig);
                res = await freshClient.callTool({ name: mcpTool.name, arguments: args });
              }

              if (res.isError) {
                return `Error from MCP ${serverName}: ${JSON.stringify(res.content)}`;
              }
              const contentArray = res.content as any[];
              return contentArray.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join("\n");
            } catch (err) {
              return `MCP Tool Execution Error (${serverName}.${mcpTool.name}): ${(err as Error).message}`;
            }
          }
        };
      });

      return mappedTools;

    } catch (error) {
      console.error(`[MCP] Failed to connect to ${serverName} at ${serverUrl}:`, (error as Error).message);
      return [];
    }
  }

  /** Get an existing client or create a new one with connection timeout */
  private async getOrCreateClient(serverUrl: string, authConfig?: any): Promise<Client> {
    if (this.clients.has(serverUrl)) {
      return this.clients.get(serverUrl)!;
    }
    return this.createClient(serverUrl, authConfig);
  }

  /** Create and connect a new MCP client, with a timeout guard */
  private async createClient(serverUrl: string, authConfig?: any): Promise<Client> {

    // Build auth headers — NEVER put tokens in URL query params (visible in logs/proxies)
    const authHeaders: Record<string, string> = {};

    // 1. Resolve dynamic auth if linked to a Klawhub integration
    if (authConfig?.type === "composio_linked") {
      try {
        const { getComposioMcpConfig } = await import("@/integrations/composio");
        // For Composio, the workspaceId is the session owner
        const config = await getComposioMcpConfig(authConfig.workspaceId || "global");
        if (config) {
          serverUrl = config.url;
          Object.assign(authHeaders, config.headers);
        }
      } catch (err) {
        console.error(`[MCP] Failed to resolve Composio auth for ${serverUrl}:`, err);
      }
    } else if (authConfig?.type === "integration_linked" && authConfig.integrationId) {
      try {
        const { getIntegration, getValidAccessToken } = await import("@/integrations/store");
        const { getProvider } = await import("@/integrations/providers/registry");
        const integration = await getIntegration(authConfig.integrationId);
        if (integration) {
          const provider = getProvider(authConfig.provider);
          if (provider) {
            let token: string | null = null;
            
            // Replaced Nango with Composio logic elsewhere, 
            // but keeping this block clean for other linked types
            token = await getValidAccessToken(integration as any, provider);

            if (token) {
              authHeaders["Authorization"] = `Bearer ${token}`;
            }
          }
        }
      } catch (err) {
        console.error(`[MCP] Failed to resolve integration-linked auth for ${serverUrl}:`, err);
      }
    } else if (authConfig?.token) {
      authHeaders["Authorization"] = `Bearer ${authConfig.token}`;
    } else if (authConfig?.apiKey) {
      authHeaders["X-Api-Key"] = authConfig.apiKey;
    }

    // 2. Fallback to composio if url is a protocol shortcut
    if (serverUrl.startsWith("composio://")) {
      const { getComposioMcpConfig } = await import("@/integrations/composio");
      const config = await getComposioMcpConfig("global"); // fallback
      if (config) {
        serverUrl = config.url;
        Object.assign(authHeaders, config.headers);
      }
    }

    // Wrap global fetch to inject auth headers on every SSE request to this server
    const authFetch: typeof fetch = (input, init = {}) => {
      return fetch(input, {
        ...init,
        headers: { ...authHeaders, ...(init.headers as Record<string, string> || {}) },
      });
    };

    // Create the transport using the RESOLVED serverUrl
    const finalUrl = new URL(serverUrl);
    const transport = new SSEClientTransport(finalUrl, { fetch: authFetch } as any);
    const client = new Client({ name: "Klawhub-OS", version: "2.0.0" }, { capabilities: {} });

    // Race connection against a timeout to prevent hanging DAG steps
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP connection timeout after ${MCP_CONNECT_TIMEOUT_MS}ms`)), MCP_CONNECT_TIMEOUT_MS)
      ),
    ]);

    this.clients.set(serverUrl, client);
    return client;
  }

  /** Force-reconnect: close stale client and create a fresh one */
  private async reconnect(serverUrl: string, serverName: string, authConfig?: any): Promise<Client> {
    console.log(`[MCP] Reconnecting to ${serverName}...`);
    try {
      const stale = this.clients.get(serverUrl);
      if (stale) await stale.close().catch(() => {});
    } finally {
      this.clients.delete(serverUrl);
    }
    return this.createClient(serverUrl, authConfig);
  }

  /** Health check: verify a server is reachable before a DAG run starts */
  async healthCheck(serverUrl: string, authConfig?: any): Promise<boolean> {
    try {
      const client = await this.getOrCreateClient(serverUrl, authConfig);
      await client.listTools();
      return true;
    } catch {
      return false;
    }
  }

  async closeAll() {
    for (const [, client] of this.clients.entries()) {
      await client.close().catch(() => {});
    }
    this.clients.clear();
  }
}

export const mcpManager = new McpToolManager();
