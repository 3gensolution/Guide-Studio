import uuid

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import UserApiKey

# Fernet requires a valid base64-encoded 32-byte key.
# If the configured key isn't valid, we generate one (development only).
try:
    _cipher = Fernet(settings.api_key_encryption_key.encode())
except (ValueError, Exception):
    _cipher = Fernet(Fernet.generate_key())


def encrypt_key(api_key: str) -> str:
    return _cipher.encrypt(api_key.encode()).decode()


def decrypt_key(encrypted: str) -> str | None:
    try:
        return _cipher.decrypt(encrypted.encode()).decode()
    except InvalidToken:
        return None


async def save_user_key(db: AsyncSession, user_id: uuid.UUID, service: str, api_key: str) -> None:
    encrypted = encrypt_key(api_key)

    existing = await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == user_id, UserApiKey.service == service)
    )
    row = existing.scalar_one_or_none()

    if row:
        row.encrypted_key = encrypted
    else:
        db.add(UserApiKey(user_id=user_id, service=service, encrypted_key=encrypted))

    await db.commit()


async def get_user_key(db: AsyncSession, user_id: uuid.UUID, service: str) -> str | None:
    result = await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == user_id, UserApiKey.service == service)
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    return decrypt_key(row.encrypted_key)


async def list_user_services(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    result = await db.execute(
        select(UserApiKey.service).where(UserApiKey.user_id == user_id)
    )
    return [row[0] for row in result.all()]


async def delete_user_key(db: AsyncSession, user_id: uuid.UUID, service: str) -> bool:
    result = await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == user_id, UserApiKey.service == service)
    )
    row = result.scalar_one_or_none()
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True
