import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function verifySlackRequest(req: NextRequest, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const secret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !secret) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const mySignature = "v0=" + createHmac("sha256", secret).update(sigBaseString).digest("hex");
  return signature === mySignature;
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  if (!verifySlackRequest(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(body);
  const command = params.get("command");
  const text = params.get("text") || "";
  const userId = params.get("user_id");
  const channelId = params.get("channel_id");

  if (command === "/klawhub") {
    if (!text) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Usage: `/klawhub [what you want built]`\nExample: `/klawhub build a Python script that scrapes HN front page`",
      });
    }

    const [run] = await db
      .insert(runs)
      .values({
        slackUserId: userId!,
        slackChannelId: channelId!,
        request: text,
        status: "pending",
      })
      .returning();

    await inngest.send({
      name: "slack/build.requested",
      data: {
        slackChannelId: channelId,
        slackThreadTs: undefined,
        slackUserId: userId,
        messageText: text,
        runId: run.id,
      },
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: `🚀 Build Squad activated!\n_Request: ${text}_\n\nI'll post updates in this channel.`,
    });
  }

  if (command === "/klawhub-status") {
    const latestRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.slackUserId, userId!))
      .orderBy(runs.createdAt)
      .limit(5);

    if (latestRuns.length === 0) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "No builds found. Start one with `/klawhub [request]`",
      });
    }

    const lines = latestRuns.map((r) => {
      const status = r.status === "done" ? "✅" : r.status === "error" ? "⚠️" : "⏳";
      return `${status} ${r.request.slice(0, 40)}... — ${r.status}`;
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: `*Your recent builds:*\n\n${lines.join("\n")}`,
    });
  }

  return NextResponse.json({ ok: true });
}