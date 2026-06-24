import secrets
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import RefreshToken, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str) -> tuple[str, int]:
    expires_delta = timedelta(minutes=settings.jwt_access_token_expire_minutes)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {
        "sub": user_id,
        "exp": expire,
        "type": "access",
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return token, int(expires_delta.total_seconds())


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            return None
        return payload.get("sub")
    except JWTError:
        return None


async def create_refresh_token(db: AsyncSession, user_id: uuid.UUID) -> str:
    token = secrets.token_urlsafe(64)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_token_expire_days)
    refresh = RefreshToken(user_id=user_id, token=token, expires_at=expires_at)
    db.add(refresh)
    await db.commit()
    return token


async def validate_refresh_token(db: AsyncSession, token: str) -> User | None:
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token == token,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    refresh = result.scalar_one_or_none()
    if not refresh:
        return None

    result = await db.execute(select(User).where(User.id == refresh.user_id))
    user = result.scalar_one_or_none()

    # Rotate: delete the used token
    await db.delete(refresh)
    await db.commit()

    return user


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    return result.scalar_one_or_none()
