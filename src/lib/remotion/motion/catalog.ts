// ── Motion graphics catalog ──────────────────────────────────────────────
//
// The vocabulary Claude composes a motion-graphics video from. The planner
// picks an id and, for text scenes, supplies the copy. It never writes render
// code.
//
// Two kinds, because the components divide cleanly in two:
//
//   backdrop — a purely visual animation with no baked-in words. Safe to run
//              full-frame behind our own typography.
//   text     — an animated typography component that takes the copy as a prop,
//              so the user's words are the thing being animated.
//
// Every entry here was confirmed by rendering it (see `CatalogSheet.tsx`).
// That audit is why the backdrop list is short: the adapted `helpers/scenes/`
// library is a demo reel, and nearly all of it paints its own title — "AURORA",
// "BOKEH", "OIL SPILL" — which is fine in a showcase and unusable behind a
// customer's copy. Four survived; the other four backdrops were written for
// this composition in `backdrops.tsx`.

import type React from "react";
import { BackgroundRadial } from "../helpers/scenes/BackgroundAnimations";
import { ParticleSparks } from "../helpers/scenes/ParticleAnimations";
import { ShapeHexGrid, ShapeRipples } from "../helpers/scenes/ShapeAnimations";
import {
	Text3DFlip,
	TextExplode,
	TextGlitch,
	TextGradient,
	TextKinetic,
	TextMaskReveal,
	TextNeon,
	TextScramble,
	TextTypewriter,
	TextWave,
} from "../helpers/scenes/TextAnimations";
import { GlowPulse, GradientDrift, ParticleDrift, SoftGrid } from "./backdrops";

type StartDelayComponent = React.FC<{ startDelay?: number }>;
type TextComponent = React.FC<{ text?: string; startDelay?: number }>;

export interface BackdropEntry {
	id: string;
	component: StartDelayComponent;
	/** Shown to the planner so it can choose on meaning, not on name. */
	description: string;
}

export interface TextSceneEntry {
	id: string;
	component: TextComponent;
	description: string;
	/** Short copy only — these animate per character or per word. */
	maxChars: number;
}

/**
 * Eight backdrops: four written for this composition, four survivors of the
 * contact-sheet audit of `helpers/scenes/`. Everything else in that library
 * paints its own demo title and is excluded — see `backdrops.tsx`.
 */
export const BACKDROPS: BackdropEntry[] = [
	{
		id: "gradient-drift",
		component: GradientDrift,
		description: "slow indigo and violet colour masses drifting — the safe default",
	},
	{
		id: "particle-drift",
		component: ParticleDrift,
		description: "fine particles rising through soft light — depth without distraction",
	},
	{
		id: "soft-grid",
		component: SoftGrid,
		description:
			"a technical grid with a highlight sweeping across it — product and developer copy",
	},
	{
		id: "glow-pulse",
		component: GlowPulse,
		description: "one slow pulse of light from the centre — good under a closing line",
	},
	{
		id: "radial",
		component: BackgroundRadial,
		description: "radial rays turning slowly from the centre — focuses attention",
	},
	{
		id: "hex-grid",
		component: ShapeHexGrid,
		description: "a hexagonal grid lighting up in waves — technical, structured",
	},
	{
		id: "ripples",
		component: ShapeRipples,
		description: "concentric rings spreading outward — calm, rhythmic",
	},
	{
		id: "sparks",
		component: ParticleSparks,
		description: "embers drifting in the dark — warm, understated",
	},
];

export const TEXT_SCENES: TextSceneEntry[] = [
	{
		id: "kinetic",
		component: TextKinetic,
		description: "each character springs into place — punchy, good for a short statement",
		maxChars: 24,
	},
	{
		id: "glitch",
		component: TextGlitch,
		description: "digital glitch distortion — edgy, technical",
		maxChars: 20,
	},
	{
		id: "neon",
		component: TextNeon,
		description: "glowing neon sign flicker — nightlife, bold",
		maxChars: 20,
	},
	{
		id: "typewriter",
		component: TextTypewriter,
		description: "typed one character at a time — prompts, code, quotes",
		maxChars: 48,
	},
	{
		id: "wave",
		component: TextWave,
		description: "characters undulating in a wave — light and friendly",
		maxChars: 24,
	},
	{
		id: "scramble",
		component: TextScramble,
		description: "letters resolve out of scrambled noise — reveal, decoding",
		maxChars: 20,
	},
	{
		id: "gradient",
		component: TextGradient,
		description: "a gradient sweeping through the letterforms — premium",
		maxChars: 24,
	},
	{
		id: "explode",
		component: TextExplode,
		description: "characters fly apart from the centre — high impact ending",
		maxChars: 16,
	},
	{
		id: "flip-3d",
		component: Text3DFlip,
		description: "characters flip in three dimensions — playful",
		maxChars: 20,
	},
	{
		id: "mask-reveal",
		component: TextMaskReveal,
		description: "text revealed behind a moving mask — editorial, clean",
		maxChars: 28,
	},
];

export const BACKDROP_IDS = BACKDROPS.map((entry) => entry.id);
export const TEXT_SCENE_IDS = TEXT_SCENES.map((entry) => entry.id);

export function findBackdrop(id: string | undefined): BackdropEntry | undefined {
	return BACKDROPS.find((entry) => entry.id === id);
}

export function findTextScene(id: string | undefined): TextSceneEntry | undefined {
	return TEXT_SCENES.find((entry) => entry.id === id);
}
