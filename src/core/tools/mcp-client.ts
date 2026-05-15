import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ToolDefinition } from "./registry";

export class McpToolManager {
  private clients = new Map<string, Client>();

  private cachedTools = new Map<string, ToolDefinition[]>();

  /**
   * Connect to an MCP server via SSE and return its available tools mapped to Klawhub ToolDefinitions
   */
  async connectAndFetchTools(serverUrl: string, serverName: string, authConfig?: any): Promise<ToolDefinition[]> {
    // Basic SSRF Prevention: reject localhost and private metadata IP
    const forbiddenPatterns = [/^https?:\/\/localhost/i, /^https?:\/\/127\.0\.0\.1/i, /^https?:\/\/169\.254/i];
    if (forbiddenPatterns.some(p => p.test(serverUrl))) {
      console.warn(`[SECURITY] Blocked SSRF attempt to internal/metadata IP: ${serverUrl}`);
      return [];
    }

    if (this.cachedTools.has(serverUrl)) {
      return this.cachedTools.get(serverUrl)!;
    }

    try {
      const url = new URL(serverUrl);
      
      // Inject Authorization headers if provided in authConfig
      // Note: The official MCP SSEClientTransport uses EventSource which lacks native custom header support.
      // For production auth, we either wrap global fetch or pass auth tokens via URL parameters.
      if (authConfig && authConfig.token) {
        url.searchParams.append("token", authConfig.token);
      } else if (authConfig && authConfig.apiKey) {
        url.searchParams.append("apiKey", authConfig.apiKey);
      }

      const transport = new SSEClientTransport(url);
      
      const client = new Client({
        name: "Klawhub-OS",
        version: "2.0.0",
      }, {
        capabilities: {}
      });

      await client.connect(transport);
      this.clients.set(serverUrl, client);

      const toolsRes = await client.listTools();
      
      const mappedTools = toolsRes.tools.map(mcpTool => {
        // Convert MCP JSONSchema to Klawhub ToolParamDef
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
          name: `mcp_${serverName}_${mcpTool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_'), // Namespace and sanitize
          description: `(MCP: ${serverName}) ${mcpTool.description}`,
          parameters: params,
          execute: async (args: Record<string, any>, ctx: any) => {
            try {
              const res = await client.callTool({
                name: mcpTool.name,
                arguments: args
              });
              
              if (res.isError) {
                return `Error from MCP ${serverName}: ${JSON.stringify(res.content)}`;
              }
              // Format standard text output
              const contentArray = res.content as any[];
              return contentArray.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join("\n");
            } catch (err) {
              return `MCP Tool Execution Error: ${(err as Error).message}`;
            }
          }
        };
      });

      this.cachedTools.set(serverUrl, mappedTools);
      return mappedTools;

    } catch (error) {
      console.error(`Failed to connect to MCP server ${serverName} at ${serverUrl}`, error);
      return [];
    }
  }

  async closeAll() {
    for (const [url, client] of this.clients.entries()) {
      await client.close();
    }
    this.clients.clear();
  }
}

export const mcpManager = new McpToolManager();
