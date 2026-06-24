// ── useAIService ─────────────────────────────────────────────────────────
//
// Routes AI calls to the backend (when available + authenticated) or falls
// back to local Electron IPC. The backend is the "AI brain" — only chat,
// image generation, and whisper/STT go through it.

import { useCallback } from "react";
import { useBackend } from "@/contexts/BackendContext";
import { aiService } from "@/lib/api/ai";

export function useAIService() {
	const { isBackendAvailable, isAuthenticated } = useBackend();

	const useBackendAI = isBackendAvailable && isAuthenticated;

	/** Send a prompt for AI analysis / chat completion. Returns the text response. */
	const analyze = useCallback(
		async (prompt: string, options?: { model?: string; temperature?: number }): Promise<string> => {
			if (useBackendAI) {
				const result = await aiService.chatCompletion({
					messages: [{ role: "user", content: prompt }],
					model: options?.model,
					temperature: options?.temperature,
				});
				if (result.success) {
					return result.data.content;
				}
				throw new Error(result.error);
			}

			// Fallback to local Electron AI
			if (window.electronAPI?.aiAnalyze) {
				const result = await window.electronAPI.aiAnalyze(prompt);
				if (result.success && result.text) {
					return result.text;
				}
				throw new Error(result.error || "AI analysis failed");
			}
			throw new Error("No AI provider available");
		},
		[useBackendAI],
	);

	/** Generate structured JSON from AI */
	const generateJSON = useCallback(
		async (prompt: string): Promise<unknown> => {
			if (useBackendAI) {
				const result = await aiService.chatCompletion({
					messages: [
						{
							role: "system",
							content: "You are a helpful assistant. Respond only with valid JSON.",
						},
						{ role: "user", content: prompt },
					],
				});
				if (result.success) {
					return JSON.parse(result.data.content);
				}
				throw new Error(result.error);
			}

			if (window.electronAPI?.aiGenerateJSON) {
				const result = await window.electronAPI.aiGenerateJSON(prompt);
				if (result.success && result.data !== undefined) {
					return result.data;
				}
				throw new Error(result.error || "JSON generation failed");
			}
			throw new Error("No AI provider available");
		},
		[useBackendAI],
	);

	/** Generate an image from a prompt (backend only) */
	const generateImage = useCallback(
		async (prompt: string, options?: { width?: number; height?: number }): Promise<string> => {
			if (useBackendAI) {
				const result = await aiService.generateImage({
					prompt,
					width: options?.width,
					height: options?.height,
				});
				if (result.success) {
					return result.data.imageUrl;
				}
				throw new Error(result.error);
			}

			throw new Error("Image generation requires backend connection");
		},
		[useBackendAI],
	);

	return {
		analyze,
		generateJSON,
		generateImage,
		/** Whether AI calls go through the backend */
		isUsingBackend: useBackendAI,
	};
}
