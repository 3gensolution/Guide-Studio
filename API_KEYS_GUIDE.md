# Guide Studio - API Keys Setup

This guide explains how to get and configure API keys for Guide Studio's AI features.

## Overview

Guide Studio uses **your own API keys** for AI services. You only pay for what you use, with no subscription or middleman fees.

### Cost-Effective Stack (Recommended)

| Service | Cost | What It Does | Required? |
|---------|------|--------------|-----------|
| **DeepSeek Flash** | $0.07-0.14 per 1M tokens | AI chat, script generation | ✅ Required |
| **Replicate** | $0.0025 per image | Image generation | ✅ Required |
| **Groq** | FREE tier | Speech-to-text transcription | ✅ Required |
| **Edge TTS** | FREE | Text-to-speech (Microsoft voices) | ✅ Built-in |

**Total monthly cost for moderate usage**: ~$3-8

---

## Required API Keys

### 1. DeepSeek API Key (Chat/Scripts) - REQUIRED

**What it does**: Powers AI chat, script generation, video analysis, and smart suggestions.

**Cost**:
- DeepSeek Flash: $0.07 per 1M tokens (~95% cheaper than GPT-4)
- DeepSeek Chat: $0.14 per 1M tokens

**How to get it**:

1. Go to https://platform.deepseek.com
2. Sign up with email or GitHub
3. Click "API Keys" in dashboard
4. Click "Create New Key"
5. Copy the key (starts with `sk-`)

**Add to Guide Studio**:
- Open Settings → AI Services
- Paste key into "DeepSeek API Key" field
- Select model: `deepseek-flash` (faster, cheaper) or `deepseek-chat` (higher quality)

---

### 2. Replicate API Key (Images) - REQUIRED

**What it does**: Generates images for video backgrounds, thumbnails, and visual elements.

**Cost**:
- SDXL: $0.0025 per image (400 images = $1)
- Flux: $0.003 per image (premium quality)

**How to get it**:

1. Go to https://replicate.com
2. Sign up with GitHub or email
3. Go to https://replicate.com/account/api-tokens
4. Click "Create Token"
5. Copy the token (starts with `r8_`)

**Add to Guide Studio**:
- Open Settings → AI Services
- Paste token into "Replicate API Key" field
- Select default model: `stability-ai/sdxl` (recommended)

---

### 3. Groq API Key (Transcription) - REQUIRED

**What it does**: Speech-to-text transcription for auto-captions.

**Cost**:
- FREE tier: 14,400 requests/day (Whisper large-v3)
- Beyond free tier: Pay-as-you-go (very cheap)

**How to get it**:

1. Go to https://console.groq.com
2. Sign up with Google or email
3. Go to API Keys section
4. Click "Create API Key"
5. Copy the key (starts with `gsk_`)

**Add to Guide Studio**:
- Open Settings → AI Services
- Paste key into "Groq API Key" field
- Model: `whisper-large-v3` (automatic)

---

## Optional API Keys (Better Quality)

### 3. ElevenLabs API Key (Premium TTS) - OPTIONAL

**What it does**: High-quality voice cloning and natural-sounding narration.

**Cost**:
- Starter: $5/month (30,000 characters)
- Creator: $22/month (100,000 characters + voice cloning)

**When to use**: If Edge TTS (free) doesn't meet your quality needs.

**How to get it**:

1. Go to https://elevenlabs.io
2. Sign up and verify email
3. Go to Profile → API Keys
4. Click "Generate API Key"
5. Copy the key

**Add to Guide Studio**:
- Open Settings → AI Services → Advanced
- Paste key into "ElevenLabs API Key" field
- Enable "Use ElevenLabs for TTS" toggle

---

### 4. OpenAI API Key (Premium Chat) - OPTIONAL

**What it does**: GPT-4 for highest quality script generation.

**Cost**: $10 per 1M tokens (100x more expensive than DeepSeek)

**When to use**: When you need absolute best quality for important projects.

**How to get it**:

1. Go to https://platform.openai.com
2. Sign up and add payment method
3. Go to API Keys section
4. Click "Create New Secret Key"
5. Copy the key (starts with `sk-`)

**Add to Guide Studio**:
- Open Settings → AI Services → Advanced
- Paste key into "OpenAI API Key" field
- Select "GPT-4" in model dropdown

---

## Free Services (No Keys Needed)

### Edge TTS (Microsoft)
- **Built-in**: No API key required
- **Quality**: High-quality neural voices
- **Voices**: 400+ voices in 100+ languages
- **Cost**: FREE
- **Usage**: Automatic fallback if no ElevenLabs key

### Remotion (Video Rendering)
- **Built-in**: Renders locally on your machine
- **Quality**: Professional video output
- **Cost**: FREE (uses your CPU/GPU)
- **Usage**: Automatic video rendering

---

## Settings Interface

Guide Studio's settings panel should look like this:

```
┌─────────────────────────────────────────────────────────┐
│  AI Services Settings                                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  💬 Chat & Script Generation                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │ DeepSeek API Key                                 │   │
│  │ sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx              │   │
│  └─────────────────────────────────────────────────┘   │
│  Model: [ deepseek-flash ▼ ]                           │
│                                                          │
│  🖼️ Image Generation                                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Replicate API Token                              │   │
│  │ r8_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx              │   │
│  └─────────────────────────────────────────────────┘   │
│  Default Model: [ stability-ai/sdxl ▼ ]                │
│                                                          │
│  📝 Speech-to-Text (Transcription)                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Groq API Key                                     │   │
│  │ gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx             │   │
│  └─────────────────────────────────────────────────┘   │
│  FREE tier: 14,400 requests/day                        │
│                                                          │
│  🎤 Voice & Speech                                      │
│  Default TTS: ● Edge TTS (Free)                        │
│               ○ ElevenLabs (Premium)                    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ElevenLabs API Key (Optional)                    │   │
│  │ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  🎬 Video Rendering: Remotion (Free, Local)            │
│                                                          │
│  [Test Connection]  [Save Settings]                     │
└─────────────────────────────────────────────────────────┘
```

---

## Cost Estimates

### Light Usage (10 videos/month)
- DeepSeek Flash: ~$0.50
- Replicate Images: ~$0.25 (100 images)
- Groq Transcription: FREE (within 14.4k requests/day)
- Edge TTS: FREE
- **Total**: ~$0.75/month

### Moderate Usage (50 videos/month)
- DeepSeek Flash: ~$2.50
- Replicate Images: ~$1.25 (500 images)
- Groq Transcription: FREE
- Edge TTS: FREE
- **Total**: ~$3.75/month

### Heavy Usage (200 videos/month)
- DeepSeek Flash: ~$10
- Replicate Images: ~$5 (2,000 images)
- Groq Transcription: FREE (or minimal if over free tier)
- Edge TTS: FREE
- **Total**: ~$15/month

**With ElevenLabs Premium**:
- Add $22/month for voice cloning + higher quality

---

## API Key Security

### Best Practices
1. **Never share your API keys**
2. **Set spending limits** in each service's dashboard
3. **Rotate keys periodically** (every 3-6 months)
4. **Use separate keys** for development vs production

### Spending Limits (Recommended)

**DeepSeek**:
- Go to https://platform.deepseek.com/usage
- Set monthly limit: $20 (prevents accidents)

**Replicate**:
- Go to https://replicate.com/account/billing
- Set spending limit: $10/month

**ElevenLabs** (if using):
- Choose appropriate plan tier
- Monitor character usage in dashboard

---

## Troubleshooting

### "Invalid API Key" Error
- Check for typos (copy-paste recommended)
- Verify key hasn't expired
- Ensure you have billing enabled (Replicate, DeepSeek)

### "Insufficient Credits" Error
- Add payment method to service
- Check spending limits
- Top up account balance

### "Rate Limit Exceeded" Error
- Wait 1 minute and retry
- Upgrade to higher tier plan
- Spread requests over longer time period

### "Service Unavailable" Error
- Check service status page
- Try again in a few minutes
- Switch to fallback service (e.g., Edge TTS → built-in)

---

## FAQ

**Q: Do I need all the API keys?**
A: Only DeepSeek and Replicate are required. Edge TTS (free) handles voices automatically.

**Q: What happens if I don't add a key?**
A: Features requiring that service will be disabled or use free alternatives.

**Q: Can I use my own self-hosted models?**
A: Yes! Contact backend administrator to configure custom endpoints.

**Q: Are my API keys secure?**
A: Keys are stored encrypted and only sent to official service endpoints. Never shared with third parties.

**Q: Can I change keys later?**
A: Yes, update keys anytime in Settings → AI Services.

**Q: What if I hit spending limits?**
A: Services will pause until you increase limits or new billing period starts.

---

## Getting Help

- **Discord**: [Your Discord Link]
- **GitHub Issues**: [Your Repo]
- **Email**: [Support Email]

For service-specific issues:
- DeepSeek: https://platform.deepseek.com/docs
- Replicate: https://replicate.com/docs
- ElevenLabs: https://elevenlabs.io/docs
