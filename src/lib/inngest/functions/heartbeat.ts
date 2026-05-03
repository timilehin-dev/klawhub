import { inngest } from "../client";
import { getDb } from "@/lib/db/connection";
import { workspaces, workspaceMembers, integrations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { slack } from "@/lib/slack/client";

/**
 * Heartbeat workflow — runs every 30 minutes.
 *
 * Checks connected integrations (GitHub, Google Drive) for notable changes
 * and proactively posts updates to Slack channels where the bot is a member.
 *
 * This makes Klawhub proactive instead of purely reactive — it monitors
 * your tools and surfaces important changes without being asked.
 */
export const heartbeatWorkflow = inngest.createFunction(
  { id: "heartbeat", name: "Heartbeat Monitor" },
  { cron: "*/30 * * * *" }, // Every 30 minutes
  async ({ step }) => {
    // Step 1: Get all active workspaces with channels to notify
    const workspacesData = await step.run("fetch-workspaces", async () => {
      return getDb()
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slackTeamId: workspaces.slackTeamId,
          slackBotUserId: workspaces.slackBotUserId,
        })
        .from(workspaces)
        .where(eq(workspaces.isActive, true));
    });

    if (workspacesData.length === 0) return { processed: 0 };

    let totalUpdates = 0;

    // Step 2: For each workspace, check integrations for changes
    for (const workspace of workspacesData) {
      const updates = await step.run(`check-${workspace.id.slice(0, 8)}`, async () => {
        const workspaceUpdates: string[] = [];

        // Check GitHub integrations
        const githubIntegrations = await getDb()
          .select()
          .from(integrations)
          .where(and(
            eq(integrations.workspaceId, workspace.id),
            eq(integrations.provider, "github"),
            eq(integrations.status, "active"),
          ))
          .limit(1);

        if (githubIntegrations.length > 0) {
          try {
            const { githubListRepos } = await import("@/lib/integrations/clients");
            const repos = await githubListRepos(workspace.id);
            // Filter repos updated in the last 2 hours
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const recentRepos = repos.filter((r: { updatedAt: string }) => {
              if (!r.updatedAt) return false;
              return new Date(r.updatedAt) >= twoHoursAgo;
            });
            if (recentRepos.length > 0) {
              const repoList = recentRepos
                .slice(0, 5)
                .map((r: { name: string; updatedAt: string }) => `• *${r.name}* — updated ${new Date(r.updatedAt).toLocaleTimeString()}`)
                .join("\n");
              workspaceUpdates.push(`*GitHub Activity*\n${recentRepos.length} repo(s) updated recently:\n${repoList}`);
            }
          } catch {
            // GitHub check failed — skip silently
          }
        }

        // Check Google Drive integrations
        const driveIntegrations = await getDb()
          .select()
          .from(integrations)
          .where(and(
            eq(integrations.workspaceId, workspace.id),
            eq(integrations.provider, "google_drive"),
            eq(integrations.status, "active"),
          ))
          .limit(1);

        if (driveIntegrations.length > 0) {
          try {
            const { googleDriveListFiles } = await import("@/lib/integrations/clients");
            const files = await googleDriveListFiles(workspace.id, 10);
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const recentFiles = files.filter((f: { modifiedAt: string }) => {
              if (!f.modifiedAt) return false;
              return new Date(f.modifiedAt) >= twoHoursAgo;
            });
            if (recentFiles.length > 0) {
              const fileList = recentFiles
                .slice(0, 5)
                .map((f: { name: string; modifiedAt: string }) => `• *${f.name}* — modified ${new Date(f.modifiedAt).toLocaleTimeString()}`)
                .join("\n");
              workspaceUpdates.push(`*Google Drive Activity*\n${recentFiles.length} file(s) modified recently:\n${fileList}`);
            }
          } catch {
            // Google Drive check failed — skip silently
          }
        }

        return workspaceUpdates;
      });

      // Step 3: Post updates to Slack if there are any
      if (updates.length > 0) {
        await step.run(`notify-${workspace.id.slice(0, 8)}`, async () => {
          try {
            // Find channels where the bot is a member
            const channels = await slack.conversations.list({
              types: "public_channel,private_channel",
              exclude_archived: true,
              limit: 20,
            });

            const channelIds = ((channels as any).channels || [])
              .filter((ch: any) => ch.is_member)
              .map((ch: any) => ch.id);

            if (channelIds.length === 0) return;

            // Post to the first active channel
            const message = `:pulse: *Klawhub Heartbeat* — ${workspace.name}\n\n${updates.join("\n\n")}\n\n_I monitor your integrations every 30 minutes. Reply with any questions._`;

            await slack.chat.postMessage({
              channel: channelIds[0],
              text: message,
            });

            totalUpdates += updates.length;
          } catch {
            // Slack posting failed — skip
          }
        });
      }
    }

    return { processed: workspacesData.length, updates: totalUpdates };
  }
);
