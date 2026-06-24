from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import ai, auth, settings as settings_router

app = FastAPI(
    title="Guide Studio API",
    description="Backend API for Guide Studio video editor",
    version="1.0.0",
)

# ── CORS ──
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files (uploaded audio/images) ──
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")

# ── Routers ──
app.include_router(auth.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(ai.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "guide-studio-api"}
