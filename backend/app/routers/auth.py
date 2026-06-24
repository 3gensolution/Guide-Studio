from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.auth import (
    create_access_token,
    create_refresh_token,
    get_user_by_email,
    hash_password,
    validate_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Request / Response schemas ──


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: str


class RefreshRequest(BaseModel):
    refreshToken: str


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    avatarUrl: str | None = None


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    avatarUrl: str | None = None
    plan: str
    createdAt: str


class AuthResponse(BaseModel):
    user: UserResponse
    tokens: dict


def user_to_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        avatarUrl=user.avatar_url,
        plan=user.plan,
        createdAt=user.created_at.isoformat() if user.created_at else "",
    )


# ── Routes ──


@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, body.email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token, expires_in = create_access_token(str(user.id))
    refresh_token = await create_refresh_token(db, user.id)

    return {
        "user": user_to_response(user),
        "tokens": {
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "expiresIn": expires_in,
        },
    }


@router.post("/signup")
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)):
    existing = await get_user_by_email(db, body.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access_token, expires_in = create_access_token(str(user.id))
    refresh_token = await create_refresh_token(db, user.id)

    return {
        "user": user_to_response(user),
        "tokens": {
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "expiresIn": expires_in,
        },
    }


@router.post("/refresh")
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    user = await validate_refresh_token(db, body.refreshToken)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    access_token, expires_in = create_access_token(str(user.id))
    new_refresh_token = await create_refresh_token(db, user.id)

    return {
        "accessToken": access_token,
        "refreshToken": new_refresh_token,
        "expiresIn": expires_in,
    }


@router.post("/logout")
async def logout(user: User = Depends(get_current_user)):
    return {"success": True}


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return user_to_response(user)


@router.put("/profile")
async def update_profile(
    body: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.name is not None:
        user.name = body.name
    if body.avatarUrl is not None:
        user.avatar_url = body.avatarUrl
    await db.commit()
    await db.refresh(user)
    return user_to_response(user)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.currentPassword, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    user.password_hash = hash_password(body.newPassword)
    await db.commit()
    return {"success": True}
