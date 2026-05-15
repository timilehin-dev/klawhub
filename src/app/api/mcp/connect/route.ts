import { NextRequest, NextResponse } from "next/server";
import { addMcpServer, getMcpServers, deleteMcpServer } from "@/db/mcp";
import { mcpManager } from "@/core/tools/mcp-client";

// POST /api/mcp/connect — Connect a new MCP server
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspaceId, name, url, apiKey, token } = body;

    if (!workspaceId || !name || !url) {
      return NextResponse.json({ error: "workspaceId, name, and url are required" }, { status: 400 });
    }

    const authConfig = apiKey ? { apiKey } : token ? { token } : undefined;

    // 1. Health check before saving
    const isHealthy = await mcpManager.healthCheck(url, authConfig);
    if (!isHealthy) {
      return NextResponse.json({ error: "Failed to connect to MCP server. Please verify the URL and API key." }, { status: 400 });
    }

    // 2. Save to DB
    const [server] = await addMcpServer({
      workspaceId,
      name: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      url,
      authConfig,
      status: "active",
    });

    return NextResponse.json({ success: true, server });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect MCP server";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/mcp/connect?workspaceId=xxx — List MCP servers for a workspace
export async function GET(request: NextRequest) {
  const validatedId = request.headers.get("x-validated-workspace-id");
  const { searchParams } = new URL(request.url);
  const workspaceId = validatedId || searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const servers = await getMcpServers(workspaceId);
    return NextResponse.json({ servers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list MCP servers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/mcp/connect?id=xxx — Disconnect an MCP server
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await deleteMcpServer(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to disconnect MCP server";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
