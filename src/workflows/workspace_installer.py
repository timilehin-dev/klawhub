"""
Workspace Installer for KlawHub.

Handles the `workspace/install` event dispatched by the Go OAuth handler.
Encrypts the bot token and upserts the workspace row in Supabase.
"""
import inngest
from src.core.inngest_client import inngest_client
from src.core.security.encryptor import encryptor
from src.db.operations import create_workspace, create_workspace_member, seed_builtin_skills


@inngest_client.create_function(
    fn_id="handle-workspace-install",
    trigger=inngest.TriggerEvent(event="workspace/install"),
)
async def handle_workspace_install(ctx: inngest.Context, step: inngest.Step):
    """Encrypts Slack bot token and registers the workspace in Supabase."""
    data = ctx.event.data

    slack_team_id = data.get("slack_team_id")
    slack_team_name = data.get("slack_team_name", "Unknown Workspace")
    raw_bot_token = data.get("bot_token")
    bot_user_id = data.get("bot_user_id")
    authed_user_id = data.get("authed_user_id")

    if not slack_team_id or not raw_bot_token:
        return {"status": "failed", "reason": "Missing required fields"}

    # Encrypt the bot token before storage
    encrypted_token = encryptor.encrypt(raw_bot_token)

    async def upsert_workspace():
        workspace_id = await create_workspace(
            slack_team_id=slack_team_id,
            slack_team_name=slack_team_name,
            bot_token=encrypted_token,
            bot_user_id=bot_user_id or "",
        )
        # Seed the 6 built-in skills out of the box
        await seed_builtin_skills(workspace_id)
        # Register the installing user as admin
        if authed_user_id:
            await create_workspace_member(
                workspace_id=workspace_id,
                slack_user_id=authed_user_id,
                slack_username=authed_user_id,
                role="admin",
            )
        return workspace_id

    workspace_id = await step.run("upsert-workspace", upsert_workspace)
    return {"status": "success", "workspace_id": workspace_id, "team": slack_team_name}
