import { inngest } from "./client";
import { getDb } from "@/db/connection";
import { workspaces, workspaceMembers, integrations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getWorkspaceSlack } from "@/integrations/slack/client";

/**
 * Heartbeat workflow — runs every 30 minutes.
 *
 * Checks connected integrations (GitHub, Google Drive) for notable changes
 * and proactively posts updates to Slack channels where the bot is a member.
 *
 * SMART POSTING:
 * - Remembers the last update timestamp per workspace to avoid spam
 * - Only posts to channels where the bot is actively a member
 * - Skips if no changes found since last check
 * - Rate-limited to max 1 post per workspace per heartbeat cycle
 */

// In-memory cache of last update timestamps (survives within a single serverless invocation)
const lastUpdateCache = new Map<string, number>();
const CACHE_TTL = 25 * 60 * 1000; // 25 minutes — heartbeat runs every 30 min

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
            const { githubListRepos } = await import("@/integrations/clients");
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
            const { googleDriveListFiles } = await import("@/integrations/clients");
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
            // Dedup check: skip if we already posted for this workspace recently
            const lastPost = lastUpdateCache.get(workspace.id);
            if (lastPost && Date.now() - lastPost < CACHE_TTL) {
              return; // Skip — already posted recently
            }

            // Use workspace-specific Slack client
            const wsSlack = await getWorkspaceSlack(workspace.slackTeamId);

            // Find channels where the bot is a member
            const channels = await wsSlack.conversations.list({
              types: "public_channel,private_channel",
              exclude_archived: true,
              limit: 100,
            });

            const memberChannels = ((channels as any).channels || [])
              .filter((ch: any) => ch.is_member)
              .map((ch: any) => ch.id);

            if (memberChannels.length === 0) return;

            // Post to the first channel where bot is a member
            // (In future, could be configurable per workspace)
            const message = `:pulse: *Klawhub Heartbeat* — ${workspace.name}\n\n${updates.join("\n\n")}\n\n_I monitor your integrations every 30 minutes. Reply with any questions._`;

            await wsSlack.chat.postMessage({
              channel: memberChannels[0],
              text: message,
            });

            // Mark as posted
            lastUpdateCache.set(workspace.id, Date.now());
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
