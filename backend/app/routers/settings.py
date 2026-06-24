from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.key_manager import delete_user_key, list_user_services, save_user_key

router = APIRouter(prefix="/settings", tags=["settings"])


class SaveKeyRequest(BaseModel):
    service: str
    apiKey: str


@router.post("/keys")
async def save_key(
    body: SaveKeyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    allowed_services = {"deepseek", "replicate", "groq", "elevenlabs", "openai", "minimax"}
    if body.service not in allowed_services:
        raise HTTPException(status_code=400, detail=f"Unknown service: {body.service}")

    await save_user_key(db, user.id, body.service, body.apiKey)
    return {"success": True}


@router.get("/keys")
async def list_keys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    services = await list_user_services(db, user.id)
    return {"services": services}


@router.delete("/keys/{service}")
async def remove_key(
    service: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deleted = await delete_user_key(db, user.id, service)
    if not deleted:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"success": True}
