"""
Proactive schedule loop for KlawHub.

Runs every 15 minutes via Inngest cron to check for due schedules,
standups, reminders, and silence detectors.

Uses the shared inngest_client from `src.core.inngest_client`.
"""
import json
from datetime import datetime, timezone
from src.core.inngest_client import inngest_client
from src.db.operations import execute_query, execute_statement
from src.core.tools.slack_tools import post_slack_message, get_slack_client
from croniter import croniter
import inngest


@inngest_client.create_function(
    fn_id="proactive-schedule-loop",
    trigger=inngest.TriggerCron(cron="*/15 * * * *"),  # Every 15 minutes
)
async def proactive_schedule_loop(ctx: inngest.Context, step: inngest.Step):
    """Checks for due schedules, reminders, and silence detectors and fires them."""

    # 1. Fetch all active schedules where next_run_at <= NOW()
    async def fetch_due_schedules():
        query = "SELECT * FROM schedules WHERE is_active = TRUE AND (next_run_at IS NULL OR next_run_at <= NOW())"
        rows = await execute_query(query)
        return [dict(r) for r in rows]

    due_schedules = await step.run("fetch-due-schedules", fetch_due_schedules)
    if not due_schedules:
        return {"processed": 0}

    processed_count = 0
    for s in due_schedules:
        schedule_id = str(s["id"])
        workspace_id = str(s["workspace_id"])
        schedule_type = s["schedule_type"]
        channel_id = s["channel_id"]
        cron_expr = s.get("cron_expr")
        payload = json.loads(s["payload"]) if isinstance(s.get("payload"), str) else (s.get("payload") or {})

        # 2. Process according to schedule type
        if schedule_type == "standup":
            # Use functools.partial to capture loop variables by value (NOT by reference)
            async def send_standup(ws=workspace_id, ch=channel_id):
                await post_slack_message(
                    workspace_id=ws,
                    channel_id=ch,
                    text=(
                        "⚡ *Daily Standup Time!* Please reply in this thread with:\n"
                        "1️⃣ What you did yesterday\n"
                        "2️⃣ What you're doing today\n"
                        "3️⃣ Any blockers"
                    ),
                )

            await step.run(f"trigger-standup-{schedule_id}", send_standup)

        elif schedule_type == "reminder":
            rem_text = payload.get("text", "Reminder alert!")

            async def send_reminder(ws=workspace_id, ch=channel_id, txt=rem_text):
                await post_slack_message(
                    workspace_id=ws,
                    channel_id=ch,
                    text=f"⏰ *Reminder:* {txt}",
                )

            await step.run(f"trigger-reminder-{schedule_id}", send_reminder)

        elif schedule_type == "silence_detector":
            threshold_hours = int(payload.get("threshold_hours", 24))

            async def check_silence(ws=workspace_id, ch=channel_id, thr=threshold_hours):
                try:
                    slack_client = await get_slack_client(ws)
                    resp = await slack_client.conversations_history(channel=ch, limit=1)
                    if resp.get("ok") and resp.get("messages"):
                        last_ts = float(resp["messages"][0].get("ts", 0))
                        silence_sec = thr * 3600
                        if (datetime.now(timezone.utc).timestamp() - last_ts) > silence_sec:
                            await post_slack_message(
                                workspace_id=ws,
                                channel_id=ch,
                                text=(
                                    "👋 Hey team! It's been a while since the last update. "
                                    "Is there anything I can help research, automate, or summarize today?"
                                ),
                            )
                except Exception as e:
                    print(f"[silence_detector] error: {e}")

            await step.run(f"trigger-silence-{schedule_id}", check_silence)

        # 3. Update next_run_at using croniter
        async def update_times(sid=schedule_id, cron=cron_expr):
            now = datetime.now(timezone.utc)
            next_run = None
            if cron:
                try:
                    next_run = croniter(cron, now).get_next(datetime)
                except Exception:
                    pass
            await execute_statement(
                "UPDATE schedules SET last_run_at = NOW(), next_run_at = $1 WHERE id = $2::uuid",
                next_run, sid
            )

        await step.run(f"update-times-{schedule_id}", update_times)
        processed_count += 1

    return {"processed": processed_count}
