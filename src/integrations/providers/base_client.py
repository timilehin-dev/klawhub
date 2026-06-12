import logging
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
import httpx
from sqlalchemy import select
from src.db.pool import get_db_session
from src.db.models import Integration
from src.integrations.crypto import decrypt_token, encrypt_token

logger = logging.getLogger("klawhub.integrations.base_client")

class BaseAPIClient(ABC):
    """Abstract Base Client that transparently handles token decryption, routing, and auto-refresh."""
    
    def __init__(self, workspace_id: Any, provider: str, base_url: str):
        # Safely convert string workspace_id to uuid.UUID to prevent db driver mapping failures in asyncpg
        if isinstance(workspace_id, str):
            try:
                self.workspace_id = uuid.UUID(workspace_id)
            except ValueError:
                self.workspace_id = workspace_id
        else:
            self.workspace_id = workspace_id

        self.provider = provider.lower()
        self.base_url = base_url
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.expires_at: Optional[datetime] = None

    async def _load_credentials(self) -> None:
        """Fetches the integration credentials from the database and decrypts them in-memory."""
        integration = None
        async with get_db_session(workspace_id=str(self.workspace_id)) as session:
            statement = select(Integration).where(
                Integration.workspace_id == self.workspace_id,
                Integration.provider == self.provider
            )
            result = await session.execute(statement)
            integration = result.scalar_one_or_none()
            
        if not integration:
            raise ValueError(f"No integration record found for workspace {self.workspace_id} and provider {self.provider}")
            
        self.access_token = decrypt_token(integration.access_token_encrypted)
        self.refresh_token = decrypt_token(integration.refresh_token_encrypted) if integration.refresh_token_encrypted else None
        self.expires_at = integration.expires_at

    async def _update_stored_credentials(self, new_access_token: str, new_refresh_token: Optional[str], expires_in_seconds: Optional[int]) -> None:
        """Encrypts and commits newly refreshed OAuth tokens to the database."""
        async with get_db_session(workspace_id=str(self.workspace_id)) as session:
            statement = select(Integration).where(
                Integration.workspace_id == self.workspace_id,
                Integration.provider == self.provider
            )
            result = await session.execute(statement)
            integration = result.scalar_one_or_none()
            
            if not integration:
                raise ValueError(f"Failed to find integration record during refresh write-back")
            
            # Encrypt new credentials
            integration.access_token_encrypted = encrypt_token(new_access_token)
            if new_refresh_token:
                integration.refresh_token_encrypted = encrypt_token(new_refresh_token)
            
            # Update expiry timestamp using timedelta
            if expires_in_seconds is not None:
                integration.expires_at = datetime.utcnow() + timedelta(seconds=expires_in_seconds)
            else:
                integration.expires_at = None
                
            integration.updated_at = datetime.utcnow()
            
            session.add(integration)
            await session.commit()
            
            # Cache in-memory
            self.access_token = new_access_token
            if new_refresh_token:
                self.refresh_token = new_refresh_token
            self.expires_at = integration.expires_at
            
            logger.info(f"Successfully refreshed and stored credentials for provider: {self.provider}")

    @abstractmethod
    async def refresh_access_token(self) -> Dict[str, Any]:
        """Subclass must implement this to execute its specific provider refresh OAuth flow.
        
        Should return a dictionary containing keys: 'access_token', 'refresh_token' (optional), and 'expires_in' (optional).
        """
        pass

    async def _check_and_refresh_if_expired(self) -> None:
        """Checks if active token is close to expiry or already expired, triggering dynamic auto-refresh."""
        if self.expires_at:
            # Robust Python 3.12+ safe timezone checking
            now = datetime.now(timezone.utc)
            expires_at = self.expires_at
            if expires_at.tzinfo is None:
                now = now.replace(tzinfo=None)
                
            time_left = (expires_at - now).total_seconds()
            
            if time_left < 300: # Less than 5 minutes left
                logger.info(f"Token for {self.provider} is nearing expiration ({int(time_left)}s left). Triggering refresh...")
                await self.force_refresh()

    async def force_refresh(self) -> None:
        """Forces execution of the provider-specific OAuth token refresh flow."""
        if not self.refresh_token:
            logger.warning(f"Unable to refresh provider '{self.provider}': refresh token is missing.")
            return
            
        try:
            refresh_data = await self.refresh_access_token()
            await self._update_stored_credentials(
                new_access_token=refresh_data["access_token"],
                new_refresh_token=refresh_data.get("refresh_token"),
                expires_in_seconds=refresh_data.get("expires_in")
            )
        except Exception as e:
            logger.error(f"Auto token refresh failed for provider '{self.provider}': {str(e)}")
            # Log error into database
            async with get_db_session(workspace_id=str(self.workspace_id)) as session:
                statement = select(Integration).where(
                    Integration.workspace_id == self.workspace_id,
                    Integration.provider == self.provider
                )
                res = await session.execute(statement)
                integration = res.scalar_one_or_none()
                if integration:
                    integration.error_count += 1
                    integration.last_error = f"Refresh failed: {str(e)}"
                    session.add(integration)
                    await session.commit()
            raise e

    async def execute_request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Executes a request to the provider's API with automatic credentials loading and transparent token refresh."""
        # Load and check credentials
        if not self.access_token:
            await self._load_credentials()
            
        await self._check_and_refresh_if_expired()

        headers = kwargs.get("headers", {})
        # Copy to prevent in-place dictionary mutations with side effects
        headers = dict(headers)
        headers["Authorization"] = f"Bearer {self.access_token}"
        kwargs["headers"] = headers

        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        
        async with httpx.AsyncClient() as client:
            response = await client.request(method, url, **kwargs)
            
            # If we get a 401 Unauthorized, try refreshing the token once and retrying
            if response.status_code == 401 and self.refresh_token:
                logger.warning(f"Received 401 Unauthorized from {self.provider} API. Retrying with token refresh...")
                try:
                    await self.force_refresh()
                    # Re-apply updated token
                    headers["Authorization"] = f"Bearer {self.access_token}"
                    kwargs["headers"] = headers
                    
                    # Re-issue request
                    response = await client.request(method, url, **kwargs)
                except Exception as refresh_error:
                    logger.error(f"Token refresh retry flow failed: {str(refresh_error)}")
                    
            return response
