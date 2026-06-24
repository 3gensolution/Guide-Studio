# Guide Studio Backend Setup

Quick reference for backend implementation.

## Architecture

```
User's Browser (Guide Studio)
    ↓ (User inputs API keys in settings)
Your Backend API
    ↓ (Stores encrypted keys in PostgreSQL)
AI Services (using user's keys)
    ├─ DeepSeek Flash (user's key)
    ├─ Replicate (user's key)
    ├─ Groq Whisper (user's key, FREE tier)
    ├─ Edge TTS (FREE, no key)
    └─ Remotion (FREE, local rendering)
```

## What You Need to Build

### 1. User API Key Management

**Database Schema**:
```sql
CREATE TABLE user_api_keys (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    service VARCHAR(50), -- 'deepseek', 'replicate', 'groq', 'elevenlabs'
    encrypted_key TEXT,  -- Use AES-256 encryption
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(user_id, service)
);
```

**Endpoints**:
- `POST /api/settings/keys` - Save user's API key
- `GET /api/settings/keys` - List configured services (not the keys!)
- `DELETE /api/settings/keys/:service` - Remove a key

### 2. AI Service Proxy Endpoints

All endpoints use the **current user's API keys** from database:

```
POST /api/ai/chat/completion     → DeepSeek (user's key)
POST /api/ai/image/generate      → Replicate (user's key)
POST /api/ai/stt                 → Groq Whisper (user's key, FREE tier)
POST /api/ai/tts                 → Edge TTS (free) or ElevenLabs (user's key)
GET  /api/ai/models              → List available models
```

### 3. Free Services

**Edge TTS** (No setup needed):
```bash
pip install edge-tts
```

**Remotion** (Already integrated):
- Video rendering happens locally on user's machine
- No backend setup needed
- Just return video composition data to frontend

## Implementation Example

### User Key Storage

```python
from cryptography.fernet import Fernet

class KeyManager:
    def __init__(self, encryption_key: str):
        self.cipher = Fernet(encryption_key)

    async def save_key(self, user_id: str, service: str, api_key: str):
        encrypted = self.cipher.encrypt(api_key.encode())
        await db.execute(
            "INSERT INTO user_api_keys (user_id, service, encrypted_key) VALUES ($1, $2, $3) ON CONFLICT (user_id, service) DO UPDATE SET encrypted_key = $3",
            user_id, service, encrypted.decode()
        )

    async def get_key(self, user_id: str, service: str) -> str | None:
        row = await db.fetchone(
            "SELECT encrypted_key FROM user_api_keys WHERE user_id = $1 AND service = $2",
            user_id, service
        )
        if row:
            return self.cipher.decrypt(row["encrypted_key"].encode()).decode()
        return None
```

### Chat Completion Endpoint

```python
@app.post("/api/ai/chat/completion")
async def chat_completion(
    request: ChatRequest,
    current_user: User = Depends(get_current_user)
):
    # Get user's DeepSeek key
    api_key = await key_manager.get_key(current_user.id, "deepseek")
    if not api_key:
        raise HTTPException(400, "DeepSeek API key not configured. Please add it in Settings.")

    # Call DeepSeek with user's key
    client = OpenAI(
        api_key=api_key,
        base_url="https://api.deepseek.com"
    )

    try:
        response = client.chat.completions.create(
            model="deepseek-flash",  # Cheaper, faster
            messages=request.messages,
            temperature=request.temperature or 0.7
        )

        return {
            "content": response.choices[0].message.content,
            "usage": {
                "promptTokens": response.usage.prompt_tokens,
                "completionTokens": response.usage.completion_tokens,
                "totalTokens": response.usage.total_tokens
            }
        }
    except Exception as e:
        if "invalid_api_key" in str(e):
            raise HTTPException(400, "Invalid DeepSeek API key. Please check your settings.")
        raise HTTPException(500, f"DeepSeek error: {str(e)}")
```

### Image Generation Endpoint

```python
@app.post("/api/ai/image/generate")
async def generate_image(
    request: ImageRequest,
    current_user: User = Depends(get_current_user)
):
    # Get user's Replicate token
    api_token = await key_manager.get_key(current_user.id, "replicate")
    if not api_token:
        raise HTTPException(400, "Replicate API token not configured. Please add it in Settings.")

    # Call Replicate with user's token
    import replicate
    client = replicate.Client(api_token=api_token)

    try:
        output = client.run(
            "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
            input={
                "prompt": request.prompt,
                "width": request.width or 1024,
                "height": request.height or 1024,
                "num_outputs": 1
            }
        )

        # Upload to your CDN/storage
        image_url = await upload_to_cdn(output[0])
        return {"imageUrl": image_url}

    except Exception as e:
        if "authentication" in str(e).lower():
            raise HTTPException(400, "Invalid Replicate API token. Please check your settings.")
        raise HTTPException(500, f"Replicate error: {str(e)}")
```

### Speech-to-Text Endpoint (Groq Whisper - FREE tier)

```python
@app.post("/api/ai/stt")
async def speech_to_text(
    request: STTRequest,
    current_user: User = Depends(get_current_user)
):
    # Get user's Groq API key
    api_key = await key_manager.get_key(current_user.id, "groq")
    if not api_key:
        raise HTTPException(400, "Groq API key not configured. Please add it in Settings.")

    # Use Groq's Whisper (FREE tier: 14,400 requests/day)
    from groq import Groq
    client = Groq(api_key=api_key)

    try:
        # Download audio file if URL provided
        audio_file_path = await download_audio(request.audioUrl)

        with open(audio_file_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=audio_file,
                response_format="verbose_json",
                language=request.language or "en"
            )

        return {
            "text": transcription.text,
            "segments": [
                {
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg["text"]
                }
                for seg in transcription.segments or []
            ]
        }
    except Exception as e:
        if "authentication" in str(e).lower():
            raise HTTPException(400, "Invalid Groq API key. Please check your settings.")
        raise HTTPException(500, f"Groq transcription error: {str(e)}")
```

### TTS Endpoint (Free Edge TTS)

```python
import edge_tts
import asyncio

@app.post("/api/ai/tts")
async def text_to_speech(
    request: TTSRequest,
    current_user: User = Depends(get_current_user)
):
    # Check if user wants ElevenLabs (optional)
    if request.model == "elevenlabs":
        api_key = await key_manager.get_key(current_user.id, "elevenlabs")
        if api_key:
            return await elevenlabs_tts(request, api_key)

    # Default: FREE Edge TTS
    voice = request.voice or "en-US-AriaNeural"
    communicate = edge_tts.Communicate(request.text, voice)

    # Save to temp file
    audio_path = f"/tmp/tts_{uuid.uuid4()}.mp3"
    await communicate.save(audio_path)

    # Upload to CDN
    audio_url = await upload_to_cdn(audio_path)
    os.remove(audio_path)

    return {"audioUrl": audio_url}
```

### Available Voices Endpoint

```python
@app.get("/api/ai/tts/voices")
async def get_available_voices():
    """Return list of free Edge TTS voices."""
    voices = await edge_tts.list_voices()

    return {
        "voices": [
            {
                "id": v["ShortName"],
                "name": v["FriendlyName"],
                "locale": v["Locale"],
                "gender": v["Gender"]
            }
            for v in voices
            if v["Locale"].startswith("en-")  # Filter to English for now
        ]
    }
```

## Environment Variables

Your backend only needs:

```bash
# Database
DATABASE_URL=postgresql://...

# Encryption key for API keys (generate with: openai.fernet.generate_key())
API_KEY_ENCRYPTION_KEY=your-32-byte-key-here

# Storage (for audio/video files)
S3_BUCKET=your-bucket
S3_ACCESS_KEY=...
S3_SECRET_KEY=...

# Optional: Your own analytics/monitoring
SENTRY_DSN=...
```

**What you DON'T need**:
- ❌ DeepSeek API key (users provide their own)
- ❌ Replicate token (users provide their own)
- ❌ ElevenLabs key (users provide their own, optional)
- ❌ OpenAI key (Edge TTS is free)

## Security Checklist

- [ ] API keys encrypted with AES-256 in database
- [ ] Rate limiting per user (100 requests/minute)
- [ ] JWT tokens with 15-min expiry
- [ ] HTTPS only in production
- [ ] CORS restricted to your domain
- [ ] Input validation on all endpoints
- [ ] Cost tracking per user (tokens, images generated)
- [ ] Spending limits per user (optional)

## Testing

### Test Edge TTS
```bash
curl -X POST http://localhost:8000/api/ai/tts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world",
    "voice": "en-US-AriaNeural",
    "model": "edge-tts"
  }'
```

### Test Chat (with user's DeepSeek key)
```bash
curl -X POST http://localhost:8000/api/ai/chat/completion \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"Hello"}],
    "model": "deepseek-flash"
  }'
```

### Test Image (with user's Replicate token)
```bash
curl -X POST http://localhost:8000/api/ai/image/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset",
    "width": 1024,
    "height": 1024
  }'
```

## Cost Tracking (Optional)

Track user spending for transparency:

```python
@app.get("/api/usage/stats")
async def get_usage_stats(current_user: User = Depends(get_current_user)):
    stats = await db.fetchone("""
        SELECT
            SUM(CASE WHEN service = 'deepseek' THEN tokens ELSE 0 END) as chat_tokens,
            SUM(CASE WHEN service = 'replicate' THEN 1 ELSE 0 END) as images_generated,
            SUM(CASE WHEN service = 'tts' THEN characters ELSE 0 END) as tts_characters
        FROM usage_logs
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
    """, current_user.id)

    return {
        "chat": {
            "tokens": stats["chat_tokens"],
            "estimated_cost": stats["chat_tokens"] / 1_000_000 * 0.07  # $0.07 per 1M
        },
        "images": {
            "count": stats["images_generated"],
            "estimated_cost": stats["images_generated"] * 0.0025
        },
        "tts": "FREE (Edge TTS)"
    }
```

## Docker Compose Example

```yaml
version: '3.8'

services:
  # Your API backend
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/guidestudio
      - API_KEY_ENCRYPTION_KEY=${API_KEY_ENCRYPTION_KEY}
    depends_on:
      - postgres
      - redis

  # Database
  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=guidestudio
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Cache
  redis:
    image: redis:7

volumes:
  postgres_data:
```

## Resources

- **User Setup**: [API_KEYS_GUIDE.md](./API_KEYS_GUIDE.md) - Share with users
- **Frontend API**: [src/lib/api/](./src/lib/api/) - TypeScript client
- **Integration Guide**: [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md)

## Need Help?

- DeepSeek API: https://platform.deepseek.com/docs
- Replicate API: https://replicate.com/docs
- Edge TTS: https://github.com/rany2/edge-tts
- Whisper: https://github.com/openai/whisper
