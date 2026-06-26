/**
 * Types for the direct-customization intro builder.
 * No template system — users configure everything directly.
 */

export type IntroAnimationStyle =
	| "fade"
	| "slide-up"
	| "slide-down"
	| "slide-left"
	| "slide-right"
	| "scale"
	| "rotate"
	| "typewriter"
	| "glitch"
	| "blur"
	| "particle";

export type IntroTextPosition =
	| "center"
	| "top"
	| "bottom"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

export type IntroImageFit = "contain" | "cover" | "fill";

export interface IntroImageEntry {
	id: string;
	dataUrl: string;
	role: "logo" | "background" | "decoration";
	position: IntroTextPosition;
	scale: number;
	opacity: number;
}

export interface IntroConfig {
	// Text
	title: string;
	subtitle: string;

	// Styling
	accentColor: string;
	backgroundColor: string;
	customBackgroundImage: string | null;

	// Images
	images: IntroImageEntry[];

	// Animation
	titleAnimation: IntroAnimationStyle;
	subtitleAnimation: IntroAnimationStyle;
	animationStagger: number;

	// Timing
	durationMs: number;
	fadeInPercent: number;
	fadeOutPercent: number;

	// Layout
	textPosition: IntroTextPosition;
	titleSize: number;
	subtitleSize: number;
}

export const DEFAULT_INTRO_CONFIG: IntroConfig = {
	title: "Your Title",
	subtitle: "Your subtitle goes here",
	accentColor: "#2563eb",
	backgroundColor: "brand-dark",
	customBackgroundImage: null,
	images: [],
	titleAnimation: "fade",
	subtitleAnimation: "fade",
	animationStagger: 200,
	durationMs: 4000,
	fadeInPercent: 0.2,
	fadeOutPercent: 0.1,
	textPosition: "center",
	titleSize: 1.0,
	subtitleSize: 1.0,
};

export const ANIMATION_LABELS: Record<IntroAnimationStyle, string> = {
	fade: "Fade",
	"slide-up": "Slide Up",
	"slide-down": "Slide Down",
	"slide-left": "Slide Left",
	"slide-right": "Slide Right",
	scale: "Scale",
	rotate: "Rotate",
	typewriter: "Typewriter",
	glitch: "Glitch",
	blur: "Blur",
	particle: "Particle",
};

export const POSITION_LABELS: Record<IntroTextPosition, string> = {
	center: "Center",
	top: "Top",
	bottom: "Bottom",
	"top-left": "Top Left",
	"top-right": "Top Right",
	"bottom-left": "Bottom Left",
	"bottom-right": "Bottom Right",
};
