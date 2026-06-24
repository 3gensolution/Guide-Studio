from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/guidestudio"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # JWT
    jwt_secret_key: str = "change-this-to-a-random-secret-key-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 7

    # API Key Encryption
    api_key_encryption_key: str = "change-this-generate-a-real-fernet-key"

    # Server-side AI API keys (fallback when user hasn't configured their own)
    groq_api_key: str = ""
    replicate_api_token: str = ""

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # File uploads
    upload_dir: str = "/app/uploads"
    max_upload_size_mb: int = 100

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
