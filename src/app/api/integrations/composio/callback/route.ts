import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { integrations } from "@/db/schema";
import { upsertMcpServer } from "@/db/mcp";
import { getProvider } from "@/integrations/providers/registry";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspaceId = searchParams.get("workspaceId");
  const providerId = searchParams.get("providerId");
  
  if (!workspaceId || !providerId) {
    return NextResponse.json({ error: "Missing metadata in callback" }, { status: 400 });
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  try {
    const db = getDb();

    // Mark integration as active in our DB
    // We don't store tokens for Composio, we just need to know it's linked
    await db.insert(integrations).values({
      workspaceId,
      provider: providerId as any,
      status: "active",
      accessToken: "composio_managed", 
      metadata: {
        isComposio: true
      }
    }).onConflictDoUpdate({
      target: [integrations.workspaceId, integrations.provider],
      set: {
        status: "active",
        metadata: { isComposio: true },
        updatedAt: new Date()
      }
    });

    // Automatically register the MCP bridge for this service
    // Composio acts as a dynamic MCP server for the entire workspace
    // We use a special URL that the McpToolManager will recognize
    const mcpUrl = `composio://tool-router`;
    
    await upsertMcpServer(workspaceId, `Composio: Managed Integrations`, {
      url: mcpUrl,
      authConfig: {
        type: "composio_linked",
        provider: "composio",
        workspaceId: workspaceId
      }
    });

    // Redirect back to the integrations page
    const { origin } = new URL(request.url);
    return NextResponse.redirect(`${origin}/dashboard/integrations?success=true&provider=${providerId}`);
  } catch (err) {
    console.error("[Composio Callback] Error:", err);
    return NextResponse.json({ error: "Failed to finalize connection" }, { status: 500 });
  }
}
