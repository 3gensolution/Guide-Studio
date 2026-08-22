import type {
	HyperFrame,
	HyperFrameAccent,
	HyperFrameKind,
} from "../../src/lib/remotion/HyperFrameComposition";
import {
	AVAILABLE_SCENE_3D_IDS,
	DEVICE_KINDS,
	type DeviceKind,
	isScene3dId,
	isSceneAvailable,
	SCENE_3D_LIMITS,
	SCENE_3D_REQUIREMENTS,
	type Scene3dId,
	type Scene3dParams,
} from "../../src/lib/remotion/three/scenes";
import { isRecord, type JsonSchema } from "./json";

// ── HyperFrame storyboard contract ───────────────────────────────────────
//
// The planner model never emits code for the demo renderer. It emits a
// storyboard: a bounded list of frames drawn from a fixed component library,
// each carrying text and an optional normalized focus region. Everything here
// is clamped before it reaches Remotion, so a malformed or adversarial model
// response degrades into a shorter, plainer video rather than a failed render.

export const HYPERFRAME_KINDS = [
	"title",
	"screen",
	"callout",
	"split",
	"bullets",
	"statement",
	"outro",
	"image",
	"imageSplit",
	"scene3d",
] as const satisfies readonly HyperFrameKind[];

export const HYPERFRAME_ACCENTS = [
	"indigo",
	"emerald",
	"amber",
	"rose",
	"violet",
] as const satisfies readonly HyperFrameAccent[];

/** Frames that show the imported screen recording. */
const RECORDING_KINDS = new Set<HyperFrameKind>(["screen", "callout", "split"]);

/**
 * The image budget quoted to the planner. It mirrors the resolver's own cap in
 * `assets.ts`; the two are stated once here so the contract cannot promise
 * more pictures than the fetcher will go and get.
 */
export const ASSET_QUERY_LIMITS = { maxAssets: 8 } as const;

/** Frames that show an image or GIF the user supplied. */
const IMAGE_KINDS = new Set<HyperFrameKind>(["image", "imageSplit"]);

/** Substitutes used when a requested image never arrived. */
const WITHOUT_IMAGE: Partial<Record<HyperFrameKind, HyperFrameKind>> = {
	image: "statement",
	imageSplit: "bullets",
	scene3d: "statement",
};

/** Substitutes used when a storyboard asks for footage that is not attached. */
const WITHOUT_RECORDING: Partial<Record<HyperFrameKind, HyperFrameKind>> = {
	screen: "statement",
	callout: "statement",
	split: "bullets",
};

/**
 * The nearest allowed text frame for a kind a skill has ruled out. Prefers the
 * substitution already defined for that kind, then falls back through the plain
 * text frames — a skill that allows none of them is a misconfiguration, and
 * `statement` is the safest thing to render in that case.
 */
/**
 * Puts a required credit on screen. It goes on the closing card, where a viewer
 * expects credits and where it does not fight the video's own copy; if the
 * planner wrote no outro, one is appended rather than the credit being dropped.
 *
 * Mutates in place, and is the last thing to touch the frame list — nothing
 * after this may remove it.
 */
function applyAttribution(frames: HyperFrame[], line: string | undefined) {
	if (!line) return;
	const credit = text(line, LIMITS.subhead);
	if (!credit) return;
	const outro = [...frames].reverse().find((frame) => frame.kind === "outro");
	if (!outro) {
		frames.push({
			id: `frame-attribution-${frames.length + 1}`,
			kind: "outro",
			durationSeconds: 3,
			headline: "Thanks for watching",
			subhead: credit,
		});
		return;
	}
	// The planner's own call to action still matters, so the credit joins it
	// rather than replacing it — unless the two together would be clipped.
	const combined = outro.subhead ? `${outro.subhead} · ${credit}` : credit;
	outro.subhead = combined.length <= LIMITS.subhead ? combined : credit;
}

/**
 * Validates a 3D scene request field by field. Returns nothing when the scene
 * cannot render anything worth watching — an unknown id, or a scene that needs
 * an image and was given none — and the caller degrades the frame to text.
 *
 * Nothing here trusts a number: an unbounded spin or a particle count of a
 * million is a hung render rather than an error, so every value is clamped.
 */
export function normalizeScene3dRequest(
	candidate: Record<string, unknown>,
	label: string,
	available: Set<string>,
	warnings: string[],
): { scene: Scene3dId; params: Scene3dParams } | undefined {
	const requested = candidate.scene;
	if (!isScene3dId(requested)) {
		warnings.push(
			`${label} asked for an unknown 3D scene${
				typeof requested === "string" ? ` ("${requested.slice(0, 24)}")` : ""
			}.`,
		);
		return undefined;
	}
	const scene = requested;
	const raw = isRecord(candidate.sceneParams) ? candidate.sceneParams : {};
	const requirements = SCENE_3D_REQUIREMENTS[scene];
	const params: Scene3dParams = {};

	if (typeof raw.device === "string" && DEVICE_KINDS.includes(raw.device as DeviceKind)) {
		params.device = raw.device as DeviceKind;
	}
	// Asset ids are checked against what genuinely arrived, exactly as the 2D
	// image frames do — a scene cannot name a file the run never received.
	const assetId = text(raw.assetId, 80);
	if (assetId && available.has(assetId)) params.assetId = assetId;
	const assetIds = Array.isArray(raw.assetIds)
		? raw.assetIds
				.flatMap((entry) => {
					const id = text(entry, 80);
					return id && available.has(id) ? [id] : [];
				})
				.slice(0, SCENE_3D_LIMITS.maxCardAssets)
		: [];
	if (assetIds.length) params.assetIds = assetIds;

	if (typeof raw.spinDegrees === "number" && Number.isFinite(raw.spinDegrees)) {
		params.spinDegrees = Math.min(
			SCENE_3D_LIMITS.maxSpinDegrees,
			Math.max(SCENE_3D_LIMITS.minSpinDegrees, raw.spinDegrees),
		);
	}
	if (typeof raw.depth === "number" && Number.isFinite(raw.depth)) {
		params.depth = Math.min(
			SCENE_3D_LIMITS.maxDepth,
			Math.max(SCENE_3D_LIMITS.minDepth, raw.depth),
		);
	}
	if (typeof raw.density === "number" && Number.isFinite(raw.density)) {
		params.density = Math.round(
			Math.min(SCENE_3D_LIMITS.maxDensity, Math.max(SCENE_3D_LIMITS.minDensity, raw.density)),
		);
	}
	if (Array.isArray(raw.bars)) {
		const bars = raw.bars
			.flatMap((entry) => {
				if (!isRecord(entry)) return [];
				const value = entry.value;
				if (typeof value !== "number" || !Number.isFinite(value)) return [];
				return [
					{
						label: text(entry.label, SCENE_3D_LIMITS.barLabel) ?? "",
						value: Math.min(SCENE_3D_LIMITS.maxBarValue, Math.max(0, value)),
					},
				];
			})
			.slice(0, SCENE_3D_LIMITS.maxBars);
		if (bars.length) params.bars = bars;
	}

	if (requirements.needsAsset && !params.assetId && !params.assetIds?.length) {
		warnings.push(`${label} needs a supplied image for its 3D scene, and none was available.`);
		return undefined;
	}
	if (requirements.needsBars && !params.bars?.length) {
		warnings.push(`${label} needs chart data for its 3D scene, and none was usable.`);
		return undefined;
	}
	// `card_stack` reads `assetIds`; a single `assetId` is promoted so a planner
	// that used the simpler field still gets a scene rather than a text frame.
	if (scene === "card_stack" && !params.assetIds?.length && params.assetId) {
		params.assetIds = [params.assetId];
	}
	return { scene, params };
}

function textEquivalent(kind: HyperFrameKind, allowed: HyperFrameKind[]): HyperFrameKind {
	const preferred = WITHOUT_RECORDING[kind] ?? WITHOUT_IMAGE[kind];
	const candidates: HyperFrameKind[] = [
		...(preferred ? [preferred] : []),
		"statement",
		"bullets",
		"title",
	];
	return candidates.find((candidate) => allowed.includes(candidate)) ?? "statement";
}

export const LIMITS = {
	minFrames: 2,
	maxFrames: 14,
	minFrameSeconds: 1.5,
	maxFrameSeconds: 20,
	maxTotalSeconds: 240,
	maxBullets: 5,
	eyebrow: 32,
	headline: 90,
	subhead: 160,
	bullet: 110,
	caption: 220,
	title: 90,
	/** Matches the Phase 3 focus-effect ceiling so staged zooms stay motion-safe. */
	maxFocusScale: 2.25,
	/**
	 * A 3D frame renders roughly an order of magnitude slower than a 2D one.
	 * Two is where a minute-long demo still finishes; the third is where it
	 * stops. Enforced here rather than asked of the planner.
	 */
	maxScene3dFrames: 2,
} as const;

export interface HyperFrameStoryboard {
	title: string;
	accent: HyperFrameAccent;
	frames: HyperFrame[];
}

export interface NormalizeOptions {
	/** False when no screen recording is attached to the session. */
	hasRecording: boolean;
	/** Known recording length, used to keep `sourceStartSeconds` inside the media. */
	recordingSeconds?: number;
	fallbackTitle: string;
	/** Ids of supplied images and GIFs an image frame is allowed to reference. */
	availableAssetIds?: string[];
	/**
	 * Frame kinds the selected skill permits. Omitted, the whole library is
	 * allowed. A kind outside this set degrades to its text equivalent rather
	 * than being dropped, so a skill restriction shortens no video.
	 */
	allowedKinds?: HyperFrameKind[];
	/**
	 * Credit that a licence obliges the finished video to show. Applied here
	 * rather than asked of the planner, because a licence term is not something
	 * a model gets to decide whether to honour.
	 */
	attributionLine?: string;
}

export interface NormalizeResult {
	storyboard: HyperFrameStoryboard;
	warnings: string[];
}

/** JSON-schema projection used at the tool boundary. */
export const HYPERFRAME_STORYBOARD_SCHEMA: JsonSchema = {
	type: "object",
	properties: {
		title: { type: "string" },
		accent: { type: "string", enum: HYPERFRAME_ACCENTS },
		frames: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string" },
					kind: { type: "string", enum: HYPERFRAME_KINDS },
					durationSeconds: { type: "number" },
					eyebrow: { type: "string" },
					headline: { type: "string" },
					subhead: { type: "string" },
					caption: { type: "string" },
					side: { type: "string", enum: ["left", "right"] },
					assetId: { type: "string" },
					assetQuery: { type: "string" },
					sourceStartSeconds: { type: "number" },
					bullets: { type: "array", items: { type: "string" } },
					focus: {
						type: "object",
						properties: {
							cx: { type: "number" },
							cy: { type: "number" },
							scale: { type: "number" },
						},
						required: ["cx", "cy", "scale"],
						additionalProperties: false,
					},
				},
				required: ["kind", "durationSeconds"],
				additionalProperties: false,
			},
		},
	},
	required: ["title", "accent", "frames"],
	additionalProperties: false,
};

/**
 * Instruction given to the Guide API planner. It describes the component
 * library rather than a rendering API, so a small model only has to choose
 * frames and write copy.
 */
/** One supplied asset as the planner sees it: never a path, never bytes. */
export interface StoryboardAssetSummary {
	id: string;
	label: string;
	kind: string;
	/** What the image was found to contain, once it has been looked at. */
	shows?: string;
	/** Text legible in the image, so frame copy does not repeat it. */
	text?: string[];
}

export function storyboardSystemPrompt(options: {
	hasRecording: boolean;
	assets: StoryboardAssetSummary[];
	/**
	 * True when Guide Studio will resolve `assetQuery` into a real picture
	 * after the run. Off, an image frame still needs a supplied asset.
	 */
	canFetchImages?: boolean;
	/** Frame kinds the selected skill permits, if it restricts them. */
	allowedKinds?: HyperFrameKind[];
	/** The skill's own direction, and the shape it renders to. */
	skillDirection?: string;
	format?: "landscape" | "vertical" | "square";
	targetSeconds?: number;
}) {
	const lines = [STORYBOARD_SYSTEM_PROMPT];
	if (options.allowedKinds?.length) {
		lines.push(
			`For this video you may only use these frame kinds: ${options.allowedKinds.join(", ")}. Any other kind will be replaced with plain text.`,
		);
	}
	if (!options.allowedKinds || options.allowedKinds.includes("scene3d")) {
		lines.push(
			`A "scene3d" frame renders one of a fixed set of 3D scenes. Set scene and sceneParams:`,
			...AVAILABLE_SCENE_3D_IDS.map((id) => `- "${id}": ${SCENE_3D_REQUIREMENTS[id].description}`),
			`At most ${LIMITS.maxScene3dFrames} scene3d frames per video; any beyond that become text. A scene that needs an image and has none becomes text, so only use one when a suitable assetId exists.`,
		);
	}
	if (options.format && options.format !== "landscape") {
		lines.push(
			options.format === "vertical"
				? "This renders vertically for a phone screen. Keep headlines short — six words or fewer — and put at most three bullets on a frame."
				: "This renders as a square. Keep headlines short and put at most four bullets on a frame.",
		);
	}
	if (options.targetSeconds) {
		lines.push(`Aim for a total length near ${options.targetSeconds} seconds.`);
	}
	if (options.skillDirection) lines.push(options.skillDirection);
	lines.push(
		options.hasRecording
			? "A screen recording is attached, so screen, callout, and split frames are available."
			: "No screen recording is attached. Do not use screen, callout, or split frames.",
	);
	if (options.canFetchImages) {
		lines.push(
			"Guide Studio can fetch openly-licensed photographs for you, so an image frame does not need a supplied asset.",
			'On an image or imageSplit frame, set assetQuery to a short plain description of the picture you want — "solar panels on a house roof", "a nurse using a tablet at a ward desk" — and leave assetId out.',
			"After you finish, Guide Studio searches for each query, downloads what it finds, and puts the photographer's credit on the closing card. You never see the file.",
			`Use at most ${ASSET_QUERY_LIMITS.maxAssets} image frames per video, and only where a photograph earns its place.`,
			"Ask only for generic photographs: a scene, an object, a place, a person working. Stock search cannot produce a specific company's product, logo, screenshot, chart, or any picture that has to be factually exact — plan those as bullets or statement frames instead.",
			"A query that finds nothing becomes a text frame, so never let a frame carry information that is only in its picture.",
		);
	}
	if (options.assets.length) {
		lines.push(
			"These supplied assets are available. Set assetId on an image or imageSplit frame to use one:",
			...options.assets.map((asset) => {
				const detail = [
					`- assetId "${asset.id}" (${asset.kind}): ${asset.label}`,
					// The description is what makes copy specific to the picture
					// instead of specific to the filename.
					asset.shows ? ` — shows: ${asset.shows}` : "",
					asset.text?.length ? ` — text in image: ${asset.text.slice(0, 5).join(" / ")}` : "",
				];
				return detail.join("");
			}),
			"Only use an assetId from this list. An image frame without a valid assetId will be replaced with plain text.",
			"Write copy that suits what each image actually shows, and do not repeat text that is already legible inside the image.",
		);
	} else if (!options.canFetchImages) {
		lines.push("No images or GIFs were supplied, so do not use image or imageSplit frames.");
	}
	return lines.join("\n");
}

export const STORYBOARD_SYSTEM_PROMPT = [
	"You are a product-demo director for Guide Studio. Return valid compact JSON only, with no prose and no code fences.",
	'Shape: {"title":string,"accent":string,"frames":[{"kind":string,"durationSeconds":number,...}]}',
	`accent is one of: ${HYPERFRAME_ACCENTS.join(", ")}.`,
	"Each frame uses exactly one kind from this fixed library:",
	'- "title": opening card. Fields: eyebrow, headline, subhead.',
	'- "screen": the screen recording playing full-frame. Fields: headline, subhead, caption, focus, sourceStartSeconds.',
	'- "callout": the recording with a highlight ring on one point. Fields: headline, subhead, caption, focus, sourceStartSeconds. focus is required.',
	'- "split": recording beside supporting copy. Fields: eyebrow, headline, subhead, bullets, side ("left" or "right"), focus, sourceStartSeconds.',
	'- "bullets": full-frame list. Fields: headline, bullets.',
	'- "statement": one large centred sentence. Fields: eyebrow, headline, subhead.',
	'- "outro": closing card. Fields: headline, subhead (a short call to action).',
	'- "image": an image or GIF, full frame. Fields: assetId or assetQuery (one is required), headline, subhead, caption.',
	'- "imageSplit": an image beside copy. Fields: assetId or assetQuery (one is required), eyebrow, headline, subhead, bullets, side.',
	"focus is {cx,cy,scale}: cx and cy are 0-1 fractions of the frame where the viewer should look; scale is 1.0-2.25 zoom.",
	"sourceStartSeconds is where in the recording that frame begins; keep frames in increasing order.",
	`Use ${LIMITS.minFrames}-${LIMITS.maxFrames} frames. Each durationSeconds is ${LIMITS.minFrameSeconds}-${LIMITS.maxFrameSeconds}.`,
	`Keep headline under ${LIMITS.headline} characters, subhead under ${LIMITS.subhead}, each bullet under ${LIMITS.bullet}, at most ${LIMITS.maxBullets} bullets.`,
	"Start with a title frame and end with an outro frame. Write specific copy about the product shown, never placeholder text.",
	"Do not invent file names, URLs, prices, or personal data.",
].join("\n");

/**
 * Instruction for the self-review pass. It is deliberately about what is on
 * screen, not about the JSON: the storyboard already passed validation, so the
 * only things left to find are visual ones the schema cannot express.
 */
export const STORYBOARD_REVIEW_PROMPT = [
	"You are reviewing rendered frames from a product demo you planned, and correcting the storyboard.",
	"You are shown the storyboard JSON and images of how some of its frames actually render.",
	"Look for problems that are only visible on screen:",
	"- text clipped, overlapping, or running outside the frame",
	"- a frame that reads as empty or nearly empty",
	"- a callout ring or zoom landing on blank background instead of the thing being discussed",
	"- a zoom so tight the content is unreadable, or so loose the point is lost",
	"- copy that repeats the previous frame word for word",
	"Fix those by editing the storyboard: shorten copy, move or soften a focus point, change a frame kind, or adjust a duration.",
	"Change as little as possible. If a frame looks correct, return it untouched.",
	"Return the complete corrected storyboard as valid compact JSON only, in exactly the same shape, with no prose and no code fences.",
].join("\n");

/** Strips control characters and collapses whitespace before length-clamping. */
function text(value: unknown, maximumLength: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control bytes is the point
		.replace(/[\u0000-\u001F\u007F]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned ? cleaned.slice(0, maximumLength) : undefined;
}

/**
 * Clamping silently would hide a correction from both the reviewer and the
 * planner's repair pass, so every out-of-range value the model actually supplied
 * reports itself. A value the model omitted is a default, not a correction.
 */
function clampReported(
	value: unknown,
	minimum: number,
	maximum: number,
	fallback: number,
	label: string,
	warnings: string[],
) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		if (value !== undefined) warnings.push(`${label} was not a number; used ${fallback}.`);
		return fallback;
	}
	const result = Math.min(maximum, Math.max(minimum, value));
	if (result !== value) {
		warnings.push(
			`${label} was ${value}, outside the allowed ${minimum}-${maximum}; used ${result}.`,
		);
	}
	return result;
}

function normalizeFocus(value: unknown, label: string, warnings: string[]) {
	if (!isRecord(value)) return undefined;
	const cx = typeof value.cx === "number" && Number.isFinite(value.cx) ? value.cx : undefined;
	const cy = typeof value.cy === "number" && Number.isFinite(value.cy) ? value.cy : undefined;
	if (cx === undefined || cy === undefined) return undefined;
	return {
		cx: clampReported(cx, 0, 1, 0.5, `${label} focus.cx`, warnings),
		cy: clampReported(cy, 0, 1, 0.5, `${label} focus.cy`, warnings),
		scale: clampReported(
			value.scale,
			1,
			LIMITS.maxFocusScale,
			1.6,
			`${label} focus.scale`,
			warnings,
		),
	};
}

/**
 * Turns an arbitrary parsed model response into a renderable storyboard.
 * Invalid frames are dropped rather than repaired into something the model did
 * not ask for; if nothing survives, the caller falls back to the deterministic
 * storyboard so the workflow still produces a video.
 */
export function normalizeStoryboard(value: unknown, options: NormalizeOptions): NormalizeResult {
	const warnings: string[] = [];
	const root = isRecord(value) ? value : {};
	if (!isRecord(value)) warnings.push("The planner response was not a JSON object.");

	const rawFrames = Array.isArray(root.frames) ? root.frames : [];
	if (!Array.isArray(root.frames)) warnings.push("The planner response contained no frame list.");
	if (rawFrames.length > LIMITS.maxFrames) {
		warnings.push(`Kept the first ${LIMITS.maxFrames} of ${rawFrames.length} proposed frames.`);
	}

	const frames: HyperFrame[] = [];
	let totalSeconds = 0;
	let previousStart = 0;
	let scene3dCount = 0;

	for (const [index, candidate] of rawFrames.slice(0, LIMITS.maxFrames).entries()) {
		if (!isRecord(candidate)) {
			warnings.push(`Dropped frame ${index + 1}: it was not an object.`);
			continue;
		}
		const requested = candidate.kind;
		if (typeof requested !== "string" || !HYPERFRAME_KINDS.includes(requested as HyperFrameKind)) {
			warnings.push(`Dropped frame ${index + 1}: unknown frame kind.`);
			continue;
		}
		let kind = requested as HyperFrameKind;
		if (!options.hasRecording && RECORDING_KINDS.has(kind)) {
			const substitute = WITHOUT_RECORDING[kind] ?? "statement";
			warnings.push(
				`Frame ${index + 1} asked for the recording, which is not attached; used a ${substitute} frame instead.`,
			);
			kind = substitute;
		}

		// An image frame is only an image frame if its asset actually arrived.
		// Anything else degrades to the text equivalent rather than rendering an
		// empty card, matching how a missing recording is handled.
		const available = new Set(options.availableAssetIds ?? []);
		const requestedAssetId = text(candidate.assetId, 80);
		let assetId =
			requestedAssetId && available.has(requestedAssetId) ? requestedAssetId : undefined;
		if (IMAGE_KINDS.has(kind) && !assetId) {
			const substitute = WITHOUT_IMAGE[kind] ?? "statement";
			// A frame that asked for a picture by description has already been
			// through the fetcher, which said why it came back empty. Repeating
			// "named none" here would contradict that, so it reads as the
			// consequence it is.
			const wasQueried = Boolean(text(candidate.assetQuery, 120));
			warnings.push(
				wasQueried
					? `Frame ${index + 1}'s image was not available, so it became a ${substitute} frame.`
					: requestedAssetId
						? `Frame ${index + 1} referenced an image that was not supplied; used a ${substitute} frame instead.`
						: `Frame ${index + 1} asked for an image but named none; used a ${substitute} frame instead.`,
			);
			kind = substitute;
			assetId = undefined;
		}
		if (!IMAGE_KINDS.has(kind)) assetId = undefined;

		// A 3D frame has to survive three checks before it stays one: the scene
		// must exist, its parameters must validate, and the video must not
		// already have as many 3D frames as it can afford to render.
		let scene: Scene3dId | undefined;
		let sceneParams: Scene3dParams | undefined;
		if (kind === "scene3d") {
			if (scene3dCount >= LIMITS.maxScene3dFrames) {
				warnings.push(
					`Frame ${index + 1} was the ${scene3dCount + 1}th 3D frame; only ${LIMITS.maxScene3dFrames} are rendered, so it became a statement frame.`,
				);
				kind = "statement";
			} else {
				const label = `Frame ${index + 1}`;
				const requestedScene = candidate.scene;
				// Availability is policy, not validation: a scene can be perfectly
				// well-formed and still not be something we are willing to render.
				const gated =
					isScene3dId(requestedScene) && !isSceneAvailable(requestedScene)
						? requestedScene
						: undefined;
				if (gated) {
					warnings.push(
						`${label} asked for the "${gated}" 3D scene, which does not render correctly yet.`,
					);
				}
				const resolved = gated
					? undefined
					: normalizeScene3dRequest(
							candidate,
							label,
							new Set(options.availableAssetIds ?? []),
							warnings,
						);
				if (resolved) {
					scene = resolved.scene;
					sceneParams = resolved.params;
					scene3dCount += 1;
				} else {
					kind = "statement";
				}
			}
		}

		// The skill's restriction is applied last, after the recording and asset
		// substitutions, so a frame that has already degraded is judged on what it
		// became rather than on what was asked for.
		if (options.allowedKinds && !options.allowedKinds.includes(kind)) {
			const substitute = textEquivalent(kind, options.allowedKinds);
			warnings.push(
				`Frame ${index + 1} used a ${kind} frame, which this skill does not allow; used a ${substitute} frame instead.`,
			);
			kind = substitute;
			assetId = undefined;
		}

		const label = `Frame ${index + 1}`;
		const durationSeconds = clampReported(
			candidate.durationSeconds,
			LIMITS.minFrameSeconds,
			LIMITS.maxFrameSeconds,
			5,
			`${label} durationSeconds`,
			warnings,
		);
		if (totalSeconds + durationSeconds > LIMITS.maxTotalSeconds) {
			warnings.push(`Stopped at frame ${index + 1}: the storyboard reached its length limit.`);
			break;
		}
		totalSeconds += durationSeconds;

		const bullets = Array.isArray(candidate.bullets)
			? candidate.bullets.slice(0, LIMITS.maxBullets).flatMap((item) => {
					const line = text(item, LIMITS.bullet);
					return line ? [line] : [];
				})
			: undefined;

		const headline = text(candidate.headline, LIMITS.headline);
		const focus = normalizeFocus(candidate.focus, label, warnings);
		// A callout without a target has nothing to point at; centre it rather
		// than dropping copy the model wrote.
		const resolvedFocus = kind === "callout" && !focus ? { cx: 0.5, cy: 0.5, scale: 1.6 } : focus;

		// Keep playback moving forward through the recording.
		const requestedStart = clampReported(
			candidate.sourceStartSeconds,
			0,
			options.recordingSeconds ?? Number.MAX_SAFE_INTEGER,
			previousStart,
			`${label} sourceStartSeconds`,
			RECORDING_KINDS.has(kind) ? warnings : [],
		);
		const sourceStartSeconds = RECORDING_KINDS.has(kind)
			? Math.max(previousStart, requestedStart)
			: undefined;
		if (sourceStartSeconds !== undefined && sourceStartSeconds !== requestedStart) {
			warnings.push(
				`${label} sourceStartSeconds went backwards through the recording; moved it to ${sourceStartSeconds}.`,
			);
		}
		if (sourceStartSeconds !== undefined) previousStart = sourceStartSeconds;

		const frame: HyperFrame = {
			id: text(candidate.id, 60) ?? `frame-${frames.length + 1}`,
			kind,
			durationSeconds,
		};
		const eyebrow = text(candidate.eyebrow, LIMITS.eyebrow);
		const subhead = text(candidate.subhead, LIMITS.subhead);
		const caption = text(candidate.caption, LIMITS.caption);
		if (eyebrow) frame.eyebrow = eyebrow;
		if (headline) frame.headline = headline;
		if (subhead) frame.subhead = subhead;
		if (caption) frame.caption = caption;
		if (bullets?.length) frame.bullets = bullets;
		if (resolvedFocus) frame.focus = resolvedFocus;
		if (sourceStartSeconds !== undefined) frame.sourceStartSeconds = sourceStartSeconds;
		if (candidate.side === "left" || candidate.side === "right") frame.side = candidate.side;
		if (assetId) frame.assetId = assetId;
		if (kind === "scene3d" && scene) {
			frame.scene = scene;
			frame.sceneParams = sceneParams ?? {};
		}

		// A text-only frame with no words renders as an empty card. A 3D frame is
		// not one: the scene is the content, and copy over it is optional.
		if (kind !== "scene3d" && !RECORDING_KINDS.has(kind) && !headline && !bullets?.length) {
			warnings.push(`Dropped frame ${index + 1}: a ${kind} frame needs a headline or bullets.`);
			totalSeconds -= durationSeconds;
			continue;
		}
		frames.push(frame);
	}

	const accent =
		typeof root.accent === "string" && HYPERFRAME_ACCENTS.includes(root.accent as HyperFrameAccent)
			? (root.accent as HyperFrameAccent)
			: "indigo";
	if (typeof root.accent === "string" && accent !== root.accent) {
		warnings.push(`Unknown accent "${String(root.accent).slice(0, 24)}"; used indigo.`);
	}

	if (frames.length < LIMITS.minFrames) {
		warnings.push("The planner storyboard was unusable; built one from the request instead.");
		const fallback = buildDeterministicStoryboard({
			request: options.fallbackTitle,
			title: text(root.title, LIMITS.title) ?? options.fallbackTitle,
			hasRecording: options.hasRecording,
			recordingSeconds: options.recordingSeconds,
		});
		applyAttribution(fallback.frames, options.attributionLine);
		return { storyboard: fallback, warnings };
	}

	applyAttribution(frames, options.attributionLine);

	return {
		storyboard: {
			title: text(root.title, LIMITS.title) ?? options.fallbackTitle,
			accent,
			frames,
		},
		warnings,
	};
}

/**
 * Beats for the no-planner walkthrough. A demo that holds one framing for its
 * whole length reads as a static screen capture, and a zoom centred at exactly
 * (0.5, 0.5) is invisible because it crops symmetrically — so these alternate
 * wide and pushed-in, and every push is off-centre.
 */
const WALKTHROUGH: Array<{
	kind: HyperFrameKind;
	headline: string;
	focus?: { cx: number; cy: number; scale: number };
}> = [
	// Establishing shot: show the whole screen before pushing into anything.
	{ kind: "screen", headline: "Getting started" },
	{ kind: "callout", headline: "The key step", focus: { cx: 0.36, cy: 0.42, scale: 2.0 } },
	{ kind: "screen", headline: "Following through", focus: { cx: 0.62, cy: 0.55, scale: 1.75 } },
	{ kind: "screen", headline: "Finishing up" },
];

export interface DeterministicStoryboardOptions {
	request: string;
	title: string;
	hasRecording: boolean;
	recordingSeconds?: number;
	accent?: HyperFrameAccent;
}

/**
 * A usable demo with no model involved. This keeps the workflow honest when the
 * account is offline or the planner returns nothing renderable, and it is the
 * baseline the model output is expected to improve on.
 */
export function buildDeterministicStoryboard(
	options: DeterministicStoryboardOptions,
): HyperFrameStoryboard {
	const title = text(options.title, LIMITS.title) ?? "Product demo";
	const request = text(options.request, 240) ?? title;
	const accent = options.accent ?? "indigo";

	if (!options.hasRecording) {
		return {
			title,
			accent,
			frames: [
				{
					id: "frame-1",
					kind: "title",
					durationSeconds: 4,
					eyebrow: "Guide Studio",
					headline: title,
				},
				{
					id: "frame-2",
					kind: "statement",
					durationSeconds: 5,
					headline: request,
				},
				{
					id: "frame-3",
					kind: "bullets",
					durationSeconds: 7,
					headline: "What this demo covers",
					bullets: ["The problem it solves", "How it works", "What to try next"],
				},
				{
					id: "frame-4",
					kind: "outro",
					durationSeconds: 4,
					headline: title,
					subhead: "Open the project to edit this demo",
				},
			],
		};
	}

	// Spread the walkthrough across whatever recording length is known, leaving
	// the trailing seconds for the outro card.
	const usable = Math.max(6, Math.min(options.recordingSeconds ?? 30, 90));
	const each = Math.max(LIMITS.minFrameSeconds, Math.min(10, usable / WALKTHROUGH.length));
	const walkthrough: HyperFrame[] = WALKTHROUGH.map((beat, index) => ({
		id: `frame-walkthrough-${index + 1}`,
		kind: beat.kind,
		durationSeconds: Number(each.toFixed(2)),
		headline: beat.headline,
		sourceStartSeconds: Number((index * each).toFixed(2)),
		...(beat.focus ? { focus: beat.focus } : {}),
	}));

	return {
		title,
		accent,
		frames: [
			{
				id: "frame-1",
				kind: "title",
				durationSeconds: 4,
				eyebrow: "Guide Studio",
				headline: title,
			},
			...walkthrough,
			{
				id: "frame-outro",
				kind: "outro",
				durationSeconds: 4,
				headline: title,
				subhead: "Open the project to edit this demo",
			},
		],
	};
}

/** Extracts the storyboard object from a streamed completion. */
export function parseStoryboardResponse(content: string): unknown {
	const trimmed = content
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "")
		.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		// Small models often wrap valid JSON in a sentence. Take the outermost
		// object and try once more before giving up.
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return undefined;
			}
		}
		return undefined;
	}
}

export function storyboardDurationSeconds(storyboard: HyperFrameStoryboard) {
	return Number(
		storyboard.frames.reduce((total, frame) => total + frame.durationSeconds, 0).toFixed(2),
	);
}
