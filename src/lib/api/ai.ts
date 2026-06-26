// ── AI Services API ──────────────────────────────────────────────────────
//
// AI capabilities integration with the Docker backend (GuideAI).
// All AI endpoints are routed through the gateway at /api/v1/studio/ai/*
//
// Available backend endpoints:
//   POST /studio/ai/chat/completion  — Chat / script generation
//   POST /studio/ai/image/generate   — Image generation (SDXL/Flux)
//   POST /studio/ai/tts/generate     — Text-to-speech (Edge TTS / ElevenLabs)
//   GET  /studio/ai/tts/voices       — List TTS voices
//   POST /studio/ai/stt/transcribe   — Speech-to-text (Groq Whisper)
//   POST /studio/ai/music/generate   — Music generation (MusicGen)

import { apiClient } from "./client";

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
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
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

const STUDIO_PREFIX = "/studio/ai";

export class AIService {
	// Chat Completion (DeepSeek Flash via OpenRouter)
	async chatCompletion(
		request: ChatCompletionRequest,
	): Promise<
		{ success: true; data: { content: string; usage: unknown } } | { success: false; error: string }
	> {
		return apiClient.post(`${STUDIO_PREFIX}/chat/completion`, request);
	}

	// Text-to-Speech (Edge TTS free / ElevenLabs premium)
	async generateSpeech(
		request: TTSRequest,
	): Promise<{ success: true; data: { audioUrl: string } } | { success: false; error: string }> {
		return apiClient.post(`${STUDIO_PREFIX}/tts/generate`, request);
	}

	// List available TTS voices
	async listVoices(locale?: string): Promise<
		| {
				success: true;
				data: { voices: Array<{ id: string; name: string; locale: string; gender: string }> };
		  }
		| { success: false; error: string }
	> {
		const params = locale ? `?locale=${encodeURIComponent(locale)}` : "";
		return apiClient.get(`${STUDIO_PREFIX}/tts/voices${params}`);
	}

	// Speech-to-Text (Groq Whisper)
	async transcribe(
		audioFile: File | Blob,
		language?: string,
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
		// STT endpoint expects multipart/form-data, not JSON
		const formData = new FormData();
		formData.append("audio", audioFile);
		if (language) {
			formData.append("language", language);
		}

		const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";
		const url = `${baseUrl}${STUDIO_PREFIX}/stt/transcribe`;

		try {
			const token = apiClient.getAccessToken();
			const headers: Record<string, string> = {};
			if (token) {
				headers.Authorization = `Bearer ${token}`;
			}

			const response = await fetch(url, {
				method: "POST",
				headers,
				body: formData,
			});

			if (!response.ok) {
				const error = await response.json().catch(() => ({ detail: response.statusText }));
				return { success: false, error: error.detail || `HTTP ${response.status}` };
			}

			const data = await response.json();
			return { success: true, data };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Transcription failed",
			};
		}
	}

	// Image Generation (Replicate SDXL/Flux)
	async generateImage(
		request: ImageGenerationRequest,
	): Promise<
		{ success: true; data: { images: Array<{ url: string }> } } | { success: false; error: string }
	> {
		return apiClient.post(`${STUDIO_PREFIX}/image/generate`, request);
	}

	// Music Generation (Replicate MusicGen)
	async generateMusic(
		request: MusicGenerationRequest,
	): Promise<
		| { success: true; data: { audioUrl: string; duration: number } }
		| { success: false; error: string }
	> {
		return apiClient.post(`${STUDIO_PREFIX}/music/generate`, request);
	}

	// SFX Generation (not yet implemented in backend)
	async generateSFX(
		prompt: string,
		duration?: number,
	): Promise<{ success: true; data: { audioUrl: string } } | { success: false; error: string }> {
		return apiClient.post(`${STUDIO_PREFIX}/music/generate`, {
			prompt: `sound effect: ${prompt}`,
			duration: duration || 5,
		});
	}

	// Video Generation (not yet implemented in backend)
	async generateVideo(
		_request: VideoGenerationRequest,
	): Promise<
		| { success: true; data: { videoUrl: string; jobId?: string } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Video generation is not yet available" };
	}

	// Check video generation status
	async checkVideoStatus(_jobId: string): Promise<
		| {
				success: true;
				data: { status: "pending" | "processing" | "completed" | "failed"; videoUrl?: string };
		  }
		| { success: false; error: string }
	> {
		return { success: false, error: "Video generation is not yet available" };
	}

	// Lottie Animation Search (not yet implemented in backend)
	async searchLottie(
		_query: string,
	): Promise<
		| { success: true; data: { results: Array<{ id: string; url: string; preview: string }> } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Lottie search is not yet available" };
	}

	// Auto-caption generation (uses STT transcription under the hood)
	async generateCaptions(
		_audioUrl: string,
		_language?: string,
	): Promise<
		| { success: true; data: { segments: Array<{ start: number; end: number; text: string }> } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Use the transcribe method with an audio file for captions" };
	}

	// AI Video Analysis (not yet implemented in backend)
	async analyzeVideo(
		_videoUrl: string,
	): Promise<
		| { success: true; data: { scenes: unknown[]; keyframes: unknown[]; summary: string } }
		| { success: false; error: string }
	> {
		return { success: false, error: "Video analysis is not yet available" };
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

export async function getTokenUsage(
	startDate?: string,
	endDate?: string,
): Promise<{ success: true; data: TokenUsage[] } | { success: false; error: string }> {
	const params = new URLSearchParams();
	if (startDate) params.set("start", startDate);
	if (endDate) params.set("end", endDate);

	return apiClient.get(`/usage?${params}`);
}
