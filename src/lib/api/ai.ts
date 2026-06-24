// ── AI Services API ──────────────────────────────────────────────────────
//
// AI capabilities integration with your Docker backend
// Supports multiple AI providers and models

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
	maxTokens?: number;
	stream?: boolean;
}

// Text-to-Speech
export interface TTSRequest {
	text: string;
	voice?: string; // Voice ID
	model?: string;
	speed?: number;
	stability?: number;
	similarityBoost?: number;
}

// Speech-to-Text (Whisper)
export interface STTRequest {
	audioUrl: string; // URL or base64
	language?: string;
	model?: string;
	responseFormat?: "json" | "srt" | "vtt" | "text";
}

// Image Generation
export interface ImageGenerationRequest {
	prompt: string;
	negativePrompt?: string;
	model?: string;
	width?: number;
	height?: number;
	steps?: number;
	guidanceScale?: number;
	seed?: number;
}

// Music Generation
export interface MusicGenerationRequest {
	prompt: string;
	duration?: number; // seconds
	genre?: string;
	mood?: string;
	tempo?: number;
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

export class AIService {
	// Get available capabilities
	async getCapabilities(): Promise<
		{ success: true; data: AICapabilities } | { success: false; error: string }
	> {
		return apiClient.get<AICapabilities>("/ai/capabilities");
	}

	// Chat Completion (GPT-4, DeepSeek, Qwen, etc.)
	async chatCompletion(request: ChatCompletionRequest): Promise<
		| { success: true; data: { content: string; usage: any } }
		| { success: false; error: string }
	> {
		return apiClient.post("/ai/chat/completion", request);
	}

	// List available models from backend
	async getAvailableModels(): Promise<
		| { success: true; data: { chat: string[]; tts: string[]; stt: string[]; image: string[] } }
		| { success: false; error: string }
	> {
		return apiClient.get("/ai/models");
	}

	// Text-to-Speech
	async generateSpeech(request: TTSRequest): Promise<
		{ success: true; data: { audioUrl: string } } | { success: false; error: string }
	> {
		return apiClient.post("/ai/tts", request);
	}

	// Speech-to-Text (Whisper)
	async transcribe(request: STTRequest): Promise<
		| { success: true; data: { text: string; segments?: any[] } }
		| { success: false; error: string }
	> {
		return apiClient.post("/ai/stt", request);
	}

	// Image Generation
	async generateImage(request: ImageGenerationRequest): Promise<
		{ success: true; data: { imageUrl: string } } | { success: false; error: string }
	> {
		return apiClient.post("/ai/image/generate", request);
	}

	// Music Generation
	async generateMusic(request: MusicGenerationRequest): Promise<
		{ success: true; data: { audioUrl: string } } | { success: false; error: string }
	> {
		return apiClient.post("/ai/music/generate", request);
	}

	// SFX Generation
	async generateSFX(prompt: string, duration?: number): Promise<
		{ success: true; data: { audioUrl: string } } | { success: false; error: string }
	> {
		return apiClient.post("/ai/sfx/generate", { prompt, duration });
	}

	// Video Generation
	async generateVideo(request: VideoGenerationRequest): Promise<
		{ success: true; data: { videoUrl: string; jobId?: string } } | { success: false; error: string }
	> {
		return apiClient.post("/ai/video/generate", request);
	}

	// Check video generation status (for async jobs)
	async checkVideoStatus(jobId: string): Promise<
		| { success: true; data: { status: "pending" | "processing" | "completed" | "failed"; videoUrl?: string } }
		| { success: false; error: string }
	> {
		return apiClient.get(`/ai/video/status/${jobId}`);
	}

	// Lottie Animation Search
	async searchLottie(query: string): Promise<
		{ success: true; data: { results: Array<{ id: string; url: string; preview: string }> } } | { success: false; error: string }
	> {
		return apiClient.get(`/ai/lottie/search?q=${encodeURIComponent(query)}`);
	}

	// Auto-caption generation
	async generateCaptions(
		audioUrl: string,
		language?: string,
	): Promise<
		| { success: true; data: { segments: Array<{ start: number; end: number; text: string }> } }
		| { success: false; error: string }
	> {
		return apiClient.post("/ai/captions/generate", { audioUrl, language });
	}

	// AI Video Analysis
	async analyzeVideo(videoUrl: string): Promise<
		| { success: true; data: { scenes: any[]; keyframes: any[]; summary: string } }
		| { success: false; error: string }
	> {
		return apiClient.post("/ai/video/analyze", { videoUrl });
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

	return apiClient.get(`/ai/usage?${params}`);
}
