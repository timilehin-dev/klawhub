import { inngest } from "./client";
import { getAllWorkspaces, getDb, integrations } from "@/db";
import { listUserChannels, getChannelHistory, postToThread, getWorkspaceSlack } from "@/integrations/slack/client";
import { githubListEvents, gmailListMessages, googleCalendarListEvents } from "@/integrations/clients";
import { agentChat } from "@/core/llm";
import { eq, and, sql } from "drizzle-orm";

/**
 * Morning Brief Workflow
 * Runs daily to summarize activity across Slack, GitHub, Gmail, and Calendar.
 * Integrates persistent watermarking to avoid duplicate alerts in heartbeat.
 */
export const morningBriefWorkflow = inngest.createFunction(
  { id: "morning-brief", name: "Morning Brief" },
  { cron: "0 9 * * *" }, // Run daily at 9:00 AM
  async ({ step }) => {
    const workspaces = await step.run("get-workspaces", async () => {
      return getAllWorkspaces();
    });

    for (const workspace of workspaces) {
      await step.run(`process-workspace-${workspace.id.slice(0, 8)}`, async () => {
        const workspaceId = workspace.id;
        const teamId = workspace.slackTeamId!;
        
        const metadataUpdates: Array<{ integrationId: string; metadata: Record<string, unknown> }> = [];

        // 1. Fetch Slack Data (Last 24h)
        const channels = await listUserChannels(teamId);
        const slackContexts = await Promise.all(
          channels.slice(0, 10).map(async (ch) => {
            const history = await getChannelHistory(ch.id, 50, teamId);
            const recentMessages = history.filter(m => {
              const age = Date.now() - (parseFloat(m.ts) * 1000);
              return age < 24 * 60 * 60 * 1000;
            });
            if (recentMessages.length === 0) return null;
            return `Channel #${ch.name}:\n${recentMessages.map(m => `- [${m.user}] ${m.text}`).join("\n")}`;
          })
        );
        const slackData = slackContexts.filter(Boolean).join("\n\n");

        // 2. Fetch GitHub Data (Watermarked)
        let githubData = "No recent GitHub activity.";
        const githubIntegrations = await getDb()
          .select()
          .from(integrations)
          .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "github"), eq(integrations.status, "active")))
          .limit(1);

        if (githubIntegrations.length > 0) {
          try {
            const integration = githubIntegrations[0];
            const meta = (integration.metadata as Record<string, unknown>) || {};
            const lastNotifiedAt = meta.lastNotifiedGitHubAt ? new Date(meta.lastNotifiedGitHubAt as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            const events = await githubListEvents(workspaceId);
            const newEvents = events.filter((e: any) => new Date(e.createdAt) > lastNotifiedAt);
            
            if (newEvents.length > 0) {
              githubData = newEvents.map((e: any) => `- [${e.type}] ${e.actor} in ${e.repo} (${new Date(e.createdAt).toLocaleTimeString()})`).join("\n");
              const maxAt = newEvents.reduce((max: string, e: any) => new Date(e.createdAt) > new Date(max) ? e.createdAt : max, newEvents[0].createdAt);
              metadataUpdates.push({ integrationId: integration.id, metadata: { ...meta, lastNotifiedGitHubAt: maxAt } });
            }
          } catch (err) {
            githubData = `GitHub Error: ${(err as Error).message}`;
          }
        }

        // 3. Fetch Google/Gmail Data (Watermarked)
        let gmailData = "No recent emails.";
        const googleIntegrations = await getDb()
          .select()
          .from(integrations)
          .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "google"), eq(integrations.status, "active")))
          .limit(1);

        if (googleIntegrations.length > 0) {
          try {
            const integration = googleIntegrations[0];
            const meta = (integration.metadata as Record<string, unknown>) || {};
            const lastIds = (meta.lastNotifiedGmailIds as string[]) || [];
            
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const dateQuery = `after:${yesterday.getFullYear()}/${yesterday.getMonth() + 1}/${yesterday.getDate()}`;
            const messages = await gmailListMessages(workspaceId, 15, dateQuery);
            
            const newMessages = messages.filter((m: any) => !lastIds.includes(m.id));
            if (newMessages.length > 0) {
              gmailData = newMessages.map((m: any) => `- From: ${m.from} | Subject: ${m.subject}`).join("\n");
              const newIds = [...newMessages.map((m: any) => m.id), ...lastIds].slice(0, 100);
              metadataUpdates.push({ integrationId: integration.id, metadata: { ...meta, lastNotifiedGmailIds: newIds } });
            }
          } catch (err) {
            gmailData = `Gmail Error: ${(err as Error).message}`;
          }
        }

        // 4. Calendar Activity (Next 24h)
        let calendarData = "No upcoming meetings.";
        try {
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          const events = await googleCalendarListEvents(workspaceId, { timeMin: new Date().toISOString(), timeMax: tomorrow, maxResults: 15 });
          if (events.length > 0) {
            calendarData = events.map((e: any) => `- ${e.summary} (${new Date(e.start).toLocaleTimeString()})`).join("\n");
          }
        } catch {}

        // 5. Generate and Send Briefing
        const prompt = `You are Klawhub, providing a "Morning Brief" for the team. 
Summarize the last 24 hours of activity and provide a concise, professional briefing.

SLACK:
${slackData || "Minimal activity."}

GITHUB:
${githubData}

GMAIL:
${gmailData}

CALENDAR (Upcoming):
${calendarData}

Formatting: Mrkdwn (*bold*, • bullets). Include 3 clear Action Items.`;

        const summary = await agentChat("general", [
          { role: "system", content: "You are a professional AI coworker providing a morning executive summary." },
          { role: "user", content: prompt }
        ], { temperature: 0.4 }, { workspaceId });

        const primaryChannel = channels.find(c => c.name === "general") || channels[0];
        if (primaryChannel) {
          const header = `☀️ *Morning Briefing: ${new Date().toLocaleDateString()}*`;
          await postToThread(primaryChannel.id, "", `${header}\n\n${summary}`, {}, teamId);
          
          // Update watermarks ONLY after successful post
          for (const update of metadataUpdates) {
            await getDb().update(integrations)
              .set({ metadata: update.metadata, updatedAt: sql`now()` })
              .where(eq(integrations.id, update.integrationId));
          }
        }
      });
    }
  }
);
