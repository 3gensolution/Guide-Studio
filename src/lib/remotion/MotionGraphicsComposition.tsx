// ── Motion graphics composition ──────────────────────────────────────────
//
// The animated counterpart to HyperFrame. Where HyperFrame lays out clean
// document-style cards, this composes the existing animated component library
// in `helpers/scenes/`: real particle, liquid, shape and typography motion.
//
// Most legacy scenes are self-contained, while the layered scene is the
// shared editorial primitive for mixed-media work:
//
//   kind "text"  — an animated typography component renders the copy itself.
//   kind "card"  — an animated backdrop runs full-frame with our own
//                  typography drawn over it.
//   kind "logo"  — a supplied brand asset is staged into the Remotion bundle
//                  and receives a deterministic reveal animation.
//   kind "layered" — bounded images, video, type, logos, and shapes compose
//                   together in normalized coordinates.
//
// Everything is a pure function of the frame, so Remotion's parallel renderers
// agree on every frame. The planner supplies ids and copy; no code from the
// model is compiled or executed here.

import React from "react";
import {
	AbsoluteFill,
	Img,
	interpolate,
	OffthreadVideo,
	random,
	Sequence,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { type RenderCaptionLine, RenderCaptionOverlay } from "./RenderCaptionOverlay";

export type MotionAccent = "indigo" | "emerald" | "amber" | "rose" | "violet";
export type MotionImageMotion = "ken-burns" | "parallax" | "float";
export type MotionVideoMotion = "push-in" | "drift" | "steady";
export type MotionLayerKind = "image" | "video" | "logo" | "text" | "shape";
export type MotionLayerMotion = "none" | "drift" | "push-in" | "rise" | "scale-in" | "wipe";

/** Brand-aware art direction derived from supplied media, not invented copy. */
export interface MotionBrandPalette {
	background: string;
	surface: string;
	primary: string;
	secondary: string;
	highlight: string;
	text: string;
	mutedText: string;
	mode: "light" | "dark";
}

const DEFAULT_PALETTES: Record<MotionAccent, MotionBrandPalette> = {
	indigo: {
		background: "#0B1020",
		surface: "#121A31",
		primary: "#818CF8",
		secondary: "#22D3EE",
		highlight: "#C4B5FD",
		text: "#F8FAFC",
		mutedText: "#CBD5E1",
		mode: "dark",
	},
	emerald: {
		background: "#071411",
		surface: "#0D241C",
		primary: "#34D399",
		secondary: "#5EEAD4",
		highlight: "#A7F3D0",
		text: "#F0FDF4",
		mutedText: "#BBF7D0",
		mode: "dark",
	},
	amber: {
		background: "#171008",
		surface: "#2B1A0C",
		primary: "#FBBF24",
		secondary: "#FB923C",
		highlight: "#FDE68A",
		text: "#FFFBEB",
		mutedText: "#FDE68A",
		mode: "dark",
	},
	rose: {
		background: "#190B13",
		surface: "#2B1120",
		primary: "#FB7185",
		secondary: "#F0ABFC",
		highlight: "#FECDD3",
		text: "#FFF1F2",
		mutedText: "#FECDD3",
		mode: "dark",
	},
	violet: {
		background: "#120C1F",
		surface: "#211336",
		primary: "#C4B5FD",
		secondary: "#F0ABFC",
		highlight: "#EDE9FE",
		text: "#FAF5FF",
		mutedText: "#E9D5FF",
		mode: "dark",
	},
};

function rgba(hex: string, alpha: number): string {
	const value = hex.replace("#", "");
	const red = Number.parseInt(value.slice(0, 2), 16);
	const green = Number.parseInt(value.slice(2, 4), 16);
	const blue = Number.parseInt(value.slice(4, 6), 16);
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function paletteFor(accent: MotionAccent, brandPalette?: MotionBrandPalette): MotionBrandPalette {
	return brandPalette ?? DEFAULT_PALETTES[accent];
}

export interface MotionScene {
	id: string;
	kind: "text" | "card" | "logo" | "image" | "video" | "layered";
	durationSeconds: number;
	/** Optional editorial metadata selected by a creative skill. */
	beatRole?:
		| "hook"
		| "problem"
		| "product-proof"
		| "brand-world"
		| "thesis"
		| "feature-reveal"
		| "logo-lockup"
		| "cta";
	motionPreset?:
		| "hero-push"
		| "macro-crop"
		| "collage"
		| "card-stack"
		| "kinetic-type"
		| "mask-reveal"
		| "parallax"
		| "scatter-assemble"
		| "match-cut";
	transitionIn?: "cut" | "crossfade" | "wipe" | "scale-through" | "match-cut";
	transitionOut?: "cut" | "crossfade" | "wipe" | "scale-through" | "match-cut";
	/** Captions are deliberately opt-in for visual proof scenes. */
	captionsAllowed?: boolean;
	/** kind "text": which typography animation, and the words it animates. */
	textScene?: string;
	text?: string;
	/** kind "card": the animated backdrop behind the copy. */
	backdrop?: string;
	eyebrow?: string;
	headline?: string;
	subhead?: string;
	bullets?: string[];
	/** kind "logo": the validated supplied brand asset to reveal. */
	logoAssetId?: string;
	/** Optional closing line that resolves beneath the logo in the same scene. */
	tagline?: string;
	/** kind "image": the supplied/generated image to animate. */
	imageAssetId?: string;
	imageMotion?: MotionImageMotion;
	/** kind "video": an approved source-video segment to animate. */
	videoAssetId?: string;
	/** Offset into the source video in seconds. */
	sourceStartSeconds?: number;
	/** Intended source segment duration, bounded against the probed media length. */
	sourceDurationSeconds?: number;
	videoMotion?: MotionVideoMotion;
	/** kind "layered": deterministic mixed-media composition in normalized coordinates. */
	layers?: MotionLayer[];
}

/**
 * A renderer-safe layer. Coordinates are normalized to the composition, so
 * the same plan works in landscape, square, and vertical exports. Asset ids
 * are resolved by the host before the composition is rendered.
 */
export interface MotionLayer {
	id: string;
	kind: MotionLayerKind;
	assetId?: string;
	text?: string;
	color?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	rotation: number;
	zIndex: number;
	borderRadius: number;
	fontSize?: number;
	fontWeight?: number;
	textAlign?: "left" | "center" | "right";
	fit?: "cover" | "contain";
	motion?: MotionLayerMotion;
	sourceStartSeconds?: number;
	sourceDurationSeconds?: number;
}

export interface MotionImageAsset {
	assetId: string;
	/** Bundle-relative URL. Absolute filesystem paths never reach the composition. */
	src: string;
}

export interface MotionVideoAsset {
	assetId: string;
	/** Bundle-relative URL. Absolute filesystem paths never reach the composition. */
	src: string;
}

export interface MotionCompositionProps {
	title: string;
	accent: MotionAccent;
	scenes: MotionScene[];
	imageAssets?: MotionImageAsset[];
	videoAssets?: MotionVideoAsset[];
	brandPalette?: MotionBrandPalette;
	/** Required source credit for stock visuals, rendered on the final shot. */
	attributionLine?: string;
	/** Captions are rendered in the composition so the social MP4 is self-contained. */
	captions?: RenderCaptionLine[];
}

export type MotionFormat = "landscape" | "vertical" | "square";

export const MOTION_FORMATS = [
	{ id: "MotionGraphics", format: "landscape", width: 1920, height: 1080 },
	{ id: "MotionGraphicsVertical", format: "vertical", width: 1080, height: 1920 },
	{ id: "MotionGraphicsSquare", format: "square", width: 1080, height: 1080 },
] as const satisfies ReadonlyArray<{
	id: string;
	format: MotionFormat;
	width: number;
	height: number;
}>;

export function motionFormatSpec(format: MotionFormat = "landscape") {
	return MOTION_FORMATS.find((entry) => entry.format === format) ?? MOTION_FORMATS[0];
}

export function calculateMotionDuration(scenes: MotionScene[], fps: number) {
	const total = scenes.reduce((sum, scene) => sum + Math.max(0.5, scene.durationSeconds), 0);
	return Math.max(fps, Math.round(total * fps));
}

/**
 * Copy drawn over a backdrop. Sizes are expressed against a 1920-wide design
 * space and scaled to the real frame, so one set of numbers reads correctly at
 * 16:9, 9:16 and 1:1.
 */
const CardCopy: React.FC<{
	scene: MotionScene;
	accent: string;
	scale: number;
	palette: MotionBrandPalette;
}> = ({ scene, accent, scale, palette }) => {
	const px = (value: number) => Math.round(value * scale);
	const textShadow =
		palette.mode === "light" ? "0 2px 24px rgba(255,255,255,0.72)" : "0 4px 40px rgba(0,0,0,0.55)";
	return (
		<AbsoluteFill
			style={{
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				padding: `${px(120)}px ${px(140)}px`,
				fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif',
			}}
		>
			{scene.eyebrow && (
				<div
					style={{
						color: accent,
						fontSize: px(30),
						fontWeight: 600,
						letterSpacing: px(3),
						textTransform: "uppercase",
						marginBottom: px(24),
					}}
				>
					{scene.eyebrow}
				</div>
			)}
			{scene.headline && (
				<div
					style={{
						color: palette.text,
						fontSize: px(96),
						fontWeight: 800,
						lineHeight: 1.05,
						letterSpacing: px(-2),
						textShadow,
					}}
				>
					{scene.headline}
				</div>
			)}
			{scene.subhead && (
				<div
					style={{
						color: palette.mutedText,
						fontSize: px(40),
						fontWeight: 400,
						lineHeight: 1.4,
						marginTop: px(28),
						maxWidth: px(1300),
						textShadow,
					}}
				>
					{scene.subhead}
				</div>
			)}
			{scene.bullets && scene.bullets.length > 0 && (
				<div style={{ marginTop: px(40), display: "flex", flexDirection: "column", gap: px(22) }}>
					{scene.bullets.map((bullet) => (
						<div key={bullet} style={{ display: "flex", alignItems: "center", gap: px(20) }}>
							<div
								style={{
									width: px(14),
									height: px(14),
									borderRadius: px(7),
									background: accent,
									flexShrink: 0,
									boxShadow: `0 0 ${px(20)}px ${accent}`,
								}}
							/>
							<div
								style={{
									color: palette.mutedText,
									fontSize: px(38),
									fontWeight: 500,
									textShadow,
								}}
							>
								{bullet}
							</div>
						</div>
					))}
				</div>
			)}
		</AbsoluteFill>
	);
};

/**
 * Just enough shading for white type to hold over the backdrop. Kept light on
 * purpose: an earlier, heavier scrim made every backdrop read as flat black,
 * which defeats the point of animating one.
 */
const Scrim: React.FC<{ palette: MotionBrandPalette }> = ({ palette }) => (
	<AbsoluteFill
		style={{
			background:
				palette.mode === "light"
					? `linear-gradient(90deg, ${rgba(palette.background, 0.86)} 0%, ${rgba(palette.background, 0.42)} 48%, ${rgba(palette.background, 0.08)} 100%)`
					: `linear-gradient(90deg, ${rgba(palette.background, 0.68)} 0%, ${rgba(palette.background, 0.38)} 48%, ${rgba(palette.background, 0.08)} 100%)`,
		}}
	/>
);

/**
 * A controlled, brand-aware visual field for every card and typography shot.
 * The old catalog backdrops all painted their own black canvas, which made a
 * supplied logo or product image irrelevant to the overall art direction.
 */
const BrandBackdrop: React.FC<{ id?: string; palette: MotionBrandPalette }> = ({ id, palette }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const time = frame / fps;
	const primaryOpacity = palette.mode === "light" ? 0.2 : 0.36;
	const secondaryOpacity = palette.mode === "light" ? 0.13 : 0.26;
	const isGrid = id?.includes("grid") || id === "radial";
	const isParticle = id?.includes("particle") || id === "sparks";
	const isRipple = id === "ripples" || id === "glow-pulse";

	return (
		<AbsoluteFill style={{ background: palette.background, overflow: "hidden" }}>
			<div
				style={{
					position: "absolute",
					inset: "-20%",
					background: `radial-gradient(circle at ${28 + Math.sin(time * 0.18) * 12}% ${30 + Math.cos(time * 0.16) * 10}%, ${rgba(palette.primary, primaryOpacity)} 0%, transparent 42%)`,
					filter: "blur(20px)",
				}}
			/>
			<div
				style={{
					position: "absolute",
					inset: "-20%",
					background: `radial-gradient(circle at ${72 + Math.cos(time * 0.14) * 13}% ${68 + Math.sin(time * 0.2) * 12}%, ${rgba(palette.secondary, secondaryOpacity)} 0%, transparent 40%)`,
					filter: "blur(28px)",
				}}
			/>
			{isGrid && (
				<AbsoluteFill
					style={{
						backgroundImage: `linear-gradient(${rgba(palette.text, palette.mode === "light" ? 0.09 : 0.12)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(palette.text, palette.mode === "light" ? 0.09 : 0.12)} 1px, transparent 1px)`,
						backgroundSize: "72px 72px",
						transform: `translateX(${Math.sin(time * 0.2) * 18}px)`,
					}}
				/>
			)}
			{isParticle &&
				Array.from({ length: 42 }).map((_, index) => {
					const seed = `brand-particle-${index}`;
					const x = random(`${seed}-x`) * 100;
					const speed = 4 + random(`${seed}-speed`) * 8;
					const y = 110 - ((random(`${seed}-offset`) * 100 + time * speed) % 120);
					const size = 2 + random(`${seed}-size`) * 4;
					return (
						<div
							key={seed}
							style={{
								position: "absolute",
								left: `${x}%`,
								top: `${y}%`,
								width: size,
								height: size,
								borderRadius: "50%",
								background: palette.highlight,
								opacity: 0.45,
								boxShadow: `0 0 ${size * 4}px ${rgba(palette.primary, 0.58)}`,
							}}
						/>
					);
				})}
			{isRipple && (
				<div
					style={{
						position: "absolute",
						left: "50%",
						top: "52%",
						width: `${70 + Math.sin(time * 0.7) * 6}%`,
						height: `${70 + Math.sin(time * 0.7) * 6}%`,
						transform: "translate(-50%, -50%)",
						borderRadius: "50%",
						border: `1px solid ${rgba(palette.primary, 0.32)}`,
						boxShadow: `0 0 90px ${rgba(palette.secondary, 0.2)}`,
					}}
				/>
			)}
		</AbsoluteFill>
	);
};

const BrandTextScene: React.FC<{
	scene: MotionScene;
	palette: MotionBrandPalette;
	scale: number;
}> = ({ scene, palette, scale }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const progress = spring({ frame, fps, config: { damping: 24, stiffness: 110, mass: 0.8 } });
	const text = scene.text ?? scene.headline ?? "";
	const chars = text.split("");
	const textScene = scene.textScene ?? "kinetic";
	const px = (value: number) => Math.round(value * scale);
	const typewriter = textScene === "typewriter";
	const gradient = textScene === "gradient";
	const scramble = textScene === "scramble";
	const wave = textScene === "wave";
	const explode = textScene === "explode";
	const maskReveal = textScene === "mask-reveal";
	const scrambleGlyphs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

	return (
		<AbsoluteFill>
			<BrandBackdrop id={textScene} palette={palette} />
			<div
				style={{
					position: "absolute",
					inset: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontFamily: 'Inter, -apple-system, "Segoe UI", sans-serif',
					fontSize: px(112),
					fontWeight: 800,
					letterSpacing: px(-3),
					color: palette.text,
					textAlign: "center",
					padding: `0 ${px(140)}px`,
					textShadow:
						palette.mode === "light"
							? "0 2px 24px rgba(255,255,255,0.76)"
							: "0 4px 34px rgba(0,0,0,0.42)",
				}}
			>
				{typewriter ? (
					<div
						style={{
							maxWidth: "100%",
							overflow: "hidden",
							whiteSpace: "nowrap",
							borderRight: `${px(4)}px solid ${palette.primary}`,
							width: `${Math.max(4, progress * 100)}%`,
						}}
					>
						{text}
					</div>
				) : (
					<div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
						{chars.map((character, index) => {
							// The copy must become legible well before the beat ends. A long
							// per-character cascade made short launch lines look truncated in
							// review stills and weakened the opening hook.
							const delay = index * 1.1;
							const charProgress = spring({
								frame: frame - delay,
								fps,
								config: { damping: 20, stiffness: 130, mass: 0.7 },
							});
							const scrambleIndex =
								Math.abs(Math.floor(frame / 2) + index * 17) % scrambleGlyphs.length;
							const visibleCharacter =
								scramble && character !== " " && charProgress < 0.82
									? scrambleGlyphs[scrambleIndex]
									: character;
							const direction = index < chars.length / 2 ? -1 : 1;
							const waveOffset = wave ? Math.sin(frame * 0.16 + index * 0.65) * px(12) : 0;
							return (
								<span
									key={`${character}-${index}`}
									style={{
										display: "inline-block",
										opacity: charProgress,
										transform: explode
											? `translate(${(1 - charProgress) * direction * px(72)}px, ${(1 - charProgress) * px(42)}px) scale(${0.75 + charProgress * 0.25}) rotate(${(1 - charProgress) * direction * 18}deg)`
											: `translateY(${(1 - charProgress) * px(34) + waveOffset}px) rotate(${(1 - charProgress) * (index % 2 ? 3 : -3)}deg)`,
										clipPath: maskReveal
											? `inset(0 ${Math.max(0, (1 - charProgress) * 100)}% 0 0)`
											: undefined,
										textShadow:
											textScene === "glitch"
												? `2px 0 ${rgba(palette.secondary, 0.7)}, -2px 0 ${rgba(palette.primary, 0.7)}`
												: undefined,
										backgroundImage: gradient
											? `linear-gradient(110deg, ${palette.primary}, ${palette.secondary}, ${palette.highlight})`
											: undefined,
										backgroundClip: gradient ? "text" : undefined,
										WebkitBackgroundClip: gradient ? "text" : undefined,
										WebkitTextFillColor: gradient ? "transparent" : undefined,
									}}
								>
									{visibleCharacter === " " ? "\u00A0" : visibleCharacter}
								</span>
							);
						})}
					</div>
				)}
			</div>
		</AbsoluteFill>
	);
};

const MotionAttribution: React.FC<{ line: string }> = ({ line }) => (
	<div
		style={{
			position: "absolute",
			left: 80,
			right: 80,
			bottom: 42,
			zIndex: 4,
			color: "rgba(226,232,240,0.58)",
			fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif',
			fontSize: 18,
			lineHeight: 1.3,
			textAlign: "center",
			textShadow: "0 2px 14px rgba(0,0,0,0.7)",
		}}
	>
		{line}
	</div>
);

const LOGO_FRAGMENTS = [
	{ clip: "polygon(0 0, 33.33% 0, 33.33% 33.33%, 0 33.33%)", x: -22, y: -18, r: -9 },
	{ clip: "polygon(33.33% 0, 66.66% 0, 66.66% 33.33%, 33.33% 33.33%)", x: 8, y: -24, r: 4 },
	{ clip: "polygon(66.66% 0, 100% 0, 100% 33.33%, 66.66% 33.33%)", x: 24, y: -12, r: 8 },
	{ clip: "polygon(0 33.33%, 33.33% 33.33%, 33.33% 66.66%, 0 66.66%)", x: -28, y: 2, r: -5 },
	{ clip: "polygon(33.33% 33.33%, 66.66% 33.33%, 66.66% 66.66%, 33.33% 66.66%)", x: 0, y: 0, r: 0 },
	{ clip: "polygon(66.66% 33.33%, 100% 33.33%, 100% 66.66%, 66.66% 66.66%)", x: 27, y: 8, r: 6 },
	{ clip: "polygon(0 66.66%, 33.33% 66.66%, 33.33% 100%, 0 100%)", x: -18, y: 23, r: 7 },
	{ clip: "polygon(33.33% 66.66%, 66.66% 66.66%, 66.66% 100%, 33.33% 100%)", x: 7, y: 27, r: -4 },
	{ clip: "polygon(66.66% 66.66%, 100% 66.66%, 100% 100%, 66.66% 100%)", x: 20, y: 19, r: -8 },
] as const;

const LogoReveal: React.FC<{
	scene: MotionScene;
	palette: MotionBrandPalette;
	imageAssets: MotionImageAsset[];
	creditLine?: string;
}> = ({ scene, palette, imageAssets, creditLine }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const source = imageAssets.find((asset) => asset.assetId === scene.logoAssetId)?.src;
	const progress = spring({
		frame,
		fps,
		config: { damping: 22, stiffness: 100, mass: 0.8 },
	});
	const fragmentProgress = interpolate(progress, [0, 0.08, 0.92, 1], [0, 0.2, 1, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const fragmentOpacity = interpolate(progress, [0, 0.08, 0.78, 1], [0, 1, 0.9, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const finalOpacity = interpolate(progress, [0.72, 0.96, 1], [0, 0.8, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const taglineStart = Math.round(fps * 1.35);
	const tagline = scene.tagline?.trim();

	if (!source) return null;

	return (
		<AbsoluteFill
			style={{
				alignItems: "center",
				justifyContent: "center",
				background: `linear-gradient(135deg, ${palette.background}, ${palette.surface})`,
			}}
		>
			<div
				style={{
					position: "relative",
					width: "min(68vw, 980px)",
					height: "min(30vh, 320px)",
				}}
			>
				{LOGO_FRAGMENTS.map((fragment, index) => (
					<Img
						key={`logo-fragment-${index}`}
						src={source}
						style={{
							position: "absolute",
							inset: 0,
							width: "100%",
							height: "100%",
							objectFit: "contain",
							clipPath: fragment.clip,
							opacity: fragmentOpacity,
							transform: `translate(${(1 - fragmentProgress) * fragment.x}%, ${(1 - fragmentProgress) * fragment.y}%) rotate(${(1 - fragmentProgress) * fragment.r}deg) scale(${1 + (1 - fragmentProgress) * 0.08})`,
						}}
					/>
				))}
				<Img
					src={source}
					style={{
						position: "absolute",
						inset: 0,
						width: "100%",
						height: "100%",
						objectFit: "contain",
						opacity: finalOpacity,
					}}
				/>
			</div>
			{tagline ? (
				<div
					style={{
						position: "relative",
						marginTop: 34,
						display: "flex",
						flexWrap: "wrap",
						justifyContent: "center",
						fontFamily: 'Inter, -apple-system, "Segoe UI", sans-serif',
						fontSize: "min(4vw, 54px)",
						fontWeight: 650,
						letterSpacing: -1.2,
						color: palette.primary,
					}}
				>
					{tagline.split("").map((character, index) => {
						const charProgress = spring({
							frame: frame - taglineStart - index * 1.2,
							fps,
							config: { damping: 20, stiffness: 125, mass: 0.7 },
						});
						const direction = index % 2 === 0 ? -1 : 1;
						return (
							<span
								key={`tagline-${index}`}
								style={{
									display: "inline-block",
									opacity: charProgress,
									transform: `translate(${(1 - charProgress) * direction * 18}px, ${(1 - charProgress) * 22}px) rotate(${(1 - charProgress) * direction * 5}deg)`,
								}}
							>
								{character === " " ? "\u00A0" : character}
							</span>
						);
					})}
				</div>
			) : null}
			{creditLine ? <MotionAttribution line={creditLine} /> : null}
		</AbsoluteFill>
	);
};

const ImageMotionScene: React.FC<{
	scene: MotionScene;
	palette: MotionBrandPalette;
	scale: number;
	imageAssets: MotionImageAsset[];
	creditLine?: string;
}> = ({ scene, palette, scale, imageAssets, creditLine }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const source = imageAssets.find((asset) => asset.assetId === scene.imageAssetId)?.src;
	const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * fps));
	const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const motion = scene.imageMotion ?? "ken-burns";
	const treatment = scene.motionPreset;
	const framed = treatment === "collage" || treatment === "card-stack";
	const imageScale =
		treatment === "macro-crop"
			? interpolate(progress, [0, 1], [1.16, 1.25])
			: motion === "float"
				? interpolate(progress, [0, 1], [1.03, 1.07])
				: interpolate(progress, [0, 1], [1.04, 1.12]);
	const translateX =
		treatment === "macro-crop"
			? interpolate(progress, [0, 1], [-1.5, 1.5])
			: motion === "parallax"
				? interpolate(progress, [0, 1], [-2.5, 2.5])
				: motion === "float"
					? interpolate(progress, [0, 1], [0, -1.2])
					: interpolate(progress, [0, 1], [-1.5, 1.5]);
	const translateY =
		motion === "float"
			? interpolate(progress, [0, 1], [1, -1])
			: interpolate(progress, [0, 1], [0.5, -0.5]);

	if (!source) return null;

	return (
		<AbsoluteFill
			style={{
				background: framed
					? `linear-gradient(135deg, ${palette.background}, ${rgba(palette.primary, 0.16)})`
					: palette.background,
				overflow: "hidden",
			}}
		>
			{framed ? (
				<div
					style={{
						position: "absolute",
						left: "7%",
						top: "10%",
						width: "82%",
						height: "78%",
						borderRadius: 34,
						background: rgba(palette.highlight, 0.12),
						transform: "rotate(-3deg)",
					}}
				/>
			) : null}
			<Img
				src={source}
				style={{
					position: "absolute",
					left: framed ? "8%" : 0,
					top: framed ? "8%" : 0,
					width: framed ? "84%" : "100%",
					height: framed ? "80%" : "100%",
					borderRadius: framed ? 34 : 0,
					boxShadow: framed ? `0 26px 80px ${rgba(palette.background, 0.32)}` : undefined,
					objectFit: "cover",
					transform: `translate(${translateX}%, ${translateY}%) scale(${imageScale})`,
					filter: `saturate(1.02) contrast(1.03) brightness(${palette.mode === "light" ? 1 : 0.9})`,
				}}
			/>
			<AbsoluteFill
				style={{
					left: framed ? "8%" : 0,
					top: framed ? "8%" : 0,
					width: framed ? "84%" : "100%",
					height: framed ? "80%" : "100%",
					borderRadius: framed ? 34 : 0,
					overflow: "hidden",
					background:
						palette.mode === "light"
							? `linear-gradient(90deg, ${rgba(palette.background, 0.82)} 0%, ${rgba(palette.background, 0.42)} 48%, ${rgba(palette.primary, 0.1)} 100%)`
							: `linear-gradient(90deg, ${rgba(palette.background, 0.76)} 0%, ${rgba(palette.background, 0.32)} 48%, ${rgba(palette.primary, 0.12)} 100%)`,
				}}
			/>
			<CardCopy scene={scene} accent={palette.primary} scale={scale} palette={palette} />
			{creditLine ? <MotionAttribution line={creditLine} /> : null}
		</AbsoluteFill>
	);
};

const VideoMotionScene: React.FC<{
	scene: MotionScene;
	palette: MotionBrandPalette;
	scale: number;
	videoAssets: MotionVideoAsset[];
	creditLine?: string;
}> = ({ scene, palette, scale, videoAssets, creditLine }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const source = videoAssets.find((asset) => asset.assetId === scene.videoAssetId)?.src;
	const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * fps));
	const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const motion = scene.videoMotion ?? "steady";
	const treatment = scene.motionPreset;
	const framed = treatment === "collage" || treatment === "card-stack";
	const scaleAmount =
		treatment === "macro-crop"
			? interpolate(progress, [0, 1], [1.1, 1.18])
			: motion === "push-in" || treatment === "hero-push"
				? interpolate(progress, [0, 1], [1.01, 1.08])
				: 1.015;
	const translateX = motion === "drift" ? interpolate(progress, [0, 1], [-1.8, 1.8]) : 0;
	const translateY = motion === "drift" ? interpolate(progress, [0, 1], [0.7, -0.7]) : 0;
	const sourceStart = Math.max(0, scene.sourceStartSeconds ?? 0);
	const sourceDuration = scene.sourceDurationSeconds
		? Math.max(0.5, scene.sourceDurationSeconds)
		: scene.durationSeconds;
	const trimProps =
		scene.sourceDurationSeconds !== undefined
			? {
					trimBefore: Math.round(sourceStart * fps),
					trimAfter: Math.round((sourceStart + sourceDuration) * fps),
				}
			: {};

	if (!source) return null;

	return (
		<AbsoluteFill
			style={{
				background: framed
					? `linear-gradient(135deg, ${palette.background}, ${rgba(palette.primary, 0.16)})`
					: palette.background,
				overflow: "hidden",
			}}
		>
			{framed ? (
				<div
					style={{
						position: "absolute",
						left: "7%",
						top: "10%",
						width: "82%",
						height: "78%",
						borderRadius: 34,
						background: rgba(palette.highlight, 0.12),
						transform: "rotate(3deg)",
					}}
				/>
			) : null}
			<OffthreadVideo
				src={source}
				{...trimProps}
				muted
				style={{
					position: "absolute",
					left: framed ? "8%" : 0,
					top: framed ? "8%" : 0,
					width: framed ? "84%" : "100%",
					height: framed ? "80%" : "100%",
					borderRadius: framed ? 34 : 0,
					boxShadow: framed ? `0 26px 80px ${rgba(palette.background, 0.32)}` : undefined,
					objectFit: "cover",
					transform: `translate(${translateX}%, ${translateY}%) scale(${scaleAmount})`,
					filter: "saturate(1.04) contrast(1.03)",
				}}
			/>
			<AbsoluteFill
				style={{
					left: framed ? "8%" : 0,
					top: framed ? "8%" : 0,
					width: framed ? "84%" : "100%",
					height: framed ? "80%" : "100%",
					borderRadius: framed ? 34 : 0,
					overflow: "hidden",
					background:
						scene.headline || scene.subhead || scene.eyebrow
							? `linear-gradient(90deg, ${rgba(palette.background, palette.mode === "light" ? 0.2 : 0.16)} 0%, transparent 72%)`
							: "transparent",
				}}
			/>
			<CardCopy scene={scene} accent={palette.primary} scale={scale} palette={palette} />
			{creditLine ? <MotionAttribution line={creditLine} /> : null}
		</AbsoluteFill>
	);
};

function layerColor(
	value: string | undefined,
	palette: MotionBrandPalette,
	fallback: string,
): string {
	const tokens: Record<string, string> = {
		background: palette.background,
		surface: palette.surface,
		primary: palette.primary,
		secondary: palette.secondary,
		highlight: palette.highlight,
		text: palette.text,
		mutedText: palette.mutedText,
	};
	if (value && tokens[value]) return tokens[value];
	if (value && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) return value;
	return fallback;
}

const LayeredMotionLayer: React.FC<{
	layer: MotionLayer;
	scene: MotionScene;
	palette: MotionBrandPalette;
	scale: number;
	imageAssets: MotionImageAsset[];
	videoAssets: MotionVideoAsset[];
}> = ({ layer, scene, palette, scale, imageAssets, videoAssets }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * fps));
	const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const motion = layer.motion ?? "none";
	const reveal = interpolate(frame, [0, Math.min(8, durationInFrames)], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const motionX = motion === "drift" ? interpolate(progress, [0, 1], [-2, 2]) : 0;
	const motionY =
		motion === "drift"
			? interpolate(progress, [0, 1], [1.5, -1.5])
			: motion === "rise"
				? interpolate(progress, [0, 1], [8, 0])
				: 0;
	const scaleIn =
		motion === "push-in"
			? interpolate(progress, [0, 1], [1.01, 1.08])
			: motion === "scale-in"
				? interpolate(progress, [0, 1], [0.86, 1])
				: 1;
	const clipPath =
		motion === "wipe" ? `inset(0 ${Math.max(0, 100 - reveal * 100)}% 0 0)` : undefined;
	const fallbackColor = layer.kind === "text" ? palette.text : palette.primary;
	const color = layerColor(layer.color, palette, fallbackColor);
	const imageSource = layer.assetId
		? imageAssets.find((asset) => asset.assetId === layer.assetId)?.src
		: undefined;
	const videoSource = layer.assetId
		? videoAssets.find((asset) => asset.assetId === layer.assetId)?.src
		: undefined;
	const isAssetLayer = layer.kind === "image" || layer.kind === "logo" || layer.kind === "video";
	if (isAssetLayer && !imageSource && !videoSource) return null;

	const boxStyle: React.CSSProperties = {
		position: "absolute",
		left: `${layer.x * 100}%`,
		top: `${layer.y * 100}%`,
		width: `${layer.width * 100}%`,
		height: `${layer.height * 100}%`,
		zIndex: layer.zIndex,
		// Footage, supplied imagery, and structural shapes are editorial anchors,
		// not title-card fades. They must be visible on frame 0 so the first frame
		// never reads as an accidental blank. Text and explicit wipe motion still
		// receive a short, intentional reveal.
		opacity:
			layer.kind === "text" || motion === "wipe" || motion === "scale-in"
				? layer.opacity * reveal
				: layer.opacity,
		borderRadius: Math.round(layer.borderRadius * scale),
		overflow: "hidden",
		transform: `translate(${motionX}%, ${motionY}%) rotate(${layer.rotation}deg) scale(${scaleIn})`,
		transformOrigin: "center center",
		clipPath,
	};

	if (layer.kind === "shape") {
		return <div style={{ ...boxStyle, background: color }} />;
	}
	if (layer.kind === "text") {
		return (
			<div
				style={{
					...boxStyle,
					display: "flex",
					alignItems: "center",
					justifyContent:
						layer.textAlign === "center"
							? "center"
							: layer.textAlign === "right"
								? "flex-end"
								: "flex-start",
					fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif',
					fontSize: Math.round((layer.fontSize ?? 64) * scale),
					fontWeight: layer.fontWeight ?? 700,
					lineHeight: 1.08,
					textAlign: layer.textAlign ?? "left",
					whiteSpace: "pre-wrap",
					color,
					textShadow:
						palette.mode === "light"
							? "0 2px 20px rgba(255,255,255,0.6)"
							: "0 3px 20px rgba(0,0,0,0.4)",
				}}
			>
				{layer.text}
			</div>
		);
	}
	if (layer.kind === "video" && videoSource) {
		const sourceStart = Math.max(0, layer.sourceStartSeconds ?? 0);
		const sourceDuration = Math.max(0.5, layer.sourceDurationSeconds ?? scene.durationSeconds);
		const trimProps =
			layer.sourceDurationSeconds !== undefined
				? {
						trimBefore: Math.round(sourceStart * fps),
						trimAfter: Math.round((sourceStart + sourceDuration) * fps),
					}
				: {};
		return (
			<div style={boxStyle}>
				<OffthreadVideo
					src={videoSource}
					{...trimProps}
					muted
					style={{ width: "100%", height: "100%", objectFit: layer.fit ?? "cover" }}
				/>
			</div>
		);
	}
	if ((layer.kind === "image" || layer.kind === "logo") && imageSource) {
		return (
			<div style={boxStyle}>
				<Img
					src={imageSource}
					style={{
						width: "100%",
						height: "100%",
						objectFit: layer.fit ?? (layer.kind === "logo" ? "contain" : "cover"),
						mixBlendMode:
							layer.kind === "logo" && palette.mode === "light" ? "multiply" : undefined,
					}}
				/>
			</div>
		);
	}
	return null;
};

const LayeredMotionScene: React.FC<{
	scene: MotionScene;
	palette: MotionBrandPalette;
	scale: number;
	imageAssets: MotionImageAsset[];
	videoAssets: MotionVideoAsset[];
}> = ({ scene, palette, scale, imageAssets, videoAssets }) => {
	const layers = [...(scene.layers ?? [])].sort((a, b) => a.zIndex - b.zIndex);
	const isCardStack = scene.motionPreset === "card-stack" || scene.motionPreset === "collage";
	const hasFullFrameVideo = layers.some(
		(layer) =>
			layer.kind === "video" &&
			layer.x <= 0.02 &&
			layer.y <= 0.02 &&
			layer.width >= 0.9 &&
			layer.height >= 0.85,
	);
	const safeLayers = layers.filter(
		(layer) =>
			!(hasFullFrameVideo && layer.kind === "shape" && layer.y >= 0.58 && layer.width >= 0.7),
	);
	return (
		<AbsoluteFill style={{ background: palette.background, overflow: "hidden" }}>
			{isCardStack ? (
				<>
					<div
						style={{
							position: "absolute",
							left: "9%",
							top: "12%",
							width: "78%",
							height: "70%",
							borderRadius: 30,
							background: rgba(palette.primary, 0.1),
							transform: "rotate(-2deg)",
						}}
					/>
					<div
						style={{
							position: "absolute",
							left: "11%",
							top: "10%",
							width: "78%",
							height: "70%",
							borderRadius: 30,
							background: rgba(palette.highlight, 0.08),
							transform: "rotate(2deg)",
						}}
					/>
				</>
			) : null}
			<div
				style={{
					position: "absolute",
					inset: "-18%",
					background: `radial-gradient(circle at 78% 22%, ${rgba(palette.primary, palette.mode === "light" ? 0.16 : 0.22)} 0%, transparent 42%), radial-gradient(circle at 18% 86%, ${rgba(palette.secondary, palette.mode === "light" ? 0.12 : 0.18)} 0%, transparent 42%)`,
				}}
			/>
			{safeLayers.map((layer) => (
				<LayeredMotionLayer
					key={layer.id}
					layer={layer}
					scene={scene}
					palette={palette}
					scale={scale}
					imageAssets={imageAssets}
					videoAssets={videoAssets}
				/>
			))}
		</AbsoluteFill>
	);
};

const MotionSceneView: React.FC<{
	scene: MotionScene;
	palette: MotionBrandPalette;
	scale: number;
	imageAssets: MotionImageAsset[];
	videoAssets: MotionVideoAsset[];
	showAttribution: boolean;
	attributionLine?: string;
}> = ({ scene, palette, scale, imageAssets, videoAssets, showAttribution, attributionLine }) => {
	if (scene.kind === "layered") {
		if (scene.layers?.length) {
			return (
				<>
					<LayeredMotionScene
						scene={scene}
						palette={palette}
						scale={scale}
						imageAssets={imageAssets}
						videoAssets={videoAssets}
					/>
					{showAttribution && attributionLine ? <MotionAttribution line={attributionLine} /> : null}
				</>
			);
		}
	}
	if (scene.kind === "logo") {
		const source = imageAssets.some((asset) => asset.assetId === scene.logoAssetId);
		if (source) {
			return (
				<LogoReveal
					scene={scene}
					palette={palette}
					imageAssets={imageAssets}
					{...(showAttribution && attributionLine ? { creditLine: attributionLine } : {})}
				/>
			);
		}
		// A missing staged file must never create a blank frame. Fall through to
		// the fixed card renderer, which is safe and reviewable.
	}
	if (scene.kind === "image") {
		const source = imageAssets.some((asset) => asset.assetId === scene.imageAssetId);
		if (source) {
			return (
				<ImageMotionScene
					scene={scene}
					palette={palette}
					scale={scale}
					imageAssets={imageAssets}
					{...(showAttribution && attributionLine ? { creditLine: attributionLine } : {})}
				/>
			);
		}
	}
	if (scene.kind === "video") {
		const source = videoAssets.some((asset) => asset.assetId === scene.videoAssetId);
		if (source) {
			return (
				<VideoMotionScene
					scene={scene}
					palette={palette}
					scale={scale}
					videoAssets={videoAssets}
					{...(showAttribution && attributionLine ? { creditLine: attributionLine } : {})}
				/>
			);
		}
	}
	if (scene.kind === "text") {
		return <BrandTextScene scene={scene} palette={palette} scale={scale} />;
	}

	const fallbackScene: MotionScene =
		scene.kind === "logo" ||
		scene.kind === "image" ||
		scene.kind === "video" ||
		scene.kind === "layered"
			? {
					...scene,
					kind: "card",
					backdrop: "gradient-drift",
					headline:
						scene.headline ??
						(scene.kind === "logo"
							? "Brand reveal"
							: scene.kind === "video"
								? "Source moment"
								: scene.kind === "layered"
									? "Visual story"
									: "Visual moment"),
				}
			: scene;
	return (
		<AbsoluteFill style={{ backgroundColor: palette.background }}>
			<BrandBackdrop id={fallbackScene.backdrop} palette={palette} />
			<Scrim palette={palette} />
			<CardCopy scene={fallbackScene} accent={palette.primary} scale={scale} palette={palette} />
			{showAttribution && attributionLine ? <MotionAttribution line={attributionLine} /> : null}
		</AbsoluteFill>
	);
};

const SceneEntrance: React.FC<{ scene: MotionScene; children: React.ReactNode }> = ({
	scene,
	children,
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const transition = scene.transitionIn ?? "cut";
	const transitionFrames =
		transition === "cut"
			? 0
			: Math.min(Math.round(fps * 0.42), Math.max(1, Math.round(fps * 0.65)));
	const progress = transitionFrames
		? interpolate(frame, [0, transitionFrames], [0, 1], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 1;
	const transform =
		transition === "scale-through"
			? `scale(${interpolate(progress, [0, 1], [1.035, 1])})`
			: transition === "match-cut"
				? `translate(${interpolate(progress, [0, 1], [3, 0])}%, 0%) scale(${interpolate(progress, [0, 1], [1.08, 1])})`
				: undefined;
	const clipPath =
		transition === "wipe" || transition === "match-cut"
			? `inset(0 ${Math.max(0, (1 - progress) * 100)}% 0 0)`
			: undefined;
	return <AbsoluteFill style={{ opacity: progress, transform, clipPath }}>{children}</AbsoluteFill>;
};

export const MotionGraphicsComposition: React.FC<MotionCompositionProps> = ({
	accent,
	scenes,
	imageAssets = [],
	videoAssets = [],
	brandPalette,
	attributionLine,
	captions,
}) => {
	const { fps, width } = useVideoConfig();
	const scale = width / 1920;
	const palette = paletteFor(accent, brandPalette);

	let cursor = 0;
	const placed = scenes.map((scene) => {
		const durationInFrames = Math.max(1, Math.round(Math.max(0.5, scene.durationSeconds) * fps));
		const from = cursor;
		cursor += durationInFrames;
		return { scene, from, durationInFrames };
	});

	return (
		<AbsoluteFill style={{ backgroundColor: palette.background }}>
			{placed.map(({ scene, from, durationInFrames }, index) => (
				<Sequence
					key={scene.id || `scene-${index}`}
					from={from}
					durationInFrames={durationInFrames}
					layout="none"
				>
					<SceneEntrance scene={scene}>
						<MotionSceneView
							scene={scene}
							palette={palette}
							scale={scale}
							imageAssets={imageAssets}
							videoAssets={videoAssets}
							showAttribution={index === placed.length - 1}
							attributionLine={attributionLine}
						/>
					</SceneEntrance>
				</Sequence>
			))}
			<RenderCaptionOverlay lines={captions} />
		</AbsoluteFill>
	);
};
