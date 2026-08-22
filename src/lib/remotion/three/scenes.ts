// ── 3D scene library ─────────────────────────────────────────────────────
//
// The same discipline as the HyperFrame library, applied to three.js: the
// planner selects a scene id and fills in bounded parameters, and never writes
// code. `agent-runtime-research.md` rules out running model-authored render
// code, and a WebGL context is a worse place to break that rule than a DOM.
//
// Two constraints shape every scene below.
//
// Determinism. Remotion renders frames in parallel across several browser
// instances, so a scene must be a pure function of `useCurrentFrame()`. No
// `Math.random`, no `Date.now`, no physics that steps from the previous frame —
// any of those and two frames of the same shot disagree, which shows up as
// flicker rather than as an error.
//
// Cost. A 3D frame renders roughly an order of magnitude slower than a 2D one,
// so the count is capped rather than trusted: see `LIMITS.maxScene3dFrames`.

export const SCENE_3D_IDS = [
	"device_mockup",
	"logo_extrude",
	"product_orbit",
	"data_towers",
	"particle_field",
	"card_stack",
] as const;

export type Scene3dId = (typeof SCENE_3D_IDS)[number];

export const DEVICE_KINDS = ["laptop", "phone", "tablet"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface DataTower {
	label: string;
	value: number;
}

/**
 * Every parameter any scene accepts, in one flat shape. A single validated
 * object is far easier to bound than a discriminated union whose variants each
 * need their own normalizer, and unused fields simply go unread.
 */
export interface Scene3dParams {
	device?: DeviceKind;
	/** Asset shown on the device screen, on the billboard, or extruded. */
	assetId?: string;
	/** Additional assets for the scenes that fan several out. */
	assetIds?: string[];
	/** Degrees of rotation across the whole shot. */
	spinDegrees?: number;
	/** Extrusion depth, in scene units. */
	depth?: number;
	/** Bars for the 3D chart. */
	bars?: DataTower[];
	/** Particle count, before the ceiling is applied. */
	density?: number;
}

export const SCENE_3D_LIMITS = {
	maxSpinDegrees: 720,
	minSpinDegrees: -720,
	maxDepth: 1.2,
	minDepth: 0.05,
	maxBars: 6,
	maxBarValue: 1_000_000,
	maxDensity: 900,
	minDensity: 40,
	maxCardAssets: 4,
	barLabel: 18,
} as const;

/** What each scene needs before it can render anything worth watching. */
export interface Scene3dRequirements {
	/** Needs one supplied image. */
	needsAsset: boolean;
	/** Needs at least one bar of data. */
	needsBars: boolean;
	/** Human-readable description, used in the planner prompt. */
	description: string;
	/**
	 * Whether this scene may be used in a video today. All six are currently
	 * false — an unavailable scene is never offered to the planner and is
	 * rejected by the normalizer, so it degrades to a text frame rather than
	 * shipping something broken. Two separate problems are open:
	 *
	 * 1. *Texture-mapped scenes render empty.* The texture loads and reaches
	 *    React state (verified by logging), but the mesh never appears in the
	 *    captured frame. React-three-fiber paints on demand and Remotion captures
	 *    per frame; the commit carrying the texture does not make it into the
	 *    captured paint. Holding the frame with `delayRender` until two animation
	 *    frames after `invalidate()` was not enough. Affects `device_mockup`,
	 *    `logo_extrude`, `product_orbit`, `card_stack`.
	 *
	 * 2. *Any 3D frame makes the whole video render in software.* `chromiumOptions`
	 *    is per-render, not per-frame, so one 3D frame forces every frame through
	 *    SwiftShader. `gl: "angle"` loses its context outright on macOS
	 *    ("THREE.WebGLRenderer: Context Lost") and renders black; `gl: "swangle"`
	 *    renders correctly but turned a 34-second demo into a >10-minute render
	 *    that also crashed the browser repeatedly. Affects every scene, including
	 *    `data_towers` and `particle_field`, which are otherwise correct — both
	 *    render properly as stills (see `scripts/probe-scene3d.ts`).
	 *
	 * Fixing (2) probably means rendering 3D frames as stills in a separate pass
	 * and compositing them, rather than asking one `renderMedia` call to do both.
	 */
	available: boolean;
}

export const SCENE_3D_REQUIREMENTS: Record<Scene3dId, Scene3dRequirements> = {
	device_mockup: {
		needsAsset: true,
		needsBars: false,
		description:
			"a screenshot mapped onto a slowly rotating laptop, phone, or tablet. Params: device, assetId, spinDegrees.",
		available: false,
	},
	logo_extrude: {
		needsAsset: true,
		needsBars: false,
		description:
			"a supplied logo given depth and orbited under a key light. Params: assetId, depth, spinDegrees.",
		available: false,
	},
	product_orbit: {
		needsAsset: true,
		needsBars: false,
		description:
			"a supplied image on a billboard orbiting above a reflective floor. Params: assetId, spinDegrees.",
		available: false,
	},
	data_towers: {
		needsAsset: false,
		needsBars: true,
		description:
			"a 3D bar chart that grows as the shot plays. Params: bars (up to 6 of {label, value}).",
		available: false,
	},
	particle_field: {
		needsAsset: false,
		needsBars: false,
		description:
			"a branded particle backdrop behind a headline, for an opening or closing beat. Params: density.",
		available: false,
	},
	card_stack: {
		needsAsset: true,
		needsBars: false,
		description:
			"up to four supplied images fanned in depth and drifting. Params: assetIds (up to 4).",
		available: false,
	},
};

export function isScene3dId(value: unknown): value is Scene3dId {
	return typeof value === "string" && (SCENE_3D_IDS as readonly string[]).includes(value);
}

/** Scenes that render correctly today, and are therefore offered and accepted. */
export const AVAILABLE_SCENE_3D_IDS = SCENE_3D_IDS.filter(
	(id) => SCENE_3D_REQUIREMENTS[id].available,
);

export function isSceneAvailable(id: Scene3dId) {
	return SCENE_3D_REQUIREMENTS[id].available;
}
