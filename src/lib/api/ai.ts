// ── AI Services (local) ──────────────────────────────────────────────────
//
// Guide Studio runs its AI locally. This module keeps the request/response
// shapes callers were written against, but every call now goes over the
// Electron IPC bridge to the local AI service (Ollama or the user's own
// provider key, configured in Settings) instead of the Guide Studio backend.
//
// Local providers behind each method:
//   chatCompletion  — ai-analyze / ai-analyze-image
//   generateSpeech  — ai-minimax-tts, falling back to ai-tts-synthesize
//   listVoices      — ai-minimax-voices
//   generateImage   — ai-minimax-image
//   generateMusic   — ai-generate-music
//   transcribe      — not available here; captions use the local Whisper
//                     engine in `src/lib/captioning/transcribe.ts`

// ── Supported AI Capabilities ────────────────────────────────────────────

export interface AICapabilities {
	// Text Generation (GPT-4, Claude, Gemini, etc.)
	textGeneration: {
		chatCompletion: boolean;
		streaming: boolean;
		functionCalling: boolean;
		vision: boolean;
	};

	// Speech & Audio
	speech: {
		textToSpeech: boolean; // TTS (ElevenLabs, OpenAI TTS, etc.)
		speechToText: boolean; // STT/Whisper
		voiceCloning: boolean;
		audioGeneration: boolean; // Music, SFX (ElevenLabs, Suno, etc.)
	};

	// Vision & Image
	vision: {
		imageGeneration: boolean; // DALL-E, Midjourney, Stable Diffusion
		imageToImage: boolean; // Style transfer, upscaling
		imageAnalysis: boolean; // Vision models
		backgroundRemoval: boolean;
	};

	// Video
	video: {
		videoGeneration: boolean; // Runway, Pika, etc.
		videoToVideo: boolean; // Style transfer
		motionTracking: boolean;
		sceneDetection: boolean;
	};

	// Animation
	animation: {
		lottieGeneration: boolean; // Animated icons/graphics
		animationGeneration: boolean; // Motion graphics
	};
}

// ── AI Service Interfaces ────────────────────────────────────────────────

// Chat/Text Generation
/** OpenAI-style multimodal content part. Messages containing image parts are
 *  routed to the backend's vision model (Gemini) instead of DeepSeek. */
export interface ChatContentPart {
	type: "text" | "image_url";
	text?: string;
	image_url?: { url: string };
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string | ChatContentPart[];
}

export interface ChatCompletionRequest {
	messages: ChatMessage[];
	model?: string;
	temperature?: number;
	max_tokens?: number;
	stream?: boolean;
}

// Text-to-Speech
export interface TTSRequest {
	text: string;
	voice?: string; // Voice ID
	model?: string; // "edge-tts" or "elevenlabs"
	speed?: number;
	/**
	 * The language the narration is in, e.g. "de" or "pt-BR". Only the local
	 * Piper engine uses it, to pick a voice that speaks it; leave it out and the
	 * language is read from the text.
	 */
	language?: string;
}

// Image Generation
export interface ImageGenerationRequest {
	prompt: string;
	negative_prompt?: string;
	model?: string; // "sdxl" or "flux"
	width?: number;
	height?: number;
	num_outputs?: number;
}

// Music Generation
export interface MusicGenerationRequest {
	prompt: string;
	duration?: number; // seconds (5-30)
	model_version?: string;
}

// Video Generation
export interface VideoGenerationRequest {
	prompt: string;
	imageUrl?: string; // Optional starting image
	duration?: number; // seconds
	fps?: number;
	width?: number;
	height?: number;
}

// ── AI Service Class ──────────────────────────────────────────────────────

/** Flatten an OpenAI-style message list into a prompt plus a system context. */
function splitMessages(messages: ChatMessage[]) {
	const system: string[] = [];
	const turns: string[] = [];
	let imageBase64: string | undefined;

	for (const message of messages) {
		const parts = typeof message.content === "string" ? [message.content] : message.content;
		const text: string[] = [];
		for (const part of parts) {
			if (typeof part === "string") {
				text.push(part);
				continue;
			}
			if (part.type === "text" && part.text) text.push(part.text);
			if (part.type === "image_url" && part.image_url?.url && !imageBase64) {
				// The local vision call takes bare base64, not a data URL.
				imageBase64 = part.image_url.url.replace(/^data:[^;]+;base64,/, "");
			}
		}
		const joined = text.join("\n").trim();
		if (!joined) continue;
		if (message.role === "system") system.push(joined);
		else turns.push(message.role === "assistant" ? `Assistant: ${joined}` : joined);
	}

	return {
		prompt: turns.join("\n\n"),
		context: system.length > 0 ? system.join("\n\n") : undefined,
		imageBase64,
	};
}

export class AIService {
	// Chat completion through the local provider. Messages carrying an image
	// part are routed to the local vision call instead.
	async chatCompletion(
		request: ChatCompletionRequest,
		_opts?: { timeoutMs?: number },
	): Promise<
		{ success: true; data: { content: string; usage: unknown } } | { success: false; error: string }
	> {
		const { prompt, context, imageBase64 } = splitMessages(request.messages);
		if (!window.electronAPI?.aiAnalyze) {
			return { success: false, error: "No local AI provider is available" };
		}

		try {
			const result = imageBase64
				? await window.electronAPI.aiAnalyzeImage(prompt, imageBase64, context)
				: await window.electronAPI.aiAnalyze(prompt, context);
			if (result.success && result.text) {
				return { success: true, data: { content: result.text, usage: null } };
			}
			return { success: false, error: result.error || "The local AI provider returned no text" };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Local AI request failed",
			};
		}
	}

	// Text-to-speech through the local TTS providers. Returns a local file
	// path, which both the preview <audio> elements and FFmpeg narration
	// muxing at export can use.
	async generateSpeech(
		request: TTSRequest,
	): Promise<{ success: true; data: { audioUrl: string } } | { success: false; error: string }> {
		try {
			if (window.electronAPI?.aiMinimaxTts) {
				const minimax = await window.electronAPI.aiMinimaxTts(request.text, {
					voiceId: request.voice,
					speed: request.speed,
				});
				if (minimax.success && minimax.audioPath) {
					return { success: true, data: { audioUrl: minimax.audioPath } };
				}
			}

			if (window.electronAPI?.aiTtsSynthesize) {
				const fallback = await window.electronAPI.aiTtsSynthesize(request.text, request.voice, {
					language: request.language,
				});
				if (fallback.success && fallback.audioPath) {
					return { success: true, data: { audioUrl: fallback.audioPath } };
				}
				return { success: false, error: fallback.error || "Local TTS failed" };
			}

			return { success: false, error: "No local text-to-speech provider is available" };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "TTS request failed",
			};
		}
	}

	// List the local TTS voices.
	async listVoices(_locale?: string): Promise<
		| {
				success: true;
				data: { voices: Array<{ id: string; name: string; locale: string; gender: string }> };
		  }
		| { success: false; error: string }
	> {
		if (!window.electronAPI?.aiMinimaxVoices) {
			return { success: false, error: "No local text-to-speech provider is available" };
		}
		const result = await window.electronAPI.aiMinimaxVoices();
		return {
			success: true,
			data: {
				voices: result.voices.map((voice) => ({
					id: voice.id,
					name: voice.name,
					locale: "",
					gender: voice.gender,
				})),
			},
		};
	}

	// Speech-to-text. There is no local STT behind this call — auto-captions
	// run the in-app Whisper engine directly (`transcribeMono16kToSegments`).
	async transcribe(
		_audioFile: File | Blob,
		_language?: string,
	): Promise<
		| {
				success: true;
				data: {
					segments: Array<{ start: number; end: number; text: string }>;
					fullText: string;
					language: string;
				};
		  }
		| { success: false; error: string }
	> {
		return { success: false, error: "Transcription runs on the local caption engine" };
	}

	// Image generation through the local image provider.
	async generateImage(
		request: ImageGenerationRequest,
	): Promise<
		{ success: true; data: { images: Array<{ url: string }> } } | { success: false; error: string }
	> {
		if (!window.electronAPI?.aiMinimaxImage) {
			return { success: false, error: "No local image provider is available" };
		}
		const result = await window.electronAPI.aiMinimaxImage(request.prompt, {
			count: request.num_outputs,
		});
		if (result.success && result.imagePaths?.length) {
			return { success: true, data: { images: result.imagePaths.map((url) => ({ url })) } };
		}
		return { success: false, error: result.error || "Local image generation failed" };
	}

	// Music generation through the local music provider.
	async generateMusic(
		request: MusicGenerationRequest,
		_timeoutMs?: number,
	): Promise<
		| { success: true; data: { audioUrl: string; duration: number } }
		| { success: false; error: string }
	> {
		if (!window.electronAPI?.aiGenerateMusic) {
			return { success: false, error: "No local music provider is available" };
		}
		const result = await window.electronAPI.aiGenerateMusic(
			"custom",
			request.prompt,
			request.duration,
		);
		if (result.success && result.audioPath) {
			return {
				success: true,
				data: { audioUrl: result.audioPath, duration: result.durationSec ?? request.duration ?? 0 },
			};
		}
		return { success: false, error: result.error || "Local music generation failed" };
	}

	// SFX generation through the local SFX provider.
	async generateSFX(
		prompt: string,
		duration?: number,
	): Promise<{ success: true; data: { audioUrl: string } } | { success: false; error: string }> {
		if (!window.electronAPI?.aiElevenlabsSfx) {
			return { success: false, error: "No local sound-effect provider is available" };
		}
		const result = await window.electronAPI.aiElevenlabsSfx(prompt, { durationSec: duration });
		if (result.success && result.filePath) {
			return { success: true, data: { audioUrl: result.filePath } };
		}
		return { success: false, error: result.error || "Local sound-effect generation failed" };
	}

	// Video Generation (no local provider)
	async generateVideo(
		_request: VideoGenerationRequest,
	): Promise<
		| { success: true; data: { videoUrl: string; jobId?: string } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Video generation is not available" };
	}

	// Check video generation status
	async checkVideoStatus(_jobId: string): Promise<
		| {
				success: true;
				data: { status: "pending" | "processing" | "completed" | "failed"; videoUrl?: string };
		  }
		| { success: false; error: string }
	> {
		return { success: false, error: "Video generation is not available" };
	}

	// Lottie Animation Search (served by the local Lottie search handlers)
	async searchLottie(
		_query: string,
	): Promise<
		| { success: true; data: { results: Array<{ id: string; url: string; preview: string }> } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Lottie search is not available here" };
	}

	// Auto-caption generation (uses the local caption engine under the hood)
	async generateCaptions(
		_audioUrl: string,
		_language?: string,
	): Promise<
		| { success: true; data: { segments: Array<{ start: number; end: number; text: string }> } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Captions run on the local caption engine" };
	}

	// AI Video Analysis (no local provider)
	async analyzeVideo(
		_videoUrl: string,
	): Promise<
		| { success: true; data: { scenes: unknown[]; keyframes: unknown[]; summary: string } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Video analysis is not available" };
	}
}

export const aiService = new AIService();

// ── Usage Token Tracking ──────────────────────────────────────────────────

export interface TokenUsage {
	service: string;
	tokens: number;
	cost: number;
	timestamp: string;
}

/** Local usage tracking is reported by the main process, not an account. */
export async function getTokenUsage(
	_startDate?: string,
	_endDate?: string,
): Promise<{ success: true; data: TokenUsage[] } | { success: false; error: string }> {
	return { success: true, data: [] };
}
