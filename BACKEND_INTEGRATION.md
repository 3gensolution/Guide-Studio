# Guide Studio Backend Integration Guide

Complete guide for integrating Guide Studio with your Docker backend.

## Architecture Overview

Guide Studio uses a REST API backend architecture with JWT authentication:

```
Frontend (React + Vite) → API Client → Docker Backend (FastAPI/Express) → AI Services
```

## Quick Start

### 1. Backend Requirements

Your Docker backend must implement these endpoints:

#### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/signup` - User registration
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh access token

#### AI Services
- `POST /api/ai/chat/completion` - Chat completions (GPT-4/DeepSeek)
- `POST /api/ai/tts` - Text-to-speech (ElevenLabs/Fish Audio)
- `POST /api/ai/stt` - Speech-to-text (Whisper/FunASR)
- `POST /api/ai/image/generate` - Image generation
- `POST /api/ai/music/generate` - Music generation
- `POST /api/ai/sfx/generate` - Sound effects
- `POST /api/ai/video/generate` - Video generation
- `GET /api/ai/video/status/:jobId` - Check video status
- `POST /api/ai/captions/generate` - Auto-captions
- `GET /api/ai/models` - List available models
- `GET /api/ai/capabilities` - Get AI capabilities

### 2. Environment Configuration

Update your `.env` file:

```bash
# Backend API URL (your Docker backend)
VITE_API_URL=http://localhost:8000/api

# Optional: API Key for additional security
VITE_API_KEY=your-api-key-here
```

### 3. AI Services Stack

#### Default Stack (Budget-Friendly) ⭐ RECOMMENDED

**Total monthly cost**: ~$3-8 for moderate usage

- **DeepSeek Flash** - Chat/Scripts ($0.07 per 1M tokens)
- **Replicate** - Images ($0.0025 per image)
- **Groq** - Transcription (FREE tier, then cheap)
- **Edge TTS** - Voice (FREE, Microsoft neural voices)
- **Remotion** - Video rendering (FREE, local rendering)

#### Optional Premium Services

Users can add their own API keys for premium features:
- **ElevenLabs** - Voice cloning ($22/month)
- **OpenAI GPT-4** - Premium chat ($10 per 1M tokens)
- **Other models** - Via Replicate marketplace

**See [API_KEYS_GUIDE.md](./API_KEYS_GUIDE.md) for user setup instructions.**

## API Client Implementation

Guide Studio includes a complete API client in `src/lib/api/`:

### Authentication Flow

```typescript
import { authService } from "@/lib/api/auth";

// Login
const result = await authService.login({ email, password });
if (result.success) {
  // Tokens automatically stored in localStorage
  console.log("User:", result.user);
}

// Auto-refresh on 401
// API client handles token refresh automatically
```

### AI Services Usage

```typescript
import { aiService } from "@/lib/api/ai";

// Chat completion (GPT-4 or DeepSeek)
const chat = await aiService.chatCompletion({
  messages: [{ role: "user", content: "Hello" }],
  model: "deepseek-chat" // or "gpt-4"
});

// Text-to-speech (Edge TTS or ElevenLabs)
const tts = await aiService.generateSpeech({
  text: "Hello world",
  voice: "default",
  model: "edge-tts" // or "elevenlabs" if user has API key
});

// Speech-to-text (Groq Whisper)
const stt = await aiService.transcribe({
  audioUrl: "/path/to/audio.mp3",
  language: "en", // Language code
  model: "whisper-large-v3"
});

// Get available models
const models = await aiService.getAvailableModels();
// Returns: { chat: [...], tts: [...], stt: [...], image: [...] }
```

## Backend API Specification

### Authentication Endpoints

#### POST /api/auth/login
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```
Response:
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "tokens": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token"
  }
}
```

#### POST /api/auth/signup
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

#### POST /api/auth/refresh
```json
{
  "refreshToken": "jwt-refresh-token"
}
```
Response:
```json
{
  "accessToken": "new-jwt-access-token",
  "refreshToken": "new-jwt-refresh-token"
}
```

### AI Service Endpoints

#### POST /api/ai/chat/completion
```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant" },
    { "role": "user", "content": "Hello" }
  ],
  "model": "deepseek-chat",
  "temperature": 0.7,
  "maxTokens": 2000
}
```
Response:
```json
{
  "content": "Hello! How can I help you?",
  "usage": {
    "promptTokens": 20,
    "completionTokens": 10,
    "totalTokens": 30
  }
}
```

#### POST /api/ai/tts
```json
{
  "text": "你好世界",
  "voice": "default",
  "model": "fish-audio",
  "speed": 1.0
}
```
Response:
```json
{
  "audioUrl": "https://your-cdn.com/audio/abc123.mp3"
}
```

#### POST /api/ai/stt
```json
{
  "audioUrl": "https://your-cdn.com/audio/recording.mp3",
  "language": "zh",
  "model": "funasr-zh"
}
```
Response:
```json
{
  "text": "转录的文字内容",
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "你好"
    }
  ]
}
```

#### GET /api/ai/models
Response:
```json
{
  "chat": ["deepseek-chat", "qwen-max", "glm-4", "gpt-4"],
  "tts": ["fish-audio", "xtts", "elevenlabs"],
  "stt": ["funasr-zh", "whisper-large-v3"],
  "image": ["sd-xl", "dall-e-3"]
}
```

## Backend Architecture

### Recommended Stack

- **Framework**: FastAPI (Python) or Express (Node.js)
- **Database**: PostgreSQL (user data, projects, API keys)
- **Cache**: Redis (API rate limiting, session cache)
- **Storage**: S3-compatible (audio/video files)
- **AI Services**:
  - Edge TTS (FREE, no API key)
  - Remotion (FREE, local video rendering)
  - User-provided keys: DeepSeek, Replicate, Groq, optional ElevenLabs

### Key Design Principles

1. **User API Keys**: Users provide DeepSeek, Replicate, and Groq keys in app settings
2. **Secure Storage**: Keys encrypted at rest in PostgreSQL
3. **Pay-per-use**: Users only pay for what they use (mostly FREE tier)
4. **Free Services**: Edge TTS (no key), Remotion (local rendering)

### FastAPI Backend Example (User API Keys)

```python
from fastapi import FastAPI, HTTPException, Depends
from openai import OpenAI
import edge_tts
import asyncio

app = FastAPI()

async def get_user_api_keys(user_id: str) -> dict:
    """Fetch encrypted API keys from database for user."""
    # Implement your key retrieval logic
    return {
        "deepseek_key": decrypt(db.get_user_key(user_id, "deepseek")),
        "replicate_key": decrypt(db.get_user_key(user_id, "replicate")),
        "elevenlabs_key": decrypt(db.get_user_key(user_id, "elevenlabs")),  # optional
    }

@app.post("/api/ai/chat/completion")
async def chat_completion(request: ChatRequest, current_user: User = Depends(get_current_user)):
    # Get user's DeepSeek API key
    keys = await get_user_api_keys(current_user.id)

    if not keys["deepseek_key"]:
        raise HTTPException(status_code=400, detail="DeepSeek API key not configured")

    # Use user's key to call DeepSeek
    client = OpenAI(
        api_key=keys["deepseek_key"],
        base_url="https://api.deepseek.com"
    )

    response = client.chat.completions.create(
        model=request.model or "deepseek-flash",
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

@app.post("/api/ai/tts")
async def text_to_speech(request: TTSRequest, current_user: User = Depends(get_current_user)):
    keys = await get_user_api_keys(current_user.id)

    # Default to FREE Edge TTS
    if request.model == "elevenlabs" and keys["elevenlabs_key"]:
        # Use user's ElevenLabs key (premium)
        response = requests.post(
            "https://api.elevenlabs.io/v1/text-to-speech/...",
            headers={"xi-api-key": keys["elevenlabs_key"]},
            json={"text": request.text, "voice_id": request.voice}
        )
        audio_url = upload_to_cdn(response.content)
    else:
        # Use FREE Edge TTS (no key needed)
        communicate = edge_tts.Communicate(request.text, request.voice or "en-US-AriaNeural")
        audio_path = f"/tmp/tts_{uuid.uuid4()}.mp3"
        await communicate.save(audio_path)
        audio_url = upload_to_cdn(audio_path)

    return {"audioUrl": audio_url}

@app.post("/api/ai/image/generate")
async def generate_image(request: ImageRequest, current_user: User = Depends(get_current_user)):
    keys = await get_user_api_keys(current_user.id)

    if not keys["replicate_key"]:
        raise HTTPException(status_code=400, detail="Replicate API token not configured")

    # Use user's Replicate key
    import replicate
    replicate.api_token = keys["replicate_key"]

    output = replicate.run(
        "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        input={
            "prompt": request.prompt,
            "width": request.width or 1024,
            "height": request.height or 1024,
        }
    )

    return {"imageUrl": output[0]}

@app.post("/api/ai/stt")
async def speech_to_text(request: STTRequest, current_user: User = Depends(get_current_user)):
    keys = await get_user_api_keys(current_user.id)

    if not keys["groq_key"]:
        raise HTTPException(status_code=400, detail="Groq API key not configured")

    # Use Groq's Whisper (FREE tier: 14.4k requests/day)
    from groq import Groq
    client = Groq(api_key=keys["groq_key"])

    # Download audio file
    audio_file_path = await download_audio(request.audioUrl)

    with open(audio_file_path, "rb") as audio_file:
        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=audio_file,
            response_format="verbose_json"
        )

    return {
        "text": transcription.text,
        "segments": [
            {
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"]
            }
            for seg in transcription.segments
        ]
    }
```

## Cost Analysis

### User Costs (Pay-per-use with their own API keys)

**Light Usage** (10 videos/month):
- DeepSeek Flash: $0.50
- Replicate Images: $0.25 (100 images)
- Groq Transcription: FREE (within 14.4k requests/day)
- Edge TTS: FREE
- Remotion: FREE (local)
- **Total: ~$0.75/month**

**Moderate Usage** (50 videos/month):
- DeepSeek Flash: $2.50
- Replicate Images: $1.25 (500 images)
- Groq Transcription: FREE
- Edge TTS: FREE
- Remotion: FREE (local)
- **Total: ~$3.75/month**

**Heavy Usage** (200 videos/month):
- DeepSeek Flash: $10
- Replicate Images: $5 (2,000 images)
- Groq Transcription: FREE (or $0.50 if over limit)
- Edge TTS: FREE
- Remotion: FREE (local)
- **Total: ~$15/month**

### Comparison to Premium Services

| Service | Guide Studio | Premium Alternative | Savings |
|---------|--------------|---------------------|---------|
| Chat | DeepSeek Flash: $0.07/1M | GPT-4: $10/1M | 99% cheaper |
| Images | Replicate: $0.0025 | DALL-E: $0.04 | 94% cheaper |
| TTS | Edge TTS: FREE | ElevenLabs: $22/mo | 100% cheaper |
| STT | Groq: FREE | AssemblyAI: $0.37/hr | 100% cheaper |
| Video | Remotion: FREE | Runway: $12/mo | 100% cheaper |

**Monthly savings vs premium stack**: ~$40-50 💰

### Final Stack

```
✅ DeepSeek Flash - Chat ($0.07/1M tokens, 99% cheaper than GPT-4)
✅ Replicate - Images ($0.0025 per image, 94% cheaper than DALL-E)
✅ Groq - Transcription (FREE tier, 14.4k requests/day)
✅ Edge TTS - Voice (FREE, Microsoft neural voices, 400+ voices)
✅ Remotion - Video (FREE, local rendering on user's machine)
```

## Security Considerations

### JWT Token Management
- Access tokens expire in 15 minutes
- Refresh tokens expire in 7 days
- Auto-refresh on 401 responses
- Tokens stored in localStorage (XSS protection required)

### API Security
- Use HTTPS in production
- Implement rate limiting (Redis)
- Validate all inputs server-side
- Use environment variables for API keys
- Never expose API keys to frontend

### CORS Configuration
```python
# FastAPI CORS
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Your Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Testing Your Backend

### Test Authentication
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

### Test Chat Completion
```bash
curl -X POST http://localhost:8000/api/ai/chat/completion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "messages": [{"role":"user","content":"Hello"}],
    "model": "deepseek-chat"
  }'
```

### Test TTS
```bash
curl -X POST http://localhost:8000/api/ai/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "text": "你好世界",
    "voice": "default",
    "model": "fish-audio"
  }'
```

## Frontend Integration

The LoginDialog component is already integrated in Guide Studio. Users will see a login prompt when accessing AI features.

### User Flow
1. User opens Guide Studio
2. User clicks AI feature (narration, captions, etc.)
3. LoginDialog appears if not authenticated
4. User logs in or signs up
5. JWT tokens stored automatically
6. AI features now accessible
7. Token auto-refreshes on expiry

## Resources

- **User Guide**: [API_KEYS_GUIDE.md](./API_KEYS_GUIDE.md) - How users get and configure API keys
- **API Implementation**: `src/lib/api/` - Frontend API client
- **Login UI**: `src/components/auth/LoginDialog.tsx` - Authentication component
- **Environment Config**: `.env.example` - Backend URL configuration
- **Alternative Models**: [CHINESE_AI_MODELS.md](./CHINESE_AI_MODELS.md) - Other options

## Support

For issues with:
- User API setup → See [API_KEYS_GUIDE.md](./API_KEYS_GUIDE.md)
- Frontend integration → Check `src/lib/api/client.ts`
- Authentication → Check `src/lib/api/auth.ts`
- AI services → Check `src/lib/api/ai.ts`
- Backend implementation → Contact your backend team
