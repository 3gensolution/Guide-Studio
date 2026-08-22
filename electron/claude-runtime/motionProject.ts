// ── Motion project contract ──────────────────────────────────────────────
//
// The same discipline as `storyboard.ts`, applied to the animated library.
// Claude picks a backdrop or typography animation by id and supplies copy;
// everything is clamped here before it reaches Remotion, so a malformed or
// over-ambitious plan degrades into a shorter, plainer video rather than a
// failed render.
//
// Two rules the planner is not trusted with, because they decide whether the
// output is watchable at all:
//   * an unknown id becomes a plain card rather than a blank scene
//   * copy is truncated to what the layout can actually show

import type { MotionAccent, MotionScene } from "../../src/lib/remotion/MotionGraphicsComposition";
import {
	BACKDROP_IDS,
	findBackdrop,
	findTextScene,
	TEXT_SCENE_IDS,
} from "../../src/lib/remotion/motion/catalog";
import { isRecord } from "./json";

export const MOTION_ACCENTS = ["indigo", "emerald", "amber", "rose", "violet"] as const;

export const MOTION_LIMITS = {
	minScenes: 2,
	maxScenes: 12,
	minSceneSeconds: 1.5,
	maxSceneSeconds: 12,
	maxTotalSeconds: 180,
	maxBullets: 4,
	eyebrow: 28,
	headline: 70,
	subhead: 130,
	bullet: 80,
	title: 90,
} as const;

export interface MotionProject {
	title: string;
	accent: MotionAccent;
	scenes: MotionScene[];
}

export interface NormalizeMotionOptions {
	fallbackTitle: string;
	targetSeconds?: number;
}

export interface NormalizeMotionResult {
	project: MotionProject;
	warnings: string[];
}

function clampText(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim().replace(/\s+/g, " ");
	if (!trimmed) return undefined;
	return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function clampSeconds(value: unknown, fallback: number): number {
	const seconds = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(
		MOTION_LIMITS.maxSceneSeconds,
		Math.max(MOTION_LIMITS.minSceneSeconds, Math.round(seconds * 10) / 10),
	);
}

/** The instruction describing the catalog. Generated, so it cannot drift. */
export function motionSystemPrompt(options: {
	format?: "landscape" | "vertical" | "square";
	targetSeconds?: number;
}): string {
	const backdrops = [
		'Backdrop ids for a "card" scene — an animated visual with your copy over it:',
		...BACKDROP_IDS.map((id) => `- "${id}": ${findBackdrop(id)?.description ?? ""}`),
	];
	const textScenes = [
		'Typography ids for a "text" scene — the animation renders your words itself:',
		...TEXT_SCENE_IDS.map((id) => {
			const entry = findTextScene(id);
			return `- "${id}": ${entry?.description ?? ""} (max ${entry?.maxChars ?? 24} characters)`;
		}),
	];

	const lines = [
		"You are a motion-graphics director for Guide Studio. Return valid compact JSON only, with no prose and no code fences.",
		'Shape: {"title":string,"accent":string,"scenes":[{"kind":"text"|"card","durationSeconds":number,...}]}',
		`accent is one of: ${MOTION_ACCENTS.join(", ")}.`,
		"",
		'A "text" scene sets: textScene (an id below) and text (the words it animates). Nothing else shows on that scene.',
		'A "card" scene sets: backdrop (an id below), and any of eyebrow, headline, subhead, bullets.',
		"",
		...backdrops,
		"",
		...textScenes,
		"",
		`Use ${MOTION_LIMITS.minScenes}-${MOTION_LIMITS.maxScenes} scenes. Each durationSeconds is ${MOTION_LIMITS.minSceneSeconds}-${MOTION_LIMITS.maxSceneSeconds}.`,
		`Keep headline under ${MOTION_LIMITS.headline} characters, subhead under ${MOTION_LIMITS.subhead}, each bullet under ${MOTION_LIMITS.bullet}, at most ${MOTION_LIMITS.maxBullets} bullets.`,
		"Text scenes are for short, punchy beats — a title, a turn, a closing line. Cards carry the explanation.",
		"Vary the backdrops; repeating one twice in a row reads as a stuck video.",
		"Write specific copy about the subject, never placeholder text, and do not invent prices, metrics, names, or URLs.",
	];

	if (options.format && options.format !== "landscape") {
		lines.push(
			options.format === "vertical"
				? "This renders vertically for a phone. Headlines of six words or fewer, at most three bullets per card."
				: "This renders square. Keep headlines short and use at most three bullets per card.",
		);
	}
	if (options.targetSeconds) {
		lines.push(`Aim for a total length near ${options.targetSeconds} seconds.`);
	}
	return lines.join("\n");
}

export function normalizeMotionProject(
	value: unknown,
	options: NormalizeMotionOptions,
): NormalizeMotionResult {
	const warnings: string[] = [];
	const root = isRecord(value) ? value : {};
	if (!isRecord(value)) warnings.push("The plan was not a JSON object.");

	const rawScenes = Array.isArray(root.scenes) ? root.scenes : [];
	if (!Array.isArray(root.scenes)) warnings.push("The plan contained no scene list.");
	if (rawScenes.length > MOTION_LIMITS.maxScenes) {
		warnings.push(
			`Kept the first ${MOTION_LIMITS.maxScenes} of ${rawScenes.length} proposed scenes.`,
		);
	}

	const scenes: MotionScene[] = [];
	let totalSeconds = 0;
	let previousBackdrop: string | undefined;

	for (const [index, candidate] of rawScenes.slice(0, MOTION_LIMITS.maxScenes).entries()) {
		if (!isRecord(candidate)) {
			warnings.push(`Dropped scene ${index + 1}: it was not an object.`);
			continue;
		}
		if (totalSeconds >= MOTION_LIMITS.maxTotalSeconds) {
			warnings.push(`Stopped at ${MOTION_LIMITS.maxTotalSeconds}s of video.`);
			break;
		}

		const durationSeconds = clampSeconds(candidate.durationSeconds, 4);
		const requestedKind = candidate.kind === "text" ? "text" : "card";

		if (requestedKind === "text") {
			const entry = findTextScene(
				typeof candidate.textScene === "string" ? candidate.textScene : undefined,
			);
			const text = clampText(candidate.text ?? candidate.headline, entry?.maxChars ?? 24);
			if (entry && text) {
				scenes.push({
					id: `motion-${index + 1}`,
					kind: "text",
					durationSeconds,
					textScene: entry.id,
					text,
				});
				totalSeconds += durationSeconds;
				continue;
			}
			warnings.push(
				entry
					? `Scene ${index + 1} had no text for the "${entry.id}" animation, so it became a card.`
					: `Scene ${index + 1} named an unknown typography animation, so it became a card.`,
			);
		}

		// Card scene — the fallback for anything that could not be a text scene.
		let backdropId = findBackdrop(
			typeof candidate.backdrop === "string" ? candidate.backdrop : undefined,
		)?.id;
		if (!backdropId) {
			// A card with no valid backdrop still renders, just flat; pick a safe
			// default rather than leaving it black.
			backdropId = "gradient-drift";
			if (candidate.backdrop !== undefined) {
				warnings.push(`Scene ${index + 1} named an unknown backdrop, so it uses "gradient-drift".`);
			}
		}
		if (backdropId === previousBackdrop) {
			const alternative = BACKDROP_IDS.find((id) => id !== backdropId);
			if (alternative) {
				warnings.push(
					`Scene ${index + 1} repeated the previous backdrop, so it uses "${alternative}".`,
				);
				backdropId = alternative;
			}
		}

		const bullets = Array.isArray(candidate.bullets)
			? candidate.bullets
					.map((bullet) => clampText(bullet, MOTION_LIMITS.bullet))
					.filter((bullet): bullet is string => Boolean(bullet))
					.slice(0, MOTION_LIMITS.maxBullets)
			: undefined;

		const headline = clampText(candidate.headline, MOTION_LIMITS.headline);
		const subhead = clampText(candidate.subhead, MOTION_LIMITS.subhead);
		const eyebrow = clampText(candidate.eyebrow, MOTION_LIMITS.eyebrow);

		if (!headline && !subhead && !bullets?.length) {
			warnings.push(`Dropped scene ${index + 1}: it had no copy to show.`);
			continue;
		}

		scenes.push({
			id: `motion-${index + 1}`,
			kind: "card",
			durationSeconds,
			backdrop: backdropId,
			...(eyebrow ? { eyebrow } : {}),
			...(headline ? { headline } : {}),
			...(subhead ? { subhead } : {}),
			...(bullets?.length ? { bullets } : {}),
		});
		previousBackdrop = backdropId;
		totalSeconds += durationSeconds;
	}

	if (scenes.length < MOTION_LIMITS.minScenes) {
		warnings.push("The plan had too few usable scenes, so a plain opening card was added.");
		scenes.unshift({
			id: "motion-fallback",
			kind: "card",
			durationSeconds: 4,
			backdrop: "gradient-drift",
			headline: options.fallbackTitle.slice(0, MOTION_LIMITS.headline),
		});
	}

	const accent =
		typeof root.accent === "string" && (MOTION_ACCENTS as readonly string[]).includes(root.accent)
			? (root.accent as MotionAccent)
			: "indigo";

	return {
		project: {
			title: clampText(root.title, MOTION_LIMITS.title) ?? options.fallbackTitle,
			accent,
			scenes,
		},
		warnings,
	};
}

export function motionDurationSeconds(project: MotionProject): number {
	return project.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
}
