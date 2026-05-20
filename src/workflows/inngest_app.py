import logging
import os
import inngest

logger = logging.getLogger("klawhub.workflows.inngest_app")

# Determine if we are in local development mode
inngest_dev = os.getenv("INNGEST_DEV", "0") == "1"

if inngest_dev:
    logger.info("Initializing Inngest client in local development mode.")
else:
    logger.info("Initializing Inngest client in production mode.")

# Instantiate and export the durable background runner client
inngest_client = inngest.Inngest(
    app_id="klawhub-coworker"
)
