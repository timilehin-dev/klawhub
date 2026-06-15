"""
Inngest workflow handler for OAuth integrations.

Handles the `integration/authenticated` event dispatched by the Go OAuth handlers.
Encrypts the access token and stores it in the Supabase `integrations` table.
"""
import json
import inngest
from src.core.inngest_client import inngest_client
from src.core.security.encryptor import encryptor
from src.db.operations import execute_statement, execute_query


@inngest_client.create_function(
    fn_id="handle-integration-authenticated",
    trigger=inngest.TriggerEvent(event="integration/authenticated"),
)
async def handle_integration_authenticated(ctx: inngest.Context, step: inngest.Step):
    """Encrypts and stores OAuth tokens for Google/GitHub integrations."""
    data = ctx.event.data

    workspace_id = data.get("workspace_id")
    provider = data.get("provider")
    raw_token_data = data.get("access_token")
    email = data.get("email", "unknown@unknown.com")

    if not workspace_id or not provider or not raw_token_data:
        return {"status": "failed", "reason": "Missing required fields"}

    async def store_token():
        # The access_token from the Go handler is a JSON string of token details
        if isinstance(raw_token_data, str):
            token_json = json.loads(raw_token_data)
        else:
            token_json = raw_token_data

        # Extract the actual access token from the token JSON
        access_token = token_json.get("access_token", raw_token_data)

        # Encrypt the access token
        encrypted_token = encryptor.encrypt(access_token)

        # Upsert the integration record
        await execute_statement(
            """
            INSERT INTO integrations (workspace_id, provider, access_token, email)
            VALUES ($1::uuid, $2, $3, $4)
            ON CONFLICT (workspace_id, provider)
            DO UPDATE SET access_token = EXCLUDED.access_token, email = EXCLUDED.email, updated_at = NOW()
            """,
            workspace_id, provider, encrypted_token, email
        )

        # If there's a refresh token, store it too
        if "refresh_token" in token_json:
            encrypted_refresh = encryptor.encrypt(token_json["refresh_token"])
            await execute_statement(
                """
                UPDATE integrations SET refresh_token = $2, expires_at = $3
                WHERE workspace_id = $1::uuid AND provider = $4
                """,
                workspace_id, encrypted_refresh, token_json.get("expires_at"), provider
            )

        return {"provider": provider, "email": email}

    result = await step.run("store-integration-token", store_token)
    return {"status": "success", "integration": result}