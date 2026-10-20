import type { MotionScene } from "../../src/lib/remotion/MotionGraphicsComposition";

export const LAUNCH_FILM_BEAT_ROLES = [
	"hook",
	"problem",
	"product-proof",
	"brand-world",
	"thesis",
	"feature-reveal",
	"logo-lockup",
	"cta",
] as const;

export type LaunchFilmBeatRole = (typeof LAUNCH_FILM_BEAT_ROLES)[number];

export const LAUNCH_FILM_MOTION_PRESETS = [
	"hero-push",
	"macro-crop",
	"collage",
	"card-stack",
	"kinetic-type",
	"mask-reveal",
	"parallax",
	"scatter-assemble",
	"match-cut",
] as const;

export type LaunchFilmMotionPreset = (typeof LAUNCH_FILM_MOTION_PRESETS)[number];

export const LAUNCH_FILM_TRANSITIONS = [
	"cut",
	"crossfade",
	"wipe",
	"scale-through",
	"match-cut",
] as const;

export type LaunchFilmTransition = (typeof LAUNCH_FILM_TRANSITIONS)[number];

const DEFAULT_ROLES: readonly LaunchFilmBeatRole[] = [
	"hook",
	"product-proof",
	"brand-world",
	"thesis",
	"logo-lockup",
];

const DEFAULT_MOTION: readonly LaunchFilmMotionPreset[] = [
	"kinetic-type",
	"hero-push",
	"collage",
	"macro-crop",
	"card-stack",
	"scatter-assemble",
];

const TEXT_MOTION_VARIANTS = ["kinetic", "mask-reveal", "scramble", "explode"] as const;

export function normalizeLaunchFilmRole(
	value: unknown,
	index: number,
	fallback?: LaunchFilmBeatRole,
): LaunchFilmBeatRole {
	return LAUNCH_FILM_BEAT_ROLES.includes(value as LaunchFilmBeatRole)
		? (value as LaunchFilmBeatRole)
		: (fallback ?? DEFAULT_ROLES[Math.min(index, DEFAULT_ROLES.length - 1)] ?? "product-proof");
}

export function normalizeLaunchFilmMotion(value: unknown, index: number): LaunchFilmMotionPreset {
	return LAUNCH_FILM_MOTION_PRESETS.includes(value as LaunchFilmMotionPreset)
		? (value as LaunchFilmMotionPreset)
		: (DEFAULT_MOTION[index % DEFAULT_MOTION.length] ?? "hero-push");
}

export function normalizeLaunchFilmTransition(value: unknown, index: number): LaunchFilmTransition {
	if (LAUNCH_FILM_TRANSITIONS.includes(value as LaunchFilmTransition)) {
		return value as LaunchFilmTransition;
	}
	return index === 0 ? "cut" : index % 3 === 0 ? "wipe" : "crossfade";
}

export function launchFilmSystemPrompt(): string {
	return [
		"Launch-film editorial grammar:",
		"- Plan a continuous film, not unrelated cards. Use this arc when the brief supports it: hook → problem or tension → product proof → brand world → thesis/outcome → logo lockup → CTA.",
		"- Every beat must have one job, one dominant visual idea, and one motion treatment.",
		"- Use supplied video and images as proof and atmosphere. Do not replace relevant source footage with generic generated filler.",
		"- Alternate visual density and breathing room. Do not repeat the same reveal or backdrop three times in a row.",
		"- Keep captions off image, video, logo, and mixed-media scenes. If a skill or narration instruction asks for captions there, ignore it.",
		`- Each scene may set beatRole (${LAUNCH_FILM_BEAT_ROLES.join(" | ")}), motionPreset (${LAUNCH_FILM_MOTION_PRESETS.join(" | ")}), transitionIn, and transitionOut (${LAUNCH_FILM_TRANSITIONS.join(" | ")}). Use only these values.`,
		"- Preserve supplied logo pixels, color, proportions, and clear space. Animate the supplied logo; never recreate it as ordinary text.",
		"- Keep the logo and tagline in one closing lockup scene. The final scene must resolve clearly and hold long enough to register.",
	].join("\n");
}

export function launchFilmStructureWarnings(
	scenes: readonly MotionScene[],
	options: { hasVisualAsset: boolean; requireLogo: boolean },
): string[] {
	const warnings: string[] = [];
	const textOnlyKinds = new Set(["text", "card"]);
	const visualKinds = new Set(["image", "video", "logo", "layered"]);

	if (scenes.length > 0 && textOnlyKinds.has(scenes[0]?.kind ?? "")) {
		warnings.push(
			"Launch-film opening is text-led; prefer a visual hook when supplied media exists.",
		);
	}
	if (options.hasVisualAsset) {
		const visualCount = scenes.filter((scene) => visualKinds.has(scene.kind)).length;
		if (visualCount < 2) {
			warnings.push("Launch film has fewer than two visual-proof beats despite available media.");
		}
		let textRun = 0;
		for (const scene of scenes) {
			if (textOnlyKinds.has(scene.kind)) textRun += 1;
			else textRun = 0;
			if (textRun > 2) {
				warnings.push("Launch film contains more than two consecutive text/card beats.");
				break;
			}
		}
	}
	if (options.requireLogo && scenes.length > 0 && scenes.at(-1)?.kind !== "logo") {
		warnings.push("Launch film does not end with the supplied logo lockup.");
	}

	let previousMotion: string | undefined;
	let repeatedMotionCount = 0;
	for (const scene of scenes) {
		if (scene.motionPreset && scene.motionPreset === previousMotion) repeatedMotionCount += 1;
		else repeatedMotionCount = 1;
		previousMotion = scene.motionPreset;
		if (repeatedMotionCount >= 3) {
			warnings.push("Launch film repeats the same motion treatment three times consecutively.");
			break;
		}
	}

	return [...new Set(warnings)];
}

/**
 * Release-facing checks for the launch-film skill.
 *
 * The planner is allowed to be expressive, but it is not allowed to hand the
 * renderer a plan that quietly drops supplied media, invents an unavailable
 * asset, or puts captions on the very footage the editor is trying to show.
 * These remain warnings rather than hidden rewrites: a senior editor can see
 * the issue in the review panel and make an intentional call.
 */
export function launchFilmReadinessWarnings(
	scenes: readonly MotionScene[],
	options: {
		hasVisualAsset: boolean;
		hasVideoAsset?: boolean;
		hasImageAsset?: boolean;
		requireLogo: boolean;
		availableAssetIds?: readonly string[];
		availableVideoAssetIds?: readonly string[];
	},
): string[] {
	const warnings: string[] = [];
	const imageAssets = new Set(options.availableAssetIds ?? []);
	const videoAssets = new Set(options.availableVideoAssetIds ?? []);
	const visualKinds = new Set<MotionScene["kind"]>(["image", "video", "logo", "layered"]);

	if (scenes.length === 0) {
		return ["Launch film has no renderable scenes."];
	}

	const visualScenes = scenes.filter((scene) => visualKinds.has(scene.kind));
	if (options.hasVisualAsset && visualScenes.length === 0) {
		warnings.push(
			"Supplied media is available, but the launch film contains no visual-proof scene.",
		);
	}
	if (
		options.hasVideoAsset &&
		!scenes.some(
			(scene) => scene.kind === "video" || scene.layers?.some((layer) => layer.kind === "video"),
		)
	) {
		warnings.push("Attached source video is available, but no scene uses it.");
	}
	if (
		options.hasImageAsset &&
		!scenes.some(
			(scene) =>
				scene.kind === "image" ||
				scene.kind === "logo" ||
				scene.layers?.some((layer) => layer.kind === "image" || layer.kind === "logo"),
		)
	) {
		warnings.push("Attached image or logo media is available, but no scene uses it.");
	}

	for (const [index, scene] of scenes.entries()) {
		if (!Number.isFinite(scene.durationSeconds) || scene.durationSeconds < 1.5) {
			warnings.push(`Scene ${index + 1} has an unsafe duration for review.`);
		}
		const checkAsset = (kind: "image" | "video" | "logo", assetId: string | undefined) => {
			if (!assetId) {
				warnings.push(`Scene ${index + 1} is a ${kind} scene without a validated asset.`);
				return;
			}
			const valid = kind === "video" ? videoAssets.has(assetId) : imageAssets.has(assetId);
			if (imageAssets.size > 0 || videoAssets.size > 0) {
				if (!valid) warnings.push(`Scene ${index + 1} references an unavailable ${kind} asset.`);
			}
		};

		if (scene.kind === "image") checkAsset("image", scene.imageAssetId);
		if (scene.kind === "video") checkAsset("video", scene.videoAssetId);
		if (scene.kind === "logo") checkAsset("logo", scene.logoAssetId);
		for (const layer of scene.layers ?? []) {
			if (layer.kind === "image" || layer.kind === "video" || layer.kind === "logo") {
				checkAsset(layer.kind, layer.assetId);
			}
		}

		if (visualKinds.has(scene.kind) && scene.captionsAllowed !== false) {
			warnings.push(`Scene ${index + 1} is visual proof but captions are not explicitly disabled.`);
		}
	}

	if (options.requireLogo) {
		const finalScene = scenes.at(-1);
		if (finalScene?.kind !== "logo") {
			warnings.push("Launch film must end with one supplied logo lockup scene.");
		} else if (!finalScene.logoAssetId) {
			warnings.push("The closing logo lockup has no supplied logo asset.");
		}
	}

	const visualMotion = visualScenes
		.map((scene) => scene.motionPreset)
		.filter((preset): preset is NonNullable<MotionScene["motionPreset"]> => Boolean(preset));
	for (let index = 2; index < visualMotion.length; index += 1) {
		if (
			visualMotion[index] === visualMotion[index - 1] &&
			visualMotion[index] === visualMotion[index - 2]
		) {
			warnings.push(
				"Launch film repeats one visual motion treatment three times; vary the camera language.",
			);
			break;
		}
	}

	return [...new Set(warnings)];
}

export function applyLaunchFilmMetadata(
	scenes: readonly MotionScene[],
	requestedScenes: readonly unknown[] = [],
): MotionScene[] {
	let previousTextScene: string | undefined;
	const isVisualScene = (scene: MotionScene | undefined) =>
		scene?.kind === "image" ||
		scene?.kind === "video" ||
		scene?.kind === "logo" ||
		scene?.kind === "layered";
	return scenes.map((scene, index) => {
		const visual =
			scene.kind === "image" ||
			scene.kind === "video" ||
			scene.kind === "logo" ||
			scene.kind === "layered";
		const requestedIndex = /^motion-(\d+)$/.exec(scene.id)?.[1];
		const requested = requestedIndex ? requestedScenes[Number(requestedIndex) - 1] : undefined;
		const requestedRecord =
			requested && typeof requested === "object" && requested !== null
				? (requested as Record<string, unknown>)
				: undefined;
		const defaultRole =
			scene.kind === "logo"
				? "logo-lockup"
				: index === 0
					? "hook"
					: visual
						? index === 1
							? "product-proof"
							: "brand-world"
						: index === scenes.length - 1
							? "thesis"
							: "problem";
		const beatRole: LaunchFilmBeatRole =
			scene.kind === "logo"
				? "logo-lockup"
				: normalizeLaunchFilmRole(requestedRecord?.beatRole, index, defaultRole);
		const adjacentVisuals = isVisualScene(scene) && isVisualScene(scenes[index - 1]);
		let textScene = scene.textScene;
		if (scene.kind === "text") {
			if (textScene === previousTextScene) {
				textScene = TEXT_MOTION_VARIANTS[index % TEXT_MOTION_VARIANTS.length];
			}
			previousTextScene = textScene;
		} else {
			previousTextScene = undefined;
		}
		return {
			...scene,
			...(textScene ? { textScene } : {}),
			beatRole,
			motionPreset: normalizeLaunchFilmMotion(
				requestedRecord?.motionPreset ?? scene.motionPreset,
				index,
			),
			transitionIn: normalizeLaunchFilmTransition(
				requestedRecord?.transitionIn ??
					scene.transitionIn ??
					(adjacentVisuals ? "match-cut" : undefined),
				index,
			),
			transitionOut: normalizeLaunchFilmTransition(
				index === scenes.length - 1
					? "cut"
					: (requestedRecord?.transitionOut ?? scene.transitionOut),
				index + 1,
			),
			// Visual proof is always clean. A model cannot override the caption
			// safety rule by setting captionsAllowed on an image/video scene.
			captionsAllowed: visual ? false : requestedRecord?.captionsAllowed !== false,
		};
	});
}
