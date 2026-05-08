import { inngest } from "./client";
import { getAllWorkspaces } from "@/db/workspaces";
import { listUserChannels, getChannelHistory, postToThread } from "@/integrations/slack/client";
import { githubListEvents, gmailListMessages, googleCalendarListEvents } from "@/integrations/clients";
import { agentChat } from "@/core/llm";
import { toSlackMrkdwn } from "@/utils/slack-mrkdwn";

/**
 * Morning Brief Workflow
 * Runs daily to summarize the last 24h across Slack, GitHub, Gmail, and Calendar.
 */
export const morningBriefWorkflow = inngest.createFunction(
  { id: "morning-brief", name: "Morning Brief" },
  { cron: "0 9 * * *" }, // Run daily at 9:00 AM
  async ({ step }) => {
    const workspaces = await step.run("get-workspaces", async () => {
      return getAllWorkspaces();
    });

    for (const workspace of workspaces) {
      await step.run(`process-workspace-${workspace.id}`, async () => {
        const workspaceId = workspace.id;
        const teamId = workspace.slackTeamId!;
        
        // 1. Fetch Slack Data (Last 24h in joined channels)
        const channels = await listUserChannels(teamId);
        const slackContexts = await Promise.all(
          channels.map(async (ch) => {
            const history = await getChannelHistory(ch.id, 50, teamId);
            const recentMessages = history.filter(m => {
              const age = Date.now() - (parseFloat(m.ts) * 1000);
              return age < 24 * 60 * 60 * 1000;
            });
            if (recentMessages.length === 0) return null;
            return `Channel #${ch.name}:\n${recentMessages.map(m => `- ${m.text}`).join("\n")}`;
          })
        );
        const slackData = slackContexts.filter(Boolean).join("\n\n");

        // 2. Fetch GitHub Activity (Last 24h)
        let githubData = "No recent GitHub activity found.";
        try {
          const events = await githubListEvents(workspaceId);
          const recentEvents = events.filter((e: any) => {
            const age = Date.now() - new Date(e.createdAt).getTime();
            return age < 24 * 60 * 60 * 1000;
          });
          if (recentEvents.length > 0) {
            githubData = recentEvents.map((e: any) => `- [${e.type}] ${e.actor} in ${e.repo}`).join("\n");
          }
        } catch (err) {
          console.warn(`[MorningBrief] GitHub fetch failed for ${workspaceId}:`, err);
        }

        // 3. Fetch Gmail (Last 24h)
        let gmailData = "No recent emails found.";
        try {
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const dateQuery = `after:${yesterday.getFullYear()}/${yesterday.getMonth() + 1}/${yesterday.getDate()}`;
          const messages = await gmailListMessages(workspaceId, 10, dateQuery);
          if (messages.length > 0) {
            gmailData = messages.map((m: any) => `- From: ${m.from} | Subject: ${m.subject}\n  Snippet: ${m.snippet}`).join("\n");
          }
        } catch (err) {
          console.warn(`[MorningBrief] Gmail fetch failed for ${workspaceId}:`, err);
        }

        // 4. Fetch Calendar (Next 24h)
        let calendarData = "No upcoming events for the next 24 hours.";
        try {
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          const events = await googleCalendarListEvents(workspaceId, { 
            timeMin: new Date().toISOString(),
            timeMax: tomorrow,
            maxResults: 15
          });
          if (events.length > 0) {
            calendarData = events.map((e: any) => `- ${e.summary} (${new Date(e.start).toLocaleTimeString()})`).join("\n");
          }
        } catch (err) {
          console.warn(`[MorningBrief] Calendar fetch failed for ${workspaceId}:`, err);
        }

        // 5. Generate Summary using LLM
        const prompt = `You are Klawhub, providing a "Morning Brief" for the team. 
Summarize the last 24 hours of activity and provide a concise, professional briefing.

SLACK ACTIVITY:
${slackData || "Minimal Slack activity."}

GITHUB ACTIVITY:
${githubData}

GMAIL ACTIVITY:
${gmailData}

UPCOMING CALENDAR:
${calendarData}

Formatting rules:
- Use Slack mrkdwn (*bold*, _italic_, • bullets)
- Group by category (Communication, Engineering, Schedule)
- Identify 3 key "Action Items" or "Follow-ups" based on the activity.
- Keep it encouraging but professional.`;

        const summary = await agentChat("general", [
          { role: "system", content: "You are a professional AI coworker providing a morning executive summary." },
          { role: "user", content: prompt }
        ], { temperature: 0.5 }, { workspaceId });

        // 6. Post to Slack
        // Find a primary channel (prefer #general, fallback to first joined)
        const primaryChannel = channels.find(c => c.name === "general") || channels[0];
        if (primaryChannel) {
          const header = `☀️ *Morning Briefing: ${new Date().toLocaleDateString()}*`;
          await postToThread(primaryChannel.id, "", `${header}\n\n${summary}`, {}, teamId);
        }
      });
    }
  }
);
