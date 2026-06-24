import os
import uuid as uuid_mod

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.key_manager import get_user_key

router = APIRouter(prefix="/ai", tags=["ai"])


# ── Request schemas ──


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    messages: list[ChatMessage]
    model: str | None = "deepseek-chat"
    temperature: float | None = 0.7
    maxTokens: int | None = 2000


class TTSRequest(BaseModel):
    text: str
    voice: str | None = "en-US-AriaNeural"
    model: str | None = "edge-tts"
    speed: float | None = 1.0


class STTRequest(BaseModel):
    audioUrl: str
    language: str | None = "en"
    model: str | None = "whisper-large-v3"


class ImageGenerationRequest(BaseModel):
    prompt: str
    negativePrompt: str | None = None
    model: str | None = "sdxl"
    width: int | None = 1024
    height: int | None = 1024


class MusicGenerationRequest(BaseModel):
    prompt: str
    duration: int | None = 30
    genre: str | None = None
    mood: str | None = None


class SFXRequest(BaseModel):
    prompt: str
    duration: float | None = None


class VideoGenerationRequest(BaseModel):
    prompt: str
    imageUrl: str | None = None
    duration: int | None = 4
    fps: int | None = 24
    width: int | None = 1280
    height: int | None = 720


class CaptionsRequest(BaseModel):
    audioUrl: str
    language: str | None = "en"


class VideoAnalyzeRequest(BaseModel):
    videoUrl: str


# ── Routes ──


@router.get("/capabilities")
async def get_capabilities():
    return {
        "textGeneration": {
            "chatCompletion": True,
            "streaming": False,
            "functionCalling": False,
            "vision": False,
        },
        "speech": {
            "textToSpeech": True,
            "speechToText": True,
            "voiceCloning": False,
            "audioGeneration": True,
        },
        "vision": {
            "imageGeneration": True,
            "imageToImage": False,
            "imageAnalysis": False,
            "backgroundRemoval": False,
        },
        "video": {
            "videoGeneration": False,
            "videoToVideo": False,
            "motionTracking": False,
            "sceneDetection": False,
        },
        "animation": {
            "lottieGeneration": False,
            "animationGeneration": False,
        },
    }


@router.get("/models")
async def get_models():
    return {
        "chat": ["deepseek-chat", "deepseek-flash"],
        "tts": ["edge-tts"],
        "stt": ["whisper-large-v3"],
        "image": ["sdxl"],
    }


@router.post("/chat/completion")
async def chat_completion(
    body: ChatCompletionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    api_key = await get_user_key(db, user.id, "deepseek")
    if not api_key:
        raise HTTPException(status_code=400, detail="DeepSeek API key not configured. Please add it in Settings.")

    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")

    try:
        response = client.chat.completions.create(
            model=body.model or "deepseek-chat",
            messages=[{"role": m.role, "content": m.content} for m in body.messages],
            temperature=body.temperature or 0.7,
            max_tokens=body.maxTokens or 2000,
        )
        return {
            "content": response.choices[0].message.content,
            "usage": {
                "promptTokens": response.usage.prompt_tokens,
                "completionTokens": response.usage.completion_tokens,
                "totalTokens": response.usage.total_tokens,
            },
        }
    except Exception as e:
        if "invalid_api_key" in str(e).lower() or "authentication" in str(e).lower():
            raise HTTPException(status_code=400, detail="Invalid DeepSeek API key. Please check your settings.")
        raise HTTPException(status_code=500, detail=f"DeepSeek error: {str(e)}")


@router.post("/tts")
async def text_to_speech(
    body: TTSRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Check for ElevenLabs preference
    if body.model == "elevenlabs":
        api_key = await get_user_key(db, user.id, "elevenlabs")
        if api_key:
            # Use ElevenLabs (premium, user-provided key)
            import httpx

            voice_id = body.voice or "21m00Tcm4TlvDq8ikWAM"
            async with httpx.AsyncClient() as http:
                resp = await http.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                    headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                    json={"text": body.text, "model_id": "eleven_monolingual_v1"},
                    timeout=60,
                )
                if resp.status_code != 200:
                    raise HTTPException(status_code=resp.status_code, detail="ElevenLabs TTS failed")

                filename = f"tts_{uuid_mod.uuid4()}.mp3"
                filepath = os.path.join(settings.upload_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(resp.content)

                return {"audioUrl": f"/uploads/{filename}"}

    # Default: FREE Edge TTS
    import edge_tts

    voice = body.voice or "en-US-AriaNeural"
    communicate = edge_tts.Communicate(body.text, voice)

    filename = f"tts_{uuid_mod.uuid4()}.mp3"
    filepath = os.path.join(settings.upload_dir, filename)
    await communicate.save(filepath)

    return {"audioUrl": f"/uploads/{filename}"}


@router.post("/stt")
async def speech_to_text(
    body: STTRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # User key first, then server-side fallback
    api_key = await get_user_key(db, user.id, "groq") or settings.groq_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="Groq API key not configured. Please add it in Settings.")

    from groq import Groq

    client = Groq(api_key=api_key)

    try:
        # Download the audio if it's a URL
        import httpx

        audio_path = os.path.join(settings.upload_dir, f"stt_{uuid_mod.uuid4()}.mp3")
        async with httpx.AsyncClient() as http:
            resp = await http.get(body.audioUrl, timeout=60)
            with open(audio_path, "wb") as f:
                f.write(resp.content)

        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=audio_file,
                response_format="verbose_json",
                language=body.language or "en",
            )

        os.remove(audio_path)

        return {
            "text": transcription.text,
            "segments": [
                {"start": seg.start, "end": seg.end, "text": seg.text}
                for seg in (transcription.segments or [])
            ],
        }
    except Exception as e:
        if "authentication" in str(e).lower():
            raise HTTPException(status_code=400, detail="Invalid Groq API key.")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")


@router.post("/image/generate")
async def generate_image(
    body: ImageGenerationRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # User key first, then server-side fallback
    api_key = await get_user_key(db, user.id, "replicate") or settings.replicate_api_token
    if not api_key:
        raise HTTPException(status_code=400, detail="Replicate API token not configured. Please add it in Settings.")

    import replicate

    client = replicate.Client(api_token=api_key)

    try:
        output = client.run(
            "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
            input={
                "prompt": body.prompt,
                "negative_prompt": body.negativePrompt or "",
                "width": body.width or 1024,
                "height": body.height or 1024,
                "num_outputs": 1,
            },
        )
        image_url = output[0] if isinstance(output, list) else str(output)
        return {"imageUrl": image_url}
    except Exception as e:
        if "authentication" in str(e).lower():
            raise HTTPException(status_code=400, detail="Invalid Replicate API token.")
        raise HTTPException(status_code=500, detail=f"Image generation error: {str(e)}")


@router.post("/music/generate")
async def generate_music(
    body: MusicGenerationRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Placeholder - connect to your preferred music generation service
    raise HTTPException(status_code=501, detail="Music generation not yet configured. Connect a service in Settings.")


@router.post("/sfx/generate")
async def generate_sfx(
    body: SFXRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Placeholder - connect to ElevenLabs SFX or similar
    api_key = await get_user_key(db, user.id, "elevenlabs")
    if not api_key:
        raise HTTPException(status_code=400, detail="ElevenLabs API key not configured for SFX generation.")

    raise HTTPException(status_code=501, detail="SFX generation endpoint - implement with ElevenLabs SFX API")


@router.post("/video/generate")
async def generate_video(
    body: VideoGenerationRequest,
    user: User = Depends(get_current_user),
):
    # Placeholder for video generation (Runway, Pika, etc.)
    raise HTTPException(status_code=501, detail="Video generation not yet configured.")


@router.get("/video/status/{job_id}")
async def check_video_status(job_id: str, user: User = Depends(get_current_user)):
    # Placeholder for async video job status
    return {"status": "pending", "videoUrl": None}


@router.get("/lottie/search")
async def search_lottie(q: str = ""):
    # Placeholder for Lottie search
    return {"results": []}


@router.post("/captions/generate")
async def generate_captions(
    body: CaptionsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # User key first, then server-side fallback
    api_key = await get_user_key(db, user.id, "groq") or settings.groq_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="Groq API key not configured.")

    from groq import Groq

    client = Groq(api_key=api_key)

    try:
        import httpx

        audio_path = os.path.join(settings.upload_dir, f"caption_{uuid_mod.uuid4()}.mp3")
        async with httpx.AsyncClient() as http:
            resp = await http.get(body.audioUrl, timeout=60)
            with open(audio_path, "wb") as f:
                f.write(resp.content)

        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=audio_file,
                response_format="verbose_json",
                language=body.language or "en",
            )

        os.remove(audio_path)

        return {
            "segments": [
                {"start": seg.start, "end": seg.end, "text": seg.text}
                for seg in (transcription.segments or [])
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Caption generation error: {str(e)}")


@router.post("/video/analyze")
async def analyze_video(body: VideoAnalyzeRequest, user: User = Depends(get_current_user)):
    # Placeholder for video analysis
    raise HTTPException(status_code=501, detail="Video analysis not yet configured.")


@router.get("/usage")
async def get_usage(
    start: str | None = None,
    end: str | None = None,
    user: User = Depends(get_current_user),
):
    # Placeholder for usage tracking
    return []


@router.get("/tts/voices")
async def get_tts_voices():
    """Return available Edge TTS voices."""
    import edge_tts

    voices = await edge_tts.list_voices()
    return {
        "voices": [
            {
                "id": v["ShortName"],
                "name": v["FriendlyName"],
                "locale": v["Locale"],
                "gender": v["Gender"],
            }
            for v in voices
            if v["Locale"].startswith("en-")
        ]
    }
