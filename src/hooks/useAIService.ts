// ── useAIService ─────────────────────────────────────────────────────────
//
// Routes AI calls to the local Electron AI service. Guide Studio is
// local-only: chat, JSON generation, and image generation all run through
// the provider configured in Settings (Ollama or the user's own key).

import { useCallback } from "react";

/** The local image provider takes a ratio, not pixels; pick the nearest one. */
function aspectRatioFor(width?: number, height?: number) {
	if (!width || !height) return "16:9" as const;
	const ratio = width / height;
	const options = [
		["16:9", 16 / 9],
		["4:3", 4 / 3],
		["1:1", 1],
		["3:4", 3 / 4],
		["9:16", 9 / 16],
	] as const;
	let best: (typeof options)[number] = options[0];
	for (const option of options) {
		if (Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio)) best = option;
	}
	return best[0];
}

export function useAIService() {
	/** Send a prompt for AI analysis / chat completion. Returns the text response. */
	const analyze = useCallback(
		// Model/temperature stay in the signature for callers, but the local
		// service picks them up from Settings rather than per-call overrides.
		async (
			prompt: string,
			_options?: { model?: string; temperature?: number },
		): Promise<string> => {
			if (window.electronAPI?.aiAnalyze) {
				const result = await window.electronAPI.aiAnalyze(prompt);
				if (result.success && result.text) {
					return result.text;
				}
				throw new Error(result.error || "AI analysis failed");
			}
			throw new Error("No AI provider available");
		},
		[],
	);

	/** Generate structured JSON from AI */
	const generateJSON = useCallback(async (prompt: string): Promise<unknown> => {
		if (window.electronAPI?.aiGenerateJSON) {
			const result = await window.electronAPI.aiGenerateJSON(prompt);
			if (result.success && result.data !== undefined) {
				return result.data;
			}
			throw new Error(result.error || "JSON generation failed");
		}
		throw new Error("No AI provider available");
	}, []);

	/** Generate an image from a prompt through the local image provider. */
	const generateImage = useCallback(
		async (prompt: string, options?: { width?: number; height?: number }): Promise<string> => {
			if (!window.electronAPI?.aiMinimaxImage) {
				throw new Error("No local image provider is configured");
			}
			const result = await window.electronAPI.aiMinimaxImage(prompt, {
				aspectRatio: aspectRatioFor(options?.width, options?.height),
			});
			const first = result.imagePaths?.[0];
			if (result.success && first) {
				return first;
			}
			throw new Error(result.error || "Image generation failed");
		},
		[],
	);

	return {
		analyze,
		generateJSON,
		generateImage,
		/** Kept for callers that branched on transport; always false in local mode. */
		isUsingBackend: false,
	};
}
