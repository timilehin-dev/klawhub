import { ToolDefinition } from "../registry";
import { addMcpServer, getMcpServers, deleteMcpServer } from "@/db/mcp";
import { mcpManager } from "../mcp-client";

export const mcpConnectTool: ToolDefinition = {
  name: "mcp_connect",
  description: "Connect a new MCP (Model Context Protocol) service to Klawhub. Use this when a user provides an SSE URL to integrate a service like Salesforce, Notion, or a custom tool provider.",
  parameters: {
    name: { type: "string", description: "A unique, short name for this service (e.g., 'salesforce')", required: true },
    url: { type: "string", description: "The full SSE (Server-Sent Events) URL of the MCP server", required: true },
    apiKey: { type: "string", description: "Optional API Key for authentication (sent via X-Api-Key header)" },
    token: { type: "string", description: "Optional Bearer Token for authentication (sent via Authorization header)" },
  },
  async execute(params, ctx) {
    if (!ctx.workspaceId) return "Error: Cannot connect MCP server without a workspace context.";

    const { name, url, apiKey, token } = params;
    const authConfig = apiKey ? { apiKey } : token ? { token } : undefined;

    try {
      // 1. Perform health check
      const isHealthy = await mcpManager.healthCheck(url, authConfig);
      if (!isHealthy) {
        return `Error: Could not connect to MCP server at ${url}. The server is unreachable or returned an error during health check.`;
      }

      // 2. Save to DB
      await addMcpServer({
        workspaceId: ctx.workspaceId,
        name: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        url,
        authConfig,
        status: "active",
      });

      return `Successfully connected MCP service '${name}'. All agents in this workspace now have access to its tools. You can try asking me to list the available tools for this service.`;
    } catch (err) {
      return `Failed to connect MCP service: ${(err as Error).message}`;
    }
  },
};

export const mcpListTool: ToolDefinition = {
  name: "mcp_list",
  description: "List all connected MCP services in this workspace.",
  parameters: {},
  async execute(_params, ctx) {
    if (!ctx.workspaceId) return "Error: Cannot list MCP servers without a workspace context.";

    try {
      const servers = await getMcpServers(ctx.workspaceId);
      if (servers.length === 0) {
        return "No MCP services are currently connected to this workspace. You can connect one using `mcp_connect`.";
      }

      const list = servers.map(s => `• *${s.name}*: ${s.url} [Status: ${s.status}]`).join("\n");
      return `Connected MCP Services:\n${list}`;
    } catch (err) {
      return `Failed to list MCP services: ${(err as Error).message}`;
    }
  },
};

export const mcpRemoveTool: ToolDefinition = {
  name: "mcp_remove",
  description: "Remove/disconnect an MCP service from this workspace.",
  parameters: {
    id: { type: "string", description: "The ID of the MCP service to remove (get this from mcp_list)", required: true },
  },
  async execute(params, ctx) {
    try {
      await deleteMcpServer(params.id);
      return `Successfully disconnected MCP service with ID ${params.id}.`;
    } catch (err) {
      return `Failed to remove MCP service: ${(err as Error).message}`;
    }
  },
};
