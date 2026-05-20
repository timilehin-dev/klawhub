import os
import sys
import asyncio

# Ensure project root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

def load_env():
    # Set default mock values for fields that aren't needed for DB migration but required by Settings schema
    os.environ.setdefault("UPSTASH_REDIS_REST_URL", "https://mock-redis.upstash.io")
    os.environ.setdefault("UPSTASH_REDIS_REST_TOKEN", "mock_token")
    os.environ.setdefault("SLACK_SIGNING_SECRET", "mock_slack_signing_secret")
    os.environ.setdefault("SLACK_BOT_TOKEN", "xoxb-mock-bot-token")
    os.environ.setdefault("INTEGRATION_ENCRYPTION_KEY", "mock_integration_encryption_key_32_bytes!!")
    os.environ.setdefault("STATE_SIGNING_KEY", "test_state_signing_key_secure_12345")
    
    env_path = ".env.local"
    if os.path.exists(env_path):
        print(f"Loading env from {env_path}...")
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    os.environ[k] = v # This overrides process defaults with real .env.local values
    else:
        print("No .env.local found, using process environment.")

async def main():
    load_env()
    from src.db.pool import init_db_models
    print("Starting database schema evolution...")
    await init_db_models()
    print("Database schema evolution completed successfully!")

if __name__ == "__main__":
    asyncio.run(main())
