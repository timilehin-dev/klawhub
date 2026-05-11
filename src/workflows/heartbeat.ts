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
const CACHE_TTL = 12 * 60 * 1000; // 12 minutes — heartbeat runs every 15 min

export const heartbeatWorkflow = inngest.createFunction(
  { id: "heartbeat", name: "Heartbeat Monitor" },
  { cron: "*/15 * * * *" }, // Every 15 minutes
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
      const checkResult = await step.run(`check-${workspace.id.slice(0, 8)}`, async () => {
        const updates: string[] = [];
        const metadataUpdates: Array<{ integrationId: string; metadata: Record<string, unknown> }> = [];

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
          const integration = githubIntegrations[0];
          const metadata = (integration.metadata as Record<string, unknown>) || {};
          const lastNotifiedAt = metadata.lastNotifiedGitHubAt ? new Date(metadata.lastNotifiedGitHubAt as string) : new Date(0);

          try {
            const { githubListRepos } = await import("@/integrations/clients");
            const repos = await githubListRepos(workspace.id);
            // Find repos updated after lastNotifiedAt
            const newRepos = repos.filter((r: { updatedAt: string }) => {
              if (!r.updatedAt) return false;
              return new Date(r.updatedAt) > lastNotifiedAt;
            });

            if (newRepos.length > 0) {
              const repoList = newRepos
                .slice(0, 5)
                .map((r: { name: string; updatedAt: string }) => `• *${r.name}* — updated ${new Date(r.updatedAt).toLocaleTimeString()}`)
                .join("\n");
              updates.push(`*GitHub Activity*\n${newRepos.length} repo(s) updated recently:\n${repoList}`);

              // Find max updatedAt
              const maxUpdatedAt = newRepos.reduce((max: string, r: { updatedAt: string }) => {
                return new Date(r.updatedAt) > new Date(max) ? r.updatedAt : max;
              }, newRepos[0].updatedAt);

              metadataUpdates.push({
                integrationId: integration.id,
                metadata: {
                  ...metadata,
                  lastNotifiedGitHubAt: maxUpdatedAt,
                },
              });
            }
          } catch (err) {
            console.warn(`[HEARTBEAT] GitHub list repos failed for workspace ${workspace.id}:`, err);
          }
        }

        // Check Google integrations (Drive & Gmail)
        const googleIntegrations = await getDb()
          .select()
          .from(integrations)
          .where(and(
            eq(integrations.workspaceId, workspace.id),
            eq(integrations.provider, "google"),
            eq(integrations.status, "active"),
          ))
          .limit(1);

        if (googleIntegrations.length > 0) {
          const integration = googleIntegrations[0];
          const metadata = (integration.metadata as Record<string, unknown>) || {};
          const lastNotifiedDriveAt = metadata.lastNotifiedDriveAt ? new Date(metadata.lastNotifiedDriveAt as string) : new Date(0);
          const lastNotifiedGmailIds = (metadata.lastNotifiedGmailIds as string[]) || [];

          let hasGoogleUpdates = false;
          let newLastNotifiedDriveAt: string | undefined = undefined;
          let newLastNotifiedGmailIds = [...lastNotifiedGmailIds];

          // Check Google Drive
          try {
            const { googleDriveListFiles } = await import("@/integrations/clients");
            const files = await googleDriveListFiles(workspace.id, 10);
            const newFiles = files.filter((f: { modifiedAt: string }) => {
              if (!f.modifiedAt) return false;
              return new Date(f.modifiedAt) > lastNotifiedDriveAt;
            });

            if (newFiles.length > 0) {
              const fileList = newFiles
                .slice(0, 5)
                .map((f: { name: string; modifiedAt: string }) => `• *${f.name}* — modified ${new Date(f.modifiedAt).toLocaleTimeString()}`)
                .join("\n");
              updates.push(`*Google Drive Activity*\n${newFiles.length} file(s) modified recently:\n${fileList}`);

              // Find max modifiedAt
              newLastNotifiedDriveAt = newFiles.reduce((max: string, f: { modifiedAt: string }) => {
                return new Date(f.modifiedAt) > new Date(max) ? f.modifiedAt : max;
              }, newFiles[0].modifiedAt);
              hasGoogleUpdates = true;
            }
          } catch (err) {
            console.warn(`[HEARTBEAT] Google Drive list files failed for workspace ${workspace.id}:`, err);
          }

          // Check Gmail
          try {
            const { gmailListMessages } = await import("@/integrations/clients");
            const emails = await gmailListMessages(workspace.id, 10, "is:unread");
            
            // Filter out emails we have already notified
            const newEmails = emails.filter((e: { id: string }) => !lastNotifiedGmailIds.includes(e.id));

            if (newEmails.length > 0) {
              const emailList = newEmails
                .slice(0, 3)
                .map((m: any) => `• *From:* ${m.from}\n  *Subject:* ${m.subject}\n  *Snippet:* ${m.snippet}`)
                .join("\n");
              updates.push(`*Gmail Activity*\n${newEmails.length} new unread email(s):\n${emailList}`);

              // Append new email IDs
              const newIds = newEmails.map((e: { id: string }) => e.id);
              newLastNotifiedGmailIds = [...newIds, ...newLastNotifiedGmailIds].slice(0, 100);
              hasGoogleUpdates = true;
            }
          } catch (err) {
            console.warn(`[HEARTBEAT] Gmail list messages failed for workspace ${workspace.id}:`, err);
          }

          if (hasGoogleUpdates) {
            metadataUpdates.push({
              integrationId: integration.id,
              metadata: {
                ...metadata,
                ...(newLastNotifiedDriveAt ? { lastNotifiedDriveAt: newLastNotifiedDriveAt } : {}),
                lastNotifiedGmailIds: newLastNotifiedGmailIds,
              },
            });
          }
        }

        return { updates, metadataUpdates };
      });

      // Step 3: Post updates to Slack if there are any
      if (checkResult.updates.length > 0) {
        await step.run(`notify-${workspace.id.slice(0, 8)}`, async () => {
          try {
            // Dedup check: skip if we already posted for this workspace recently
            const lastPost = lastUpdateCache.get(workspace.id);
            if (lastPost && Date.now() - lastPost < CACHE_TTL) {
              return;
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
            const message = `:pulse: *Klawhub Heartbeat* — ${workspace.name}\n\n${checkResult.updates.join("\n\n")}\n\n_I monitor your integrations. Reply with any questions._`;

            await wsSlack.chat.postMessage({
              channel: memberChannels[0],
              text: message,
            });

            // On success: Update integration metadata in DB to persist watermarks
            for (const item of checkResult.metadataUpdates) {
              await getDb()
                .update(integrations)
                .set({ metadata: item.metadata, updatedAt: new Date() })
                .where(eq(integrations.id, item.integrationId));
            }

            // Mark as posted in ephemeral cache
            lastUpdateCache.set(workspace.id, Date.now());
            totalUpdates += checkResult.updates.length;
          } catch (err) {
            console.error(`[HEARTBEAT] Failed to post message for workspace ${workspace.id}:`, err);
          }
        });
      }
    }

    return { processed: workspacesData.length, updates: totalUpdates };
  }
);
