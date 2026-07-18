/**
 * Guide step detection — turns cursor telemetry into a Scribe-style list of
 * documentation steps. Entirely heuristic; AI is only used later to title
 * the steps. Real click events are preferred; when the recording has no
 * click telemetry we fall back to click clusters from the recording profile.
 */
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import type { ChatContentPart, ChatMessage } from "@/lib/api/ai";
import { analyzeRecording } from "./recordingAnalyzer";
import type { CaptionTrack, GuideStep } from "./types";

/** Two clicks closer than this in time AND space merge into one step */
const STEP_MERGE_MAX_GAP_MS = 1_200;
const STEP_MERGE_MAX_DISTANCE = 0.04;
/** Hard cap so a click-heavy recording doesn't produce a 200-page doc */
const MAX_STEPS = 40;

let nextStepId = 1;

function makeStepId(): string {
	return `step-${nextStepId++}`;
}

function isClickPoint(p: CursorTelemetryPoint): boolean {
	if (p.clickType) return true;
	return (
		p.interactionType === "click" ||
		p.interactionType === "double-click" ||
		p.interactionType === "right-click" ||
		p.interactionType === "middle-click"
	);
}

function clickKind(p: CursorTelemetryPoint): GuideStep["action"] {
	if (p.clickType === "double" || p.interactionType === "double-click") return "double-click";
	if (p.clickType === "right" || p.interactionType === "right-click") return "right-click";
	return "click";
}

/** Words spoken within the step window give the AI titling pass real context */
function transcriptForWindow(
	captionTrack: CaptionTrack | null,
	startMs: number,
	endMs: number,
): string {
	if (!captionTrack) return "";
	const words: string[] = [];
	for (const line of captionTrack.lines) {
		if (line.endMs < startMs || line.startMs > endMs) continue;
		for (const word of line.words) {
			if (word.endMs >= startMs && word.startMs <= endMs) {
				words.push(word.text);
			}
		}
	}
	return words.join(" ").trim();
}

/**
 * Detect documentation steps from cursor telemetry.
 *
 * @param cursorTelemetry - raw telemetry from the recording
 * @param videoDurationMs - total duration of the recording
 * @param captionTrack - optional transcript; attaches spoken context to steps
 */
export function detectGuideSteps(
	cursorTelemetry: CursorTelemetryPoint[],
	videoDurationMs: number,
	captionTrack: CaptionTrack | null = null,
): GuideStep[] {
	if (videoDurationMs <= 0) return [];

	const sorted = [...cursorTelemetry].sort((a, b) => a.timeMs - b.timeMs);
	const clicks = sorted.filter(isClickPoint);

	let raw: Array<{ timeMs: number; cx: number; cy: number; action: GuideStep["action"] }>;

	if (clicks.length > 0) {
		// Merge rapid same-spot clicks (e.g. double-click telemetry noise)
		raw = [];
		for (const click of clicks) {
			const prev = raw[raw.length - 1];
			if (
				prev &&
				click.timeMs - prev.timeMs <= STEP_MERGE_MAX_GAP_MS &&
				Math.hypot(click.cx - prev.cx, click.cy - prev.cy) <= STEP_MERGE_MAX_DISTANCE
			) {
				// Keep the richer action (double/right beats plain click)
				if (clickKind(click) !== "click") prev.action = clickKind(click);
				continue;
			}
			raw.push({ timeMs: click.timeMs, cx: click.cx, cy: click.cy, action: clickKind(click) });
		}
	} else {
		// No click telemetry — approximate steps from click clusters
		const profile = analyzeRecording(sorted, videoDurationMs);
		raw = profile.clickClusters.map((cluster) => ({
			timeMs: cluster.startMs,
			cx: cluster.cx,
			cy: cluster.cy,
			action: "click" as const,
		}));
	}

	if (raw.length > MAX_STEPS) {
		// Keep steps evenly distributed rather than truncating the tail
		const stride = raw.length / MAX_STEPS;
		raw = Array.from({ length: MAX_STEPS }, (_, i) => raw[Math.floor(i * stride)]);
	}

	return raw.map((point, index) => {
		const windowStart = index === 0 ? 0 : raw[index - 1].timeMs;
		const windowEnd = index === raw.length - 1 ? videoDurationMs : raw[index + 1].timeMs;
		return {
			id: makeStepId(),
			index: index + 1,
			timeMs: point.timeMs,
			cx: point.cx,
			cy: point.cy,
			action: point.action,
			title: defaultStepTitle(index + 1, point.action),
			description: "",
			transcript: transcriptForWindow(captionTrack, windowStart, windowEnd),
		};
	});
}

function defaultStepTitle(index: number, action: GuideStep["action"]): string {
	const verb =
		action === "double-click" ? "Double-click" : action === "right-click" ? "Right-click" : "Click";
	return `Step ${index}: ${verb} here`;
}

/**
 * Build the prompt asking the AI to title each step using spoken context.
 * Returns null when there is nothing useful to send.
 */
export function buildStepTitlePrompt(steps: GuideStep[], guideTitle?: string): string | null {
	if (steps.length === 0) return null;

	const stepLines = steps
		.map((s) => {
			const at = `${Math.round(s.timeMs / 1000)}s`;
			const pos = `(${Math.round(s.cx * 100)}%, ${Math.round(s.cy * 100)}%) of screen`;
			const spoken = s.transcript ? ` — narrator says: "${s.transcript.slice(0, 300)}"` : "";
			return `${s.index}. ${s.action} at ${at}, ${pos}${spoken}`;
		})
		.join("\n");

	return (
		"You are writing a step-by-step software guide from a screen recording. " +
		"For each interaction below, write a short imperative step title (max 10 words) " +
		"and a one-sentence description of what the user does.\n" +
		(guideTitle ? `The guide is about: ${guideTitle}\n` : "") +
		"Use the narrator's words when available to name the real buttons, menus, and pages " +
		'— e.g. "Open the Settings menu", never "Click here" or screen positions.\n' +
		"Respond ONLY with a JSON array, one object per step, in the same order: " +
		'[{"title": "...", "description": "..."}]\n' +
		'Example entry: {"title": "Invite new teammates", "description": "Select Invite from the team menu to send teammates an email invitation."}\n\n' +
		`Interactions:\n${stepLines}`
	);
}

/**
 * Build multimodal messages asking a vision model to title each step from
 * its actual screenshot — the LLM "understands the video" instead of
 * guessing from click coordinates. Each screenshot already has the click
 * marked with an indigo ring (drawn by captureStepScreenshots). Returns
 * null when no step has a screenshot; the text-only prompt is the fallback.
 */
export function buildStepTitleVisionMessages(
	steps: GuideStep[],
	guideTitle?: string,
): ChatMessage[] | null {
	if (steps.length === 0 || !steps.some((s) => s.screenshotDataUrl)) return null;

	const parts: ChatContentPart[] = [
		{
			type: "text",
			text:
				"You are writing a step-by-step software guide from a screen recording. " +
				"Below is one screenshot per user interaction, in order. The indigo/purple ring " +
				"marks exactly where the user clicked.\n" +
				(guideTitle ? `The guide is about: ${guideTitle}\n` : "") +
				"For EACH screenshot: look at what is inside and around the ring, read the actual " +
				"on-screen text, and name the real element — the app, button, menu, tab, or field " +
				'label you can see (e.g. "Open the GuideAI assistant", "Stop the screen recording").\n' +
				"Write a short imperative title (max 10 words) and a one-sentence description per step.\n" +
				"BANNED: generic titles that could apply to any app — never write things like " +
				'"Proceed to next step", "Select desired option", "Confirm your selection", ' +
				'"click here", or coordinates. Every title must contain a word visible in that screenshot, ' +
				"and DIFFERENT screenshots must get DIFFERENT titles — describe each one independently.\n" +
				"Respond ONLY with a JSON array, one object per step, in the same order: " +
				'[{"title": "...", "description": "..."}]',
		},
	];

	for (const step of steps) {
		const spoken = step.transcript ? ` — narrator says: "${step.transcript.slice(0, 300)}"` : "";
		parts.push({
			type: "text",
			text: `Step ${step.index} (${step.action} at ${Math.round(step.timeMs / 1000)}s)${spoken}:`,
		});
		if (step.screenshotDataUrl) {
			parts.push({ type: "image_url", image_url: { url: step.screenshotDataUrl } });
		} else {
			parts.push({
				type: "text",
				text: `(no screenshot — the ${step.action} was at ${Math.round(step.cx * 100)}%, ${Math.round(step.cy * 100)}% of the screen)`,
			});
		}
	}

	return [{ role: "user", content: parts }];
}

/** Merge AI-generated titles back into the step list (tolerant of bad output) */
export function applyStepTitles(steps: GuideStep[], aiResponse: unknown): GuideStep[] {
	if (!Array.isArray(aiResponse)) return steps;
	return steps.map((step, i) => {
		const entry = aiResponse[i];
		if (!entry || typeof entry !== "object") return step;
		const title = typeof entry.title === "string" ? entry.title.trim() : "";
		const description = typeof entry.description === "string" ? entry.description.trim() : "";
		return {
			...step,
			title: title
				? `Step ${step.index}: ${title.replace(/^step\s*\d+[:.)]?\s*/i, "")}`
				: step.title,
			description: description || step.description,
		};
	});
}
