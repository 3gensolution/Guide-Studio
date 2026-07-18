/**
 * AI intro builder — has the backend vision model design the intro card
 * from the recording itself. It reads a mid-video frame (the recorded app's
 * actual UI), then writes the title/subtitle and picks an accent color that
 * matches the product's branding, a background, and animations. Returns a
 * Partial<IntroConfig> the builder merges over the user's current config,
 * so timing, images, and anything AI doesn't set are left untouched.
 */

import { aiService, type ChatContentPart } from "@/lib/api/ai";
import {
	ANIMATION_LABELS,
	type IntroAnimationStyle,
	type IntroConfig,
} from "@/lib/intro/introTypes";
import { captureFrameAt, downscaleDataUrl } from "./frameCapture";

export interface IntroSuggestionInput {
	videoPath: string;
	videoDurationMs: number;
	/** Optional context, e.g. the step-guide title if one was generated */
	guideTitle?: string;
	/** Allowed backgroundColor keys (the builder's swatches) */
	allowedBackgrounds: string[];
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ANIMATION_STYLES = Object.keys(ANIMATION_LABELS) as IntroAnimationStyle[];

/** Pull the first JSON object out of a chat response (tolerates fences/prose). */
function parseJsonObject(content: string): Record<string, unknown> {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start === -1 || end <= start) throw new Error("No JSON object in response");
	return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * Ask the vision model to design the intro. Throws with a human-readable
 * message on failure — the caller surfaces it as a toast.
 */
export async function generateIntroFromRecording(
	input: IntroSuggestionInput,
): Promise<Partial<IntroConfig>> {
	// A frame ~30% in shows the real app (frame 0 is often a desktop/blank).
	const frame = await captureFrameAt(input.videoPath, input.videoDurationMs * 0.3, 960);
	if (!frame) throw new Error("Could not read a frame from the recording");
	const smallFrame = await downscaleDataUrl(frame, 720);

	const parts: ChatContentPart[] = [
		{
			type: "text",
			text:
				"This is a frame from a screen recording that will open a product walkthrough video. " +
				"Design the intro title card for it:\n" +
				`- "title": name what the walkthrough shows, max 6 words, from the actual app/screen you see` +
				(input.guideTitle ? ` (the author calls it: "${input.guideTitle}")` : "") +
				".\n" +
				'- "subtitle": one supporting line, max 10 words, plain language.\n' +
				'- "accentColor": a hex color sampled from the app\'s own branding in the frame ' +
				"(its primary button/logo color). Must read well on a dark background — brighten it if needed.\n" +
				`- "backgroundColor": pick the best match from exactly this list: ${input.allowedBackgrounds.join(", ")}.\n` +
				`- "titleAnimation" and "subtitleAnimation": pick from exactly this list: ${ANIMATION_STYLES.join(", ")}.\n` +
				"Respond ONLY with a JSON object with those five keys.",
		},
		{ type: "image_url", image_url: { url: smallFrame } },
	];

	const result = await aiService.chatCompletion(
		{ messages: [{ role: "user", content: parts }], temperature: 0.5 },
		{ timeoutMs: 90_000 },
	);
	if (!result.success) throw new Error(result.error);

	const raw = parseJsonObject(result.data.content);
	const suggestion: Partial<IntroConfig> = {};

	if (typeof raw.title === "string" && raw.title.trim()) {
		suggestion.title = raw.title.trim().slice(0, 60);
	}
	if (typeof raw.subtitle === "string" && raw.subtitle.trim()) {
		suggestion.subtitle = raw.subtitle.trim().slice(0, 90);
	}
	if (typeof raw.accentColor === "string" && HEX_COLOR_RE.test(raw.accentColor.trim())) {
		suggestion.accentColor = raw.accentColor.trim();
	}
	if (
		typeof raw.backgroundColor === "string" &&
		input.allowedBackgrounds.includes(raw.backgroundColor)
	) {
		suggestion.backgroundColor = raw.backgroundColor;
	}
	if (
		typeof raw.titleAnimation === "string" &&
		(ANIMATION_STYLES as string[]).includes(raw.titleAnimation)
	) {
		suggestion.titleAnimation = raw.titleAnimation as IntroAnimationStyle;
	}
	if (
		typeof raw.subtitleAnimation === "string" &&
		(ANIMATION_STYLES as string[]).includes(raw.subtitleAnimation)
	) {
		suggestion.subtitleAnimation = raw.subtitleAnimation as IntroAnimationStyle;
	}

	if (!suggestion.title && !suggestion.subtitle) {
		throw new Error("AI returned no usable intro copy");
	}
	return suggestion;
}
