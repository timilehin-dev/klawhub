import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { integrations } from "@/db/schema";
import { upsertMcpServer } from "@/db/mcp";
import { getProvider } from "@/integrations/providers/registry";

export async function POST(request: NextRequest) {
  const { providerId, connectionId, workspaceId } = await request.json();

  if (!providerId || !connectionId || !workspaceId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  try {
    const db = getDb();

    // Create or update the integration record
    // We store Nango info in metadata
    await db.insert(integrations).values({
      workspaceId,
      provider: providerId as any,
      status: "active",
      accessToken: "nango_managed", // placeholder
      refreshToken: "nango_managed", // placeholder
      metadata: {
        isNango: true,
        connectionId: connectionId
      }
    }).onConflictDoUpdate({
      target: [integrations.workspaceId, integrations.provider],
      set: {
        status: "active",
        metadata: {
          isNango: true,
          connectionId: connectionId
        },
        updatedAt: new Date()
      }
    });

    // Automatically register the MCP bridge for this service
    // Defaulting to our managed MCP proxy
    const mcpUrl = `https://mcp.klawhub.xyz/${providerId}/sse`;
    
    await upsertMcpServer({
      workspaceId,
      name: provider.name,
      url: mcpUrl,
      authConfig: {
        type: "integration_linked",
        provider: providerId,
        integrationId: connectionId // We can use connectionId as the link
      }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Nango Completion] Error:", err);
    return NextResponse.json({ error: "Failed to finalize connection" }, { status: 500 });
  }
}
