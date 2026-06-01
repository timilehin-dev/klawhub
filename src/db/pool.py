import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlmodel import SQLModel
from src.config import settings

logger = logging.getLogger("klawhub.db")

import urllib.parse

# Automatically translate postgres:// to postgresql+asyncpg:// for asyncpg driver support
db_url = settings.database_url

# Parse and remove 'pgbouncer' parameter from query string if present (causes asyncpg connection crash)
if "sqlite" not in db_url:
    try:
        parsed_url = urllib.parse.urlparse(db_url)
        query_params = urllib.parse.parse_qsl(parsed_url.query)
        filtered_params = [p for p in query_params if p[0] != "pgbouncer"]
        new_query = urllib.parse.urlencode(filtered_params)
        parsed_url = parsed_url._replace(query=new_query)
        db_url = urllib.parse.urlunparse(parsed_url)
    except Exception as e:
        logger.warning(f"Failed to filter pgbouncer parameter from DATABASE_URL: {e}")

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

logger.info("Initializing asynchronous database connection pool...")

# Create the resilient async engine
if "sqlite" in db_url:
    async_engine = create_async_engine(
        db_url,
        echo=False
    )
else:
    async_engine = create_async_engine(
        db_url,
        echo=False,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args={"statement_cache_size": 0}
    )


# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager providing a safe, isolated database session transaction."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            logger.warning(f"Database transaction encountered an error and was rolled back: {e}")
            raise e
        finally:
            await session.close()

async def init_db_models() -> None:
    """Utility to initialize database schemas.
    
    Note: Supabase migration handles table creation, but this is a helpful local baseline.
    """
    async with async_engine.begin() as conn:
        logger.info("Verifying database models schema...")
        db_dialect = conn.dialect.name
        if db_dialect == "postgresql":
            logger.info("Executing PostgreSQL schema evolution for multi-tenant skills...")
            # Enable pgvector extension
            await conn.execute(text('CREATE EXTENSION IF NOT EXISTS vector;'))
            # Add columns if they do not exist
            await conn.execute(text('ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "workspace_id" UUID REFERENCES workspaces(id) ON DELETE CASCADE;'))
            await conn.execute(text('ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "repo_url" TEXT;'))
            await conn.execute(text('ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "file_path" TEXT;'))
            await conn.execute(text('ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "entrypoint" TEXT DEFAULT \'handler\';'))
            await conn.execute(text('ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "source_code" TEXT DEFAULT \'\';'))
            await conn.execute(text('ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "dependencies" TEXT;'))
            
            # Drop old unique constraint on name alone
            await conn.execute(text('ALTER TABLE "skills" DROP CONSTRAINT IF EXISTS "skills_name_key" CASCADE;'))
            await conn.execute(text('DROP INDEX IF EXISTS "skills_name_key" CASCADE;'))
            
            # Create new indices
            await conn.execute(text('CREATE INDEX IF NOT EXISTS "idx_skills_workspace_id" ON "skills" ("workspace_id");'))
            await conn.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS "idx_skills_workspace_name" ON "skills" ("workspace_id", "name");'))
            logger.info("PostgreSQL schema evolution completed successfully.")
        else:
            logger.info("SQLite database detected. Schema verification complete.")

