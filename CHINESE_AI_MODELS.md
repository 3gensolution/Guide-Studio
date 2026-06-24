# Chinese AI Models Integration Guide

## Overview

Guide Studio supports Chinese AI models as cost-effective alternatives to Western models like GPT-4 and ElevenLabs.

## 🇨🇳 Recommended Chinese AI Services

### 1. Chat Models (GPT-4 Alternative)

#### **DeepSeek** (深度求索) - RECOMMENDED ⭐
- **Model:** `deepseek-chat`
- **Cost:** ~$0.14 per 1M tokens (95% cheaper than GPT-4!)
- **Quality:** GPT-4 Turbo level performance
- **API:** OpenAI-compatible
- **Website:** https://platform.deepseek.com

```python
# Backend setup
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",  # DeepSeek API key
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello"}]
)
```

#### **Qwen (通义千问)** - Alibaba
- **Model:** `qwen-max`, `qwen-turbo`
- **Cost:** ~$0.20 per 1M tokens
- **Quality:** Excellent for Chinese, good for English
- **API:** https://help.aliyun.com/zh/dashscope/

#### **Baichuan (百川智能)**
- **Model:** `Baichuan2-Turbo`
- **Cost:** ~$0.15 per 1M tokens
- **Quality:** Good general purpose
- **API:** https://platform.baichuan-ai.com

#### **ChatGLM (智谱清言)** - Tsinghua University
- **Model:** `glm-4`
- **Cost:** ~$0.10 per 1M tokens
- **Quality:** Good for Chinese tasks
- **API:** https://open.bigmodel.cn

### 2. Text-to-Speech (ElevenLabs Alternative)

#### **Fish Audio** (鱼声AI) - RECOMMENDED ⭐
- **Best Chinese TTS quality**
- **Voice cloning support**
- **Emotional speech**
- **Cost:** ~$0.005 per 1000 characters (cheaper than ElevenLabs)
- **Website:** https://fish.audio

```python
# Backend setup
import requests

def fish_audio_tts(text: str, voice_id: str):
    response = requests.post(
        "https://api.fish.audio/v1/tts",
        headers={"Authorization": f"Bearer {FISH_AUDIO_KEY}"},
        json={
            "text": text,
            "voice_id": voice_id,
            "format": "mp3"
        }
    )
    return response.content
```

#### **Azure Speech** (微软语音)
- **Multi-language support** (Chinese + English)
- **Neural voices** (high quality)
- **Cost:** ~$15 per 1M characters
- **Good for mixing Chinese/English**

```python
# Azure Speech SDK
import azure.cognitiveservices.speech as speechsdk

speech_config = speechsdk.SpeechConfig(
    subscription=AZURE_KEY,
    region="eastasia"
)
speech_config.speech_synthesis_voice_name = "zh-CN-XiaoxiaoNeural"

synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)
result = synthesizer.speak_text_async(text).get()
```

#### **Coqui XTTS** - Open Source, FREE
- **Voice cloning**
- **Multi-language**
- **Self-hosted** (runs on GPU)
- **Cost:** FREE (just GPU costs)

```python
# XTTS setup
from TTS.api import TTS

tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
tts.tts_to_file(
    text="你好世界",
    speaker_wav="reference.wav",  # Voice to clone
    language="zh-cn",
    file_path="output.wav"
)
```

### 3. Image Generation

#### **Tencent ARC (腾讯ARC)**
- **High quality** Chinese-style images
- **Website:** https://arc.tencent.com

#### **Alibaba Tongyi Wanxiang (通义万相)**
- **Good for Chinese elements**
- **Integrated with Qwen**
- **Website:** https://tongyi.aliyun.com

#### **Stable Diffusion XL** - Open Source (RECOMMENDED)
- **FREE** (self-hosted)
- **Customizable**
- **Can fine-tune for Chinese styles**

### 4. Speech-to-Text (Whisper Alternative)

#### **Alibaba FunASR (阿里巴巴)**
- **Excellent Chinese accuracy**
- **Open source**
- **FREE** (self-hosted)
- **GitHub:** https://github.com/alibaba-damo-academy/FunASR

```python
# FunASR setup
from funasr import AutoModel

model = AutoModel(model="paraformer-zh")
result = model.generate(input="audio.wav")
print(result[0]["text"])
```

#### **OpenAI Whisper** - Still Good
- **Best multi-language support**
- **Good Chinese accuracy**
- **Can self-host** (FREE)

### 5. Music Generation

#### **Suno AI** - Best Quality
- **Not Chinese but best quality**
- **Can generate Chinese lyrics**
- **Cost:** $10/month

#### **NetEase Music AI (网易云音乐AI)** - Chinese
- **Good for Chinese music styles**
- **Traditional instruments**

## 💰 Cost Comparison

### Chat Models (per 1M tokens)
| Model | Cost | Quality |
|-------|------|---------|
| GPT-4 Turbo | $10.00 | ⭐⭐⭐⭐⭐ |
| **DeepSeek** | **$0.14** | ⭐⭐⭐⭐⭐ |
| Qwen-Max | $0.20 | ⭐⭐⭐⭐ |
| ChatGLM-4 | $0.10 | ⭐⭐⭐⭐ |
| Baichuan2 | $0.15 | ⭐⭐⭐⭐ |

### Text-to-Speech (per 1000 chars)
| Service | Cost | Quality |
|---------|------|---------|
| ElevenLabs | $0.018 | ⭐⭐⭐⭐⭐ |
| **Fish Audio** | **$0.005** | ⭐⭐⭐⭐⭐ |
| Azure Speech | $0.015 | ⭐⭐⭐⭐ |
| **XTTS (self-hosted)** | **FREE** | ⭐⭐⭐⭐ |

## 🐳 Docker Backend Setup

### Recommended Stack (Cost-Effective)

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Your API server
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      # Chinese AI Services
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - FISH_AUDIO_KEY=${FISH_AUDIO_KEY}
      - QWEN_API_KEY=${QWEN_API_KEY}

      # Optional: Western services
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

      # Database
      - DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@postgres:5432/guidestudio

  # Postgres for user data
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: guidestudio
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Redis for caching
  redis:
    image: redis:7

  # Optional: Self-hosted XTTS (voice cloning)
  xtts:
    image: ghcr.io/coqui-ai/xtts-streaming-server:latest
    ports:
      - "8001:8000"
    volumes:
      - xtts_models:/app/models
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  # Optional: Self-hosted Whisper (transcription)
  whisper:
    image: onerahmet/openai-whisper-asr-webservice:latest
    ports:
      - "9000:9000"
    environment:
      - ASR_MODEL=large-v3
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

volumes:
  postgres_data:
  xtts_models:
```

## 📝 Backend Implementation Example

### FastAPI Backend with Chinese Models

```python
# main.py
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from openai import OpenAI
import requests
from funasr import AutoModel
import os

app = FastAPI()

# Initialize clients
deepseek_client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

fish_audio_key = os.getenv("FISH_AUDIO_KEY")

# Optional: FunASR for Chinese STT
funasr_model = AutoModel(model="paraformer-zh")

# Models
class ChatRequest(BaseModel):
    messages: list
    model: str = "deepseek-chat"
    temperature: float = 0.7

class TTSRequest(BaseModel):
    text: str
    voice: str = "default"
    model: str = "fish-audio"

class STTRequest(BaseModel):
    audio_url: str
    language: str = "zh"

# Endpoints
@app.post("/api/ai/chat/completion")
async def chat_completion(request: ChatRequest):
    try:
        response = deepseek_client.chat.completions.create(
            model=request.model,
            messages=request.messages,
            temperature=request.temperature
        )
        return {
            "content": response.choices[0].message.content,
            "usage": response.usage.dict()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai/tts")
async def text_to_speech(request: TTSRequest):
    try:
        if request.model == "fish-audio":
            # Fish Audio TTS
            response = requests.post(
                "https://api.fish.audio/v1/tts",
                headers={"Authorization": f"Bearer {fish_audio_key}"},
                json={
                    "text": request.text,
                    "voice_id": request.voice,
                    "format": "mp3"
                }
            )
            # Save audio and return URL
            audio_url = save_audio(response.content)
            return {"audioUrl": audio_url}
        elif request.model == "xtts":
            # Self-hosted XTTS
            response = requests.post(
                "http://xtts:8000/tts",
                json={"text": request.text, "speaker_wav": request.voice}
            )
            audio_url = save_audio(response.content)
            return {"audioUrl": audio_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai/stt")
async def speech_to_text(request: STTRequest):
    try:
        if request.language == "zh":
            # Use FunASR for Chinese
            result = funasr_model.generate(input=request.audio_url)
            return {
                "text": result[0]["text"],
                "segments": result[0].get("segments", [])
            }
        else:
            # Use Whisper for other languages
            response = requests.post(
                "http://whisper:9000/asr",
                files={"audio_file": download_audio(request.audio_url)}
            )
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ai/models")
async def get_available_models():
    return {
        "chat": ["deepseek-chat", "qwen-max", "glm-4"],
        "tts": ["fish-audio", "xtts", "azure-zh"],
        "stt": ["funasr-zh", "whisper-large-v3"],
        "image": ["sd-xl", "tongyi-wanxiang"]
    }
```

## 🚀 Quick Start

### 1. Get API Keys

```bash
# DeepSeek (Chat)
https://platform.deepseek.com

# Fish Audio (TTS)
https://fish.audio

# Qwen (Alibaba)
https://dashscope.aliyun.com
```

### 2. Update `.env`

```bash
# Chinese AI Services
DEEPSEEK_API_KEY=sk-...
FISH_AUDIO_KEY=fa-...
QWEN_API_KEY=sk-...

# Your backend
VITE_API_URL=http://localhost:8000/api
```

### 3. Start Backend

```bash
docker-compose up -d
```

### 4. Test

```bash
curl -X POST http://localhost:8000/api/ai/chat/completion \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "你好"}],
    "model": "deepseek-chat"
  }'
```

## 💡 Recommended Setup for Guide Studio

```
✅ DeepSeek - AI chat/scripts ($0.14/1M tokens)
✅ Fish Audio - Chinese TTS ($0.005/1k chars)
✅ XTTS (self-hosted) - Voice cloning (FREE)
✅ FunASR (self-hosted) - Chinese STT (FREE)
✅ Whisper (self-hosted) - Multi-language STT (FREE)
✅ Stable Diffusion XL (self-hosted) - Images (FREE)

Total cost: ~$10-20/month for moderate usage
Savings: ~$40-60/month vs Western models
```

## 📚 Additional Resources

- DeepSeek Docs: https://platform.deepseek.com/docs
- Fish Audio API: https://fish.audio/docs
- FunASR GitHub: https://github.com/alibaba-damo-academy/FunASR
- XTTS Docs: https://docs.coqui.ai/en/latest/models/xtts.html
