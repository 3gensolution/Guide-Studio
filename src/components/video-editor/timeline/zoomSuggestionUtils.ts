import { CLICK_ZOOM_SUGGESTIONS_ENABLED } from "../featureFlags";
import type { CursorTelemetryPoint, ZoomFocus } from "../types";

export const MIN_DWELL_DURATION_MS = 450;
export const MAX_DWELL_DURATION_MS = 2600;
export const DWELL_MOVE_THRESHOLD = 0.02;
/** Minimum spacing between two accepted suggestion centres. */
export const SUGGESTION_SPACING_MS = 1800;
/** Window for clustering consecutive click events. */
export const CLICK_CLUSTER_WINDOW_MS = 2500;
/** Post-click analysis window for behavior classification. */
const POST_CLICK_ANALYSIS_MS = 500;
/** Minimum cursor displacement to classify as dropdown or text-selection. */
const POST_CLICK_MOVE_THRESHOLD = 0.03;

export interface ZoomDwellCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
}

export interface ClickZoomCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
	clickType: string;
	postBehavior?: "dropdown-open" | "text-selection" | "text-field-click" | "navigation";
}

function normalizeTelemetrySample(
	sample: CursorTelemetryPoint,
	totalMs: number,
): CursorTelemetryPoint {
	return {
		timeMs: Math.max(0, Math.min(sample.timeMs, totalMs)),
		cx: Math.max(0, Math.min(sample.cx, 1)),
		cy: Math.max(0, Math.min(sample.cy, 1)),
	};
}

export function normalizeCursorTelemetry(
	telemetry: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	return [...telemetry]
		.filter(
			(sample) =>
				Number.isFinite(sample.timeMs) && Number.isFinite(sample.cx) && Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((sample) => normalizeTelemetrySample(sample, totalMs));
}

export function detectZoomDwellCandidates(samples: CursorTelemetryPoint[]): ZoomDwellCandidate[] {
	if (samples.length < 2) {
		return [];
	}

	const dwellCandidates: ZoomDwellCandidate[] = [];
	let runStart = 0;

	const pushRunIfDwell = (startIndex: number, endIndexExclusive: number) => {
		if (endIndexExclusive - startIndex < 2) {
			return;
		}

		const start = samples[startIndex];
		const end = samples[endIndexExclusive - 1];
		const runDuration = end.timeMs - start.timeMs;
		if (runDuration < MIN_DWELL_DURATION_MS || runDuration > MAX_DWELL_DURATION_MS) {
			return;
		}

		const runSamples = samples.slice(startIndex, endIndexExclusive);
		const avgCx = runSamples.reduce((sum, sample) => sum + sample.cx, 0) / runSamples.length;
		const avgCy = runSamples.reduce((sum, sample) => sum + sample.cy, 0) / runSamples.length;

		dwellCandidates.push({
			centerTimeMs: Math.round((start.timeMs + end.timeMs) / 2),
			focus: { cx: avgCx, cy: avgCy },
			strength: runDuration,
		});
	};

	for (let index = 1; index < samples.length; index += 1) {
		const prev = samples[index - 1];
		const curr = samples[index];
		const distance = Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy);

		if (distance > DWELL_MOVE_THRESHOLD) {
			pushRunIfDwell(runStart, index);
			runStart = index;
		}
	}
	pushRunIfDwell(runStart, samples.length);

	return dwellCandidates;
}

// ── Click-based zoom suggestions ─────────────────────────────────────────────

const CLICK_STRENGTH: Record<string, number> = {
	"double-click": 1500,
	double: 1500,
	click: 1000,
	left: 1000,
	"right-click": 800,
	right: 800,
	"middle-click": 600,
	middle: 600,
};

function isClickInteraction(sample: CursorTelemetryPoint): boolean {
	const { interactionType, clickType } = sample;
	if (interactionType && interactionType !== "move" && interactionType !== "mouseup") {
		return true;
	}
	if (clickType) return true;
	return false;
}

function getClickStrength(sample: CursorTelemetryPoint): number {
	const type = sample.interactionType || sample.clickType || "";
	return CLICK_STRENGTH[type] ?? 1000;
}

/**
 * Classify post-click cursor behavior by analysing the 500ms of movement
 * following a click event.
 */
function classifyPostClickBehavior(
	samples: CursorTelemetryPoint[],
	clickIndex: number,
): ClickZoomCandidate["postBehavior"] {
	const clickSample = samples[clickIndex];
	const endTime = clickSample.timeMs + POST_CLICK_ANALYSIS_MS;

	const postSamples: CursorTelemetryPoint[] = [];
	for (let i = clickIndex + 1; i < samples.length && samples[i].timeMs <= endTime; i++) {
		postSamples.push(samples[i]);
	}

	if (postSamples.length === 0) return "text-field-click";

	const last = postSamples[postSamples.length - 1];
	const dx = last.cx - clickSample.cx;
	const dy = last.cy - clickSample.cy;
	const totalDist = Math.hypot(dx, dy);

	// Minimal movement → text field click
	if (totalDist < POST_CLICK_MOVE_THRESHOLD) return "text-field-click";

	// Primarily downward movement → dropdown open
	if (dy > POST_CLICK_MOVE_THRESHOLD && Math.abs(dy) > Math.abs(dx) * 1.5) {
		return "dropdown-open";
	}

	// Primarily horizontal movement → text selection
	if (Math.abs(dx) > POST_CLICK_MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
		return "text-selection";
	}

	return "navigation";
}

/**
 * Detect click-based zoom candidates from cursor telemetry.
 * Clusters clicks within CLICK_CLUSTER_WINDOW_MS and selects the strongest.
 */
export function detectClickZoomCandidates(samples: CursorTelemetryPoint[]): ClickZoomCandidate[] {
	const clickEvents: Array<{
		index: number;
		sample: CursorTelemetryPoint;
		strength: number;
	}> = [];

	for (let i = 0; i < samples.length; i++) {
		if (isClickInteraction(samples[i])) {
			clickEvents.push({
				index: i,
				sample: samples[i],
				strength: getClickStrength(samples[i]),
			});
		}
	}

	if (clickEvents.length === 0) return [];

	// Cluster clicks within CLICK_CLUSTER_WINDOW_MS
	const clusters: (typeof clickEvents)[] = [];
	let currentCluster: typeof clickEvents = [clickEvents[0]];

	for (let i = 1; i < clickEvents.length; i++) {
		const prevTime = clickEvents[i - 1].sample.timeMs;
		const currTime = clickEvents[i].sample.timeMs;

		if (currTime - prevTime <= CLICK_CLUSTER_WINDOW_MS) {
			currentCluster.push(clickEvents[i]);
		} else {
			clusters.push(currentCluster);
			currentCluster = [clickEvents[i]];
		}
	}
	clusters.push(currentCluster);

	// Convert clusters to candidates
	return clusters.map((cluster) => {
		// Use the strongest click's focus point
		const strongest = cluster.reduce((best, c) => (c.strength > best.strength ? c : best));
		const postBehavior = classifyPostClickBehavior(samples, strongest.index);

		// Center time is midpoint of cluster
		const startTime = cluster[0].sample.timeMs;
		const endTime = cluster[cluster.length - 1].sample.timeMs;

		return {
			centerTimeMs: Math.round((startTime + endTime) / 2),
			focus: { cx: strongest.sample.cx, cy: strongest.sample.cy },
			strength: strongest.strength,
			clickType: strongest.sample.interactionType || strongest.sample.clickType || "click",
			postBehavior,
		};
	});
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AutoZoomSuggestion {
	span: { start: number; end: number };
	focus: ZoomFocus;
}

/**
 * Build non-overlapping zoom suggestions from cursor telemetry: detect dwell moments
 * and click events, rank by strength, space by SUGGESTION_SPACING_MS, drop any
 * overlapping an existing region. Pure, shared by the magic-wand toggle and the
 * on-load auto-suggest pass.
 */
export function buildAutoZoomSuggestions(options: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	existingRegions: { startMs: number; endMs: number }[];
	defaultDurationMs: number;
}): AutoZoomSuggestion[] {
	const { cursorTelemetry, totalMs, existingRegions, defaultDurationMs } = options;
	if (totalMs <= 0 || cursorTelemetry.length < 2) {
		return [];
	}

	const defaultDuration = Math.min(defaultDurationMs, totalMs);
	if (defaultDuration <= 0) {
		return [];
	}

	const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);
	if (normalizedSamples.length < 2) {
		return [];
	}

	// Collect dwell-based candidates
	const dwellCandidates = detectZoomDwellCandidates(normalizedSamples);

	// Collect click-based candidates (if enabled)
	const clickCandidates = CLICK_ZOOM_SUGGESTIONS_ENABLED
		? detectClickZoomCandidates(normalizedSamples)
		: [];

	// Merge all candidates into a unified list sorted by strength
	const allCandidates: Array<{ centerTimeMs: number; focus: ZoomFocus; strength: number }> = [
		...dwellCandidates,
		...clickCandidates,
	].sort((a, b) => b.strength - a.strength);

	if (allCandidates.length === 0) {
		return [];
	}

	const reservedSpans = existingRegions
		.map((region) => ({ start: region.startMs, end: region.endMs }))
		.sort((a, b) => a.start - b.start);

	const acceptedCenters: number[] = [];
	const suggestions: AutoZoomSuggestion[] = [];

	for (const candidate of allCandidates) {
		const tooCloseToAccepted = acceptedCenters.some(
			(center) => Math.abs(center - candidate.centerTimeMs) < SUGGESTION_SPACING_MS,
		);
		if (tooCloseToAccepted) {
			continue;
		}

		const centeredStart = Math.round(candidate.centerTimeMs - defaultDuration / 2);
		const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - defaultDuration));
		const candidateEnd = candidateStart + defaultDuration;
		const hasOverlap = reservedSpans.some(
			(span) => candidateEnd > span.start && candidateStart < span.end,
		);
		if (hasOverlap) {
			continue;
		}

		reservedSpans.push({ start: candidateStart, end: candidateEnd });
		acceptedCenters.push(candidate.centerTimeMs);
		suggestions.push({
			span: { start: candidateStart, end: candidateEnd },
			focus: candidate.focus,
		});
	}

	return suggestions;
}
