import React from "react";
import {
	AbsoluteFill,
	Audio,
	Easing,
	Img,
	interpolate,
	OffthreadVideo,
	Sequence,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { Scene3d } from "./three/Scene3d";
import type { Scene3dId, Scene3dParams } from "./three/scenes";
import { WhiteboardFrame as WhiteboardSurface } from "./WhiteboardFrame";

// ── HyperFrame ───────────────────────────────────────────────────────────
//
// A fixed, data-only frame library for product-demo videos. The planner model
// never writes code for this composition: it emits schema-validated props that
// select and parameterise the frames below. Text, timing, and a bounded focus
// region are the only model-controlled inputs, so a render cannot execute
// model output, reach the network, or load an unapproved asset.

export type HyperFrameKind =
	| "title"
	| "screen"
	| "callout"
	| "split"
	| "bullets"
	| "statement"
	| "outro"
	| "image"
	| "imageSplit"
	| "scene3d"
	| "whiteboard";

export type HyperFrameAccent = "indigo" | "emerald" | "amber" | "rose" | "violet";

/**
 * Normalized emphasis region, expressed in the same terms as the editor's zoom
 * regions so an approved storyboard maps onto editable timeline data directly.
 */
export interface HyperFrameFocus {
	cx: number;
	cy: number;
	scale: number;
}

export interface HyperFrame {
	id: string;
	kind: HyperFrameKind;
	durationSeconds: number;
	eyebrow?: string;
	headline?: string;
	subhead?: string;
	bullets?: string[];
	caption?: string;
	focus?: HyperFrameFocus;
	/** Offset into the source recording, in seconds. */
	sourceStartSeconds?: number;
	/** Which half holds the recording in a `split` frame. */
	side?: "left" | "right";
	/** The supplied asset an `image` or `imageSplit` frame displays. */
	assetId?: string;
	/** Which audited 3D scene a `scene3d` frame renders. */
	scene?: Scene3dId;
	/** Bounded parameters for that scene. Validated before it ever gets here. */
	sceneParams?: Scene3dParams;
}

/** Bundle-relative supplied image or GIF, prepared by the privileged renderer. */
export interface HyperFrameImageAsset {
	assetId: string;
	src: string;
}

/** Bundle-relative narration audio for one frame, prepared by the renderer. */
export interface HyperFrameNarrationClip {
	frameId: string;
	src: string;
}

/**
 * A brand's own colour and mark, replacing the named accent. Only the accent
 * and the logo are themed: the canvas, ink and surface stay as the studio's
 * dark design system, because dropping a brand's white marketing background
 * into these layouts produces a worse-looking video, not a more on-brand one.
 */
export interface HyperFrameTheme {
	accentHex: string;
	softHex: string;
	glowRgba: string;
	/** Bundle-relative logo, drawn small on the title and outro cards. */
	logoSrc?: string;
	/**
	 * False for an opaque logo — a JPEG favicon, say. Drawn bare on a dark card
	 * such a file reads as a stray white rectangle, so it needs a container.
	 */
	logoHasAlpha?: boolean;
}

/**
 * Derives the two supporting tones from one brand colour, so callers supply a
 * hex and nothing else. Kept here beside the palette it has to match.
 */
export function themeFromAccentHex(
	accentHex: string,
	logoSrc?: string,
	logoHasAlpha = true,
): HyperFrameTheme {
	const rgb = parseHex(accentHex) ?? [0x63, 0x66, 0xf1];
	const soft = rgb.map((channel) => Math.round(channel + (255 - channel) * 0.45)) as [
		number,
		number,
		number,
	];
	return {
		accentHex: toHex(rgb),
		softHex: toHex(soft),
		glowRgba: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`,
		...(logoSrc ? { logoSrc, logoHasAlpha } : {}),
	};
}

function parseHex(value: string): [number, number, number] | undefined {
	const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
	if (!match) return undefined;
	const digits = match[1] as string;
	return [
		Number.parseInt(digits.slice(0, 2), 16),
		Number.parseInt(digits.slice(2, 4), 16),
		Number.parseInt(digits.slice(4, 6), 16),
	];
}

function toHex([r, g, b]: [number, number, number]) {
	return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export interface HyperFrameCompositionProps {
	title: string;
	accent: HyperFrameAccent;
	frames: HyperFrame[];
	/** Bundle-relative recording prepared by the privileged renderer. */
	screenSrc?: string;
	/** Pixel size of the recording, needed to place focus points correctly. */
	screenWidth?: number;
	screenHeight?: number;
	/** A single narration mix that plays across the whole video. */
	narrationSrc?: string;
	/** Per-frame narration, used when the local voice speaks one clip per frame. */
	narrationClips?: HyperFrameNarrationClip[];
	/** Supplied images and GIFs, resolved to bundle-relative sources. */
	imageAssets?: HyperFrameImageAsset[];
	/** A brand's colour and mark. Absent, the named `accent` is used unchanged. */
	theme?: HyperFrameTheme;
	/** Defaults to `HYPERFRAME_ZOOM_ENABLED` (off). See the Zoom section. */
	allowZoom?: boolean;
}

const ACCENTS: Record<HyperFrameAccent, { base: string; soft: string; glow: string }> = {
	indigo: { base: "#6366F1", soft: "#A5B4FC", glow: "rgba(99,102,241,0.35)" },
	emerald: { base: "#10B981", soft: "#6EE7B7", glow: "rgba(16,185,129,0.35)" },
	amber: { base: "#F59E0B", soft: "#FCD34D", glow: "rgba(245,158,11,0.35)" },
	rose: { base: "#F43F5E", soft: "#FDA4AF", glow: "rgba(244,63,94,0.35)" },
	violet: { base: "#8B5CF6", soft: "#C4B5FD", glow: "rgba(139,92,246,0.35)" },
};

const INK = "#F8FAFC";
const MUTED = "#94A3B8";
const CANVAS = "#0B0F14";
const SURFACE = "#12181F";

const FONT =
	'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ── Design space ─────────────────────────────────────────────────────────
//
// Every frame is laid out in a fixed 1920-wide space and scaled to whatever
// the composition actually is. A 9:16 render therefore gets a 1920×3413 design
// canvas scaled to 0.5625, which means every pixel value in this file stays
// correct at every aspect ratio, and type ends up the same size *relative to
// the frame* in each one.
//
// The alternative — multiplying forty hard-coded sizes by a scale factor — is
// the same idea with forty places to get it wrong.

const DESIGN_WIDTH = 1920;

// ── Zoom ─────────────────────────────────────────────────────────────────
//
// Zoom is off. Reviewing real output showed it does not work well here: the
// entrance scales read as a wobble rather than a move, and a focus push on a
// screen recording magnifies compression artefacts and interface text that was
// never rendered for it.
//
// "Off" has to mean everywhere, or it half-applies: the per-frame entrance
// scales, the focus push on a recording, and the zoom regions seeded into the
// generated `.guide` project all come from this one flag. Entrances still fade
// and slide, and a `focus` region still positions a callout ring — that is
// placement, not magnification.

export const HYPERFRAME_ZOOM_ENABLED = false;

/**
 * Entrance scale for a frame. `from` is where the scale starts; with zoom off it
 * is ignored and the frame renders at its true size for its whole duration.
 */
export function entranceScale(rise: number, from: number, allowZoom: boolean) {
	return allowZoom ? from + (1 - from) * rise : 1;
}

export type HyperFrameFormat = "landscape" | "vertical" | "square";

/**
 * The output shapes the library renders to. Landscape keeps the original
 * composition id so existing projects and exports are unaffected.
 */
export const HYPERFRAME_FORMATS = [
	{ id: "HyperFrameDemo", format: "landscape", width: 1920, height: 1080 },
	{ id: "HyperFrameDemoVertical", format: "vertical", width: 1080, height: 1920 },
	{ id: "HyperFrameDemoSquare", format: "square", width: 1080, height: 1080 },
] as const satisfies ReadonlyArray<{
	id: string;
	format: HyperFrameFormat;
	width: number;
	height: number;
}>;

export function hyperFrameFormatSpec(format: HyperFrameFormat = "landscape") {
	return HYPERFRAME_FORMATS.find((entry) => entry.format === format) ?? HYPERFRAME_FORMATS[0];
}

/** The layout canvas for a given output size. Always 1920 wide. */
export function designSize(composition: Size): Size {
	if (!composition.width || !composition.height) {
		return { width: DESIGN_WIDTH, height: 1080 };
	}
	return {
		width: DESIGN_WIDTH,
		height: Math.round((DESIGN_WIDTH * composition.height) / composition.width),
	};
}

/**
 * Below this aspect a side-by-side split leaves neither column wide enough to
 * read, so the media and the copy stack instead.
 */
const STACKED_SPLIT_ASPECT = 1.35;

export function isStackedSplit(canvas: Size) {
	return canvas.width / canvas.height < STACKED_SPLIT_ASPECT;
}

export function calculateHyperFrameDuration(frames: HyperFrame[], fps: number) {
	const seconds = frames.reduce((total, frame) => total + Math.max(0.5, frame.durationSeconds), 0);
	return Math.max(fps * 2, Math.round(seconds * fps));
}

export const HyperFrameComposition: React.FC<HyperFrameCompositionProps> = ({
	title,
	accent,
	frames,
	screenSrc,
	screenWidth,
	screenHeight,
	narrationSrc,
	narrationClips,
	imageAssets,
	theme,
	allowZoom = HYPERFRAME_ZOOM_ENABLED,
}) => {
	const { fps, width, height } = useVideoConfig();
	const canvas = designSize({ width, height });
	const canvasScale = width / canvas.width;
	// A brand colour replaces the named accent wherever one was derived; every
	// frame reads its colour from this one object, so nothing can miss the theme.
	const palette: FramePalette = theme
		? { base: theme.accentHex, soft: theme.softHex, glow: theme.glowRgba }
		: (ACCENTS[accent] ?? ACCENTS.indigo);
	const safeFrames = frames.length
		? frames
		: [{ id: "frame-1", kind: "title" as const, durationSeconds: 4, headline: title }];

	let cursor = 0;
	return (
		<AbsoluteFill style={{ backgroundColor: CANVAS, fontFamily: FONT }}>
			{safeFrames.map((frame, index) => {
				const durationInFrames = Math.max(1, Math.round(frame.durationSeconds * fps));
				const from = cursor;
				cursor += durationInFrames;
				// Per-frame narration lives inside the frame's own Sequence, so a
				// clip can never drift away from the visual it describes.
				const clip = narrationClips?.find((item) => item.frameId === frame.id);
				return (
					<Sequence
						key={`${frame.id}-${index}`}
						from={from}
						durationInFrames={durationInFrames}
						layout="none"
					>
						<div
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: canvas.width,
								height: canvas.height,
								transform: `scale(${canvasScale})`,
								transformOrigin: "top left",
							}}
						>
							<HyperFrameRenderer
								frame={frame}
								palette={palette}
								canvas={canvas}
								allowZoom={allowZoom}
								durationInFrames={durationInFrames}
								screenSrc={screenSrc}
								recording={
									screenWidth && screenHeight
										? { width: screenWidth, height: screenHeight }
										: undefined
								}
								imageAssets={imageAssets}
								logoSrc={theme?.logoSrc}
							/>
						</div>
						{clip ? <Audio src={clip.src} /> : null}
					</Sequence>
				);
			})}
			{narrationSrc ? <Audio src={narrationSrc} /> : null}
		</AbsoluteFill>
	);
};

// ── Frame dispatch ───────────────────────────────────────────────────────

interface FramePalette {
	base: string;
	soft: string;
	glow: string;
}

interface FrameProps {
	recording?: Size;
	imageAssets?: HyperFrameImageAsset[];
	frame: HyperFrame;
	palette: FramePalette;
	/**
	 * The 1920-wide layout canvas, not the output size. Anything that has to
	 * know the aspect ratio — the split direction, the focus mapping — reads it
	 * from here rather than from `useVideoConfig`, so the two can never disagree.
	 */
	canvas: Size;
	durationInFrames: number;
	screenSrc?: string;
	/** Brand mark, drawn only on the cards that open and close the video. */
	logoSrc?: string;
	/** False for an opaque logo, which needs a container to not look broken. */
	logoHasAlpha?: boolean;
	/** When false, nothing in the frame scales. */
	allowZoom: boolean;
}

const HyperFrameRenderer: React.FC<FrameProps> = (props) => {
	const fade = useFrameFade(props.durationInFrames);
	const body = renderFrameBody(props);
	return <AbsoluteFill style={{ opacity: fade }}>{body}</AbsoluteFill>;
};

function renderFrameBody(props: FrameProps) {
	switch (props.frame.kind) {
		case "screen":
			return <ScreenFrame {...props} />;
		case "callout":
			return <CalloutFrame {...props} />;
		case "split":
			return <SplitFrame {...props} />;
		case "bullets":
			return <BulletsFrame {...props} />;
		case "statement":
			return <StatementFrame {...props} />;
		case "outro":
			return <OutroFrame {...props} />;
		case "image":
			return <ImageFrame {...props} />;
		case "imageSplit":
			return <ImageSplitFrame {...props} />;
		case "scene3d":
			return <Scene3dFrame {...props} />;
		case "whiteboard":
			return <WhiteboardFrameBody {...props} />;
		default:
			return <TitleFrame {...props} />;
	}
}

/**
 * A 3D scene with the usual copy layered over it. The scene is drawn at the
 * design canvas size and the text sits above it, so a dimensional frame still
 * carries a headline like every other kind.
 */
const Scene3dFrame: React.FC<FrameProps> = ({
	frame,
	palette,
	canvas,
	durationInFrames,
	imageAssets,
}) => {
	const rise = useRise();
	// The scene names its assets; they are resolved here to the same
	// bundle-relative sources the 2D image frames use.
	const named = [
		...(frame.sceneParams?.assetId ? [frame.sceneParams.assetId] : []),
		...(frame.sceneParams?.assetIds ?? []),
	];
	const textures = named.flatMap((assetId) => {
		const match = imageAssets?.find((asset) => asset.assetId === assetId);
		return match ? [match.src] : [];
	});
	return (
		<AbsoluteFill>
			<Scene3d
				scene={frame.scene ?? "particle_field"}
				params={frame.sceneParams ?? {}}
				textures={textures}
				durationInFrames={durationInFrames}
				accentHex={palette.base}
				softHex={palette.soft}
				width={canvas.width}
				height={canvas.height}
			/>
			{frame.headline ? (
				<AbsoluteFill
					style={{
						justifyContent: "flex-end",
						padding: FRAME_PADDING + 24,
						opacity: rise,
						transform: `translateY(${(1 - rise) * 22}px)`,
						// A gradient scrim, so copy stays readable over a bright scene.
						background: "linear-gradient(180deg, rgba(11,15,20,0) 45%, rgba(11,15,20,0.88) 100%)",
					}}
				>
					{frame.eyebrow ? <Eyebrow text={frame.eyebrow} palette={palette} /> : null}
					<div
						style={{
							color: INK,
							fontSize: 76,
							fontWeight: 700,
							letterSpacing: -2.4,
							lineHeight: 1.08,
							maxWidth: 1400,
						}}
					>
						{frame.headline}
					</div>
					{frame.subhead ? (
						<div style={{ color: MUTED, fontSize: 32, marginTop: 22, maxWidth: 1200 }}>
							{frame.subhead}
						</div>
					) : null}
				</AbsoluteFill>
			) : null}
			{frame.caption ? <CaptionBar text={frame.caption} /> : null}
		</AbsoluteFill>
	);
};

// ── Text frames ──────────────────────────────────────────────────────────

const TitleFrame: React.FC<FrameProps> = ({ frame, palette, logoSrc, logoHasAlpha }) => {
	const rise = useRise();
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<BrandMark logoSrc={logoSrc} hasAlpha={logoHasAlpha} />
			<AbsoluteFill
				style={{
					justifyContent: "center",
					padding: "0 160px",
					transform: `translateY(${(1 - rise) * 34}px)`,
					opacity: rise,
				}}
			>
				{frame.eyebrow ? <Eyebrow text={frame.eyebrow} palette={palette} /> : null}
				<div
					style={{
						color: INK,
						fontSize: 106,
						fontWeight: 700,
						letterSpacing: -3.5,
						lineHeight: 1.04,
						maxWidth: 1400,
					}}
				>
					{frame.headline}
				</div>
				{frame.subhead ? (
					<div
						style={{
							color: MUTED,
							fontSize: 38,
							fontWeight: 400,
							marginTop: 32,
							maxWidth: 1180,
							lineHeight: 1.4,
						}}
					>
						{frame.subhead}
					</div>
				) : null}
				<div
					style={{
						width: 132,
						height: 8,
						borderRadius: 4,
						marginTop: 52,
						backgroundColor: palette.base,
					}}
				/>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/**
 * Scribe-style frame: the copy is written on a whiteboard by an animated hand.
 *
 * This is the one frame that abandons the dark canvas. A whiteboard is white —
 * rendering the effect on the studio's near-black surface would read as a pen
 * scratching a blackboard, which is a different and much weaker look. The
 * accent still carries through, so a themed video stays on-brand.
 */
const WhiteboardFrameBody: React.FC<FrameProps> = ({
	frame,
	palette,
	canvas,
	durationInFrames,
}) => (
	<WhiteboardSurface
		headline={frame.headline}
		bullets={frame.bullets}
		eyebrow={frame.eyebrow}
		caption={frame.caption}
		accent={palette.base}
		durationInFrames={durationInFrames}
		canvasWidth={canvas.width}
		canvasHeight={canvas.height}
	/>
);

const StatementFrame: React.FC<FrameProps> = ({ frame, palette, allowZoom }) => {
	const rise = useRise();
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<AbsoluteFill
				style={{
					alignItems: "center",
					justifyContent: "center",
					padding: "0 200px",
					textAlign: "center",
					opacity: rise,
					transform: `scale(${entranceScale(rise, 0.96, allowZoom)})`,
				}}
			>
				{frame.eyebrow ? <Eyebrow text={frame.eyebrow} palette={palette} centered /> : null}
				<div
					style={{
						color: INK,
						fontSize: 78,
						fontWeight: 650,
						letterSpacing: -2.2,
						lineHeight: 1.18,
					}}
				>
					{frame.headline}
				</div>
				{frame.subhead ? (
					<div style={{ color: MUTED, fontSize: 34, marginTop: 30, lineHeight: 1.42 }}>
						{frame.subhead}
					</div>
				) : null}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const BulletsFrame: React.FC<FrameProps> = ({ frame, palette }) => {
	const frameNumber = useCurrentFrame();
	const { fps } = useVideoConfig();
	const bullets = frame.bullets ?? [];
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<AbsoluteFill style={{ justifyContent: "center", padding: "0 160px" }}>
				{frame.headline ? (
					<div
						style={{
							color: INK,
							fontSize: 62,
							fontWeight: 680,
							letterSpacing: -1.8,
							marginBottom: 56,
						}}
					>
						{frame.headline}
					</div>
				) : null}
				{bullets.map((bullet, index) => {
					const appear = spring({
						frame: frameNumber - index * Math.round(fps * 0.22),
						fps,
						config: { damping: 200 },
						durationInFrames: Math.round(fps * 0.6),
					});
					return (
						<div
							key={`${bullet}-${index}`}
							style={{
								display: "flex",
								alignItems: "flex-start",
								gap: 28,
								marginBottom: 34,
								opacity: appear,
								transform: `translateX(${(1 - appear) * 40}px)`,
							}}
						>
							<div
								style={{
									width: 16,
									height: 16,
									borderRadius: 8,
									marginTop: 16,
									flexShrink: 0,
									backgroundColor: palette.base,
								}}
							/>
							<div style={{ color: INK, fontSize: 40, lineHeight: 1.36, maxWidth: 1360 }}>
								{bullet}
							</div>
						</div>
					);
				})}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const OutroFrame: React.FC<FrameProps> = ({ frame, palette, logoSrc, logoHasAlpha }) => {
	const rise = useRise();
	return (
		<AbsoluteFill style={{ backgroundColor: CANVAS }}>
			<Backdrop palette={palette} intense />
			<BrandMark logoSrc={logoSrc} hasAlpha={logoHasAlpha} />
			<AbsoluteFill
				style={{
					alignItems: "center",
					justifyContent: "center",
					textAlign: "center",
					padding: "0 180px",
					opacity: rise,
				}}
			>
				<div
					style={{
						color: INK,
						fontSize: 88,
						fontWeight: 700,
						letterSpacing: -2.8,
						lineHeight: 1.1,
					}}
				>
					{frame.headline}
				</div>
				{frame.subhead ? (
					<div
						style={{
							marginTop: 40,
							padding: "20px 44px",
							borderRadius: 999,
							border: `2px solid ${palette.base}`,
							color: palette.soft,
							fontSize: 32,
							fontWeight: 560,
						}}
					>
						{frame.subhead}
					</div>
				) : null}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ── Supplied image frames ────────────────────────────────────────────────
//
// A frame whose asset never arrived degrades to its text equivalent rather than
// rendering an empty card, matching how a missing recording is handled. The
// storyboard normalizer does that substitution, so reaching these components
// with no source means the asset went missing between approval and render.

const ImageFrame: React.FC<FrameProps> = ({ frame, palette, imageAssets, allowZoom }) => {
	const rise = useRise();
	const src = imageAssets?.find((item) => item.assetId === frame.assetId)?.src;
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<AbsoluteFill style={{ padding: FRAME_PADDING, alignItems: "center" }}>
				<div
					style={{
						position: "relative",
						flex: 1,
						width: "100%",
						opacity: rise,
						transform: `scale(${entranceScale(rise, 0.985, allowZoom)})`,
					}}
				>
					{src ? (
						<Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
					) : (
						<MissingAsset palette={palette} label={frame.headline} />
					)}
				</div>
			</AbsoluteFill>
			{frame.headline ? <LowerThird frame={frame} palette={palette} /> : null}
			{frame.caption ? <CaptionBar text={frame.caption} /> : null}
		</AbsoluteFill>
	);
};

const ImageSplitFrame: React.FC<FrameProps> = ({ frame, palette, imageAssets }) => {
	const rise = useRise();
	const src = imageAssets?.find((item) => item.assetId === frame.assetId)?.src;
	const mediaFirst = (frame.side ?? "right") === "left";
	const media = (
		<div style={{ flex: 1, minWidth: 0, height: "62%", position: "relative" }}>
			{src ? (
				<Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
			) : (
				<MissingAsset palette={palette} label={frame.headline} />
			)}
		</div>
	);
	const copy = (
		<div style={{ flex: 1, minWidth: 0, opacity: rise }}>
			{frame.eyebrow ? <Eyebrow text={frame.eyebrow} palette={palette} /> : null}
			<div
				style={{ color: INK, fontSize: 54, fontWeight: 680, letterSpacing: -1.6, lineHeight: 1.14 }}
			>
				{frame.headline}
			</div>
			{frame.subhead ? (
				<div style={{ color: MUTED, fontSize: 30, marginTop: 24, lineHeight: 1.44 }}>
					{frame.subhead}
				</div>
			) : null}
			{(frame.bullets ?? []).map((bullet) => (
				<div key={bullet} style={{ display: "flex", gap: 18, marginTop: 24 }}>
					<div
						style={{
							width: 12,
							height: 12,
							borderRadius: 6,
							marginTop: 13,
							flexShrink: 0,
							backgroundColor: palette.base,
						}}
					/>
					<div style={{ color: INK, fontSize: 30, lineHeight: 1.4 }}>{bullet}</div>
				</div>
			))}
		</div>
	);
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<AbsoluteFill
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: SPLIT_GAP,
					padding: `0 ${SPLIT_PADDING_X}px`,
				}}
			>
				{mediaFirst ? media : copy}
				{mediaFirst ? copy : media}
			</AbsoluteFill>
			{frame.caption ? <CaptionBar text={frame.caption} /> : null}
		</AbsoluteFill>
	);
};

/**
 * The brand's mark, small and out of the way. Deliberately corner-pinned and
 * capped rather than laid out: a logo file can be any aspect ratio, and a wide
 * wordmark scaled to a square box would either stretch or dominate the card.
 */
const BrandMark: React.FC<{ logoSrc?: string; hasAlpha?: boolean }> = ({
	logoSrc,
	hasAlpha = true,
}) => {
	if (!logoSrc) return null;
	// An opaque logo — a JPEG favicon, a flattened PNG — is a light rectangle on
	// a dark card. Given a padded, rounded, faintly bordered chip it reads as a
	// deliberate badge instead of a rendering artifact. A logo with real
	// transparency needs none of that and sits directly on the card.
	const chrome = hasAlpha
		? {}
		: {
				backgroundColor: "#FFFFFF",
				borderRadius: 14,
				padding: "10px 14px",
				border: "1px solid rgba(255,255,255,0.14)",
			};
	return (
		<div
			style={{
				position: "absolute",
				top: 72,
				right: 96,
				height: 64,
				maxWidth: 320,
				display: "flex",
				alignItems: "center",
				justifyContent: "flex-end",
				boxSizing: "border-box",
				opacity: 0.92,
				...chrome,
			}}
		>
			<Img src={logoSrc} style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} />
		</div>
	);
};

const MissingAsset: React.FC<{ palette: FramePalette; label?: string }> = ({ palette, label }) => (
	<AbsoluteFill
		style={{
			backgroundColor: SURFACE,
			borderRadius: 20,
			border: `2px dashed ${palette.base}`,
			alignItems: "center",
			justifyContent: "center",
			color: MUTED,
			fontSize: 26,
			textAlign: "center",
			padding: 40,
		}}
	>
		{label ? `Missing asset: ${label}` : "Missing asset"}
	</AbsoluteFill>
);

// ── Focus geometry ───────────────────────────────────────────────────────
//
// A focus point is expressed in the *recording's* coordinate space, because
// that is the only space the planner can reason about. The recording is drawn
// with `object-fit: cover`, so whenever its aspect ratio differs from the box
// it is drawn into, part of it is cropped and the two spaces stop agreeing.
// Zoom origin and callout rings must both use the mapped point, or they anchor
// on the wrong pixel — badly so for a 4:3 recording in a 16:9 frame.

const FRAME_PADDING = 84;
const SPLIT_PADDING_X = 96;
const SPLIT_GAP = 84;
const SPLIT_MEDIA_HEIGHT_RATIO = 0.62;
/** Share of the column a stacked split gives the media. */
const SPLIT_STACK_MEDIA_RATIO = 0.5;

export interface Size {
	width: number;
	height: number;
}

/**
 * The pixel box the recording is drawn into, per frame kind.
 *
 * This has to stay in exact agreement with the CSS in `SplitFrame` — including
 * its stacked variant. A mismatch does not fail anything: the render succeeds
 * and simply zooms into the wrong pixel, which is invisible in review. Any
 * change to the split layout belongs here in the same commit.
 */
export function recordingBox(kind: HyperFrameKind, canvas: Size): Size {
	if (kind === "split") {
		if (isStackedSplit(canvas)) {
			return {
				width: canvas.width - SPLIT_PADDING_X * 2,
				height: (canvas.height - SPLIT_GAP * 2) * SPLIT_STACK_MEDIA_RATIO,
			};
		}
		return {
			width: (canvas.width - SPLIT_PADDING_X * 2 - SPLIT_GAP) / 2,
			height: canvas.height * SPLIT_MEDIA_HEIGHT_RATIO,
		};
	}
	return {
		width: canvas.width - FRAME_PADDING * 2,
		height: canvas.height - FRAME_PADDING * 2,
	};
}

/**
 * Converts a recording-space point into a fraction of the display box, undoing
 * the `object-fit: cover` crop. Without known recording dimensions the two
 * spaces are assumed to agree, which is exact when the aspects already match.
 */
export function mapFocusToBox(focus: HyperFrameFocus, box: Size, recording?: Size) {
	if (!recording || !recording.width || !recording.height || !box.width || !box.height) {
		return { fx: focus.cx, fy: focus.cy };
	}
	const boxAspect = box.width / box.height;
	const recordingAspect = recording.width / recording.height;
	if (recordingAspect > boxAspect) {
		// Wider than the box: cover matches height and crops the sides.
		const ratio = recordingAspect / boxAspect;
		return { fx: clamp01((1 - ratio) / 2 + focus.cx * ratio), fy: focus.cy };
	}
	// Narrower than the box: cover matches width and crops top and bottom.
	const ratio = boxAspect / recordingAspect;
	return { fx: focus.cx, fy: clamp01((1 - ratio) / 2 + focus.cy * ratio) };
}

function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

// ── Recording frames ─────────────────────────────────────────────────────

const ScreenFrame: React.FC<FrameProps> = ({
	frame,
	palette,
	canvas,
	allowZoom,
	durationInFrames,
	screenSrc,
	recording,
}) => {
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<AbsoluteFill style={{ padding: 84 }}>
				<DeviceFrame palette={palette} allowZoom={allowZoom}>
					<Recording
						frame={frame}
						screenSrc={screenSrc}
						recording={recording}
						durationInFrames={durationInFrames}
						palette={palette}
						canvas={canvas}
						allowZoom={allowZoom}
					/>
				</DeviceFrame>
			</AbsoluteFill>
			{frame.headline ? <LowerThird frame={frame} palette={palette} /> : null}
			{frame.caption ? <CaptionBar text={frame.caption} /> : null}
		</AbsoluteFill>
	);
};

const CalloutFrame: React.FC<FrameProps> = ({
	frame,
	palette,
	canvas,
	allowZoom,
	durationInFrames,
	screenSrc,
	recording,
}) => {
	const pulse = usePulse();
	// The ring must use the same mapped point as the zoom origin, or it marks a
	// different pixel than the one the frame zooms into.
	const focus = frame.focus
		? mapFocusToBox(frame.focus, recordingBox(frame.kind, canvas), recording)
		: undefined;
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<AbsoluteFill style={{ padding: 84 }}>
				<DeviceFrame palette={palette} allowZoom={allowZoom}>
					<Recording
						frame={frame}
						screenSrc={screenSrc}
						recording={recording}
						durationInFrames={durationInFrames}
						palette={palette}
						canvas={canvas}
						allowZoom={allowZoom}
					/>
					{focus ? (
						<div
							style={{
								position: "absolute",
								left: `${focus.fx * 100}%`,
								top: `${focus.fy * 100}%`,
								width: 210,
								height: 210,
								marginLeft: -105,
								marginTop: -105,
								borderRadius: "50%",
								border: `5px solid ${palette.base}`,
								boxShadow: `0 0 0 ${10 + pulse * 14}px ${palette.glow}`,
								opacity: 0.92,
							}}
						/>
					) : null}
				</DeviceFrame>
			</AbsoluteFill>
			{frame.headline ? <CalloutLabel frame={frame} palette={palette} /> : null}
			{frame.caption ? <CaptionBar text={frame.caption} /> : null}
		</AbsoluteFill>
	);
};

const SplitFrame: React.FC<FrameProps> = ({
	frame,
	palette,
	canvas,
	allowZoom,
	durationInFrames,
	screenSrc,
	recording,
}) => {
	const rise = useRise();
	const stacked = isStackedSplit(canvas);
	// `side` is a left/right instruction; stacked, it becomes above/below.
	const mediaFirst = (frame.side ?? "right") === "left";
	// The row is centred rather than stretched, so the media column needs an
	// explicit height of its own or the device frame collapses to nothing.
	const media = (
		<div
			style={
				stacked
					? { flex: "0 0 auto", width: "100%", height: `${SPLIT_STACK_MEDIA_RATIO * 100}%` }
					: { flex: 1, minWidth: 0, height: `${SPLIT_MEDIA_HEIGHT_RATIO * 100}%` }
			}
		>
			<DeviceFrame palette={palette} allowZoom={allowZoom}>
				<Recording
					frame={frame}
					screenSrc={screenSrc}
					recording={recording}
					durationInFrames={durationInFrames}
					palette={palette}
					canvas={canvas}
					allowZoom={allowZoom}
				/>
			</DeviceFrame>
		</div>
	);
	const copy = (
		<div
			style={{
				flex: stacked ? "1 1 auto" : 1,
				minWidth: 0,
				minHeight: 0,
				width: stacked ? "100%" : undefined,
				opacity: rise,
				transform: `translateY(${(1 - rise) * 26}px)`,
			}}
		>
			{frame.eyebrow ? <Eyebrow text={frame.eyebrow} palette={palette} /> : null}
			<div
				style={{
					color: INK,
					fontSize: 54,
					fontWeight: 680,
					letterSpacing: -1.6,
					lineHeight: 1.14,
				}}
			>
				{frame.headline}
			</div>
			{frame.subhead ? (
				<div style={{ color: MUTED, fontSize: 30, marginTop: 24, lineHeight: 1.44 }}>
					{frame.subhead}
				</div>
			) : null}
			{(frame.bullets ?? []).map((bullet, index) => (
				<div
					key={`${bullet}-${index}`}
					style={{ display: "flex", gap: 18, marginTop: 24, alignItems: "flex-start" }}
				>
					<div
						style={{
							width: 12,
							height: 12,
							borderRadius: 6,
							marginTop: 13,
							flexShrink: 0,
							backgroundColor: palette.base,
						}}
					/>
					<div style={{ color: INK, fontSize: 30, lineHeight: 1.4 }}>{bullet}</div>
				</div>
			))}
		</div>
	);
	return (
		<AbsoluteFill>
			<Backdrop palette={palette} />
			<AbsoluteFill
				style={{
					flexDirection: stacked ? "column" : "row",
					alignItems: "center",
					justifyContent: "center",
					gap: SPLIT_GAP,
					padding: stacked ? `${SPLIT_GAP}px ${SPLIT_PADDING_X}px` : `0 ${SPLIT_PADDING_X}px`,
				}}
			>
				{mediaFirst ? media : copy}
				{mediaFirst ? copy : media}
			</AbsoluteFill>
			{frame.caption ? <CaptionBar text={frame.caption} /> : null}
		</AbsoluteFill>
	);
};

/**
 * The recording itself. A missing or unapproved source renders a neutral
 * placeholder rather than failing the whole render.
 */
const Recording: React.FC<{
	frame: HyperFrame;
	screenSrc?: string;
	recording?: Size;
	durationInFrames: number;
	palette: FramePalette;
	canvas: Size;
	allowZoom: boolean;
}> = ({ frame, screenSrc, recording, durationInFrames, palette, canvas, allowZoom }) => {
	const frameNumber = useCurrentFrame();
	const { fps } = useVideoConfig();
	const focus = frame.focus;
	const mapped = focus
		? mapFocusToBox(focus, recordingBox(frame.kind, canvas), recording)
		: undefined;
	// With zoom off the recording plays at its true size; the mapped focus point
	// still exists for the callout ring, which is placement rather than zoom.
	const target = allowZoom ? (focus?.scale ?? 1) : 1;
	// Ease into the focus scale so a zoom reads as a deliberate move rather
	// than a cut. Frames without focus data hold a steady 1.0.
	const scale = interpolate(
		frameNumber,
		[0, Math.max(1, Math.min(durationInFrames, Math.round(fps * 1.1)))],
		[1, target],
		{
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
			easing: Easing.bezier(0.32, 0, 0.16, 1),
		},
	);
	const origin = mapped ? `${mapped.fx * 100}% ${mapped.fy * 100}%` : "50% 50%";

	if (!screenSrc) {
		return (
			<AbsoluteFill
				style={{
					backgroundColor: SURFACE,
					alignItems: "center",
					justifyContent: "center",
					color: MUTED,
					fontSize: 26,
					letterSpacing: 0.4,
				}}
			>
				<div
					style={{
						width: 74,
						height: 74,
						borderRadius: 20,
						marginBottom: 22,
						backgroundColor: palette.glow,
						border: `2px solid ${palette.base}`,
					}}
				/>
				Recording not attached
			</AbsoluteFill>
		);
	}

	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			<OffthreadVideo
				src={screenSrc}
				trimBefore={Math.max(0, Math.round((frame.sourceStartSeconds ?? 0) * fps))}
				muted
				style={{
					width: "100%",
					height: "100%",
					objectFit: "cover",
					transform: `scale(${scale})`,
					transformOrigin: origin,
				}}
			/>
		</AbsoluteFill>
	);
};

// ── Shared chrome ────────────────────────────────────────────────────────

const DeviceFrame: React.FC<{
	palette: FramePalette;
	children: React.ReactNode;
	allowZoom: boolean;
}> = ({ palette, children, allowZoom }) => {
	const rise = useRise();
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				borderRadius: 26,
				overflow: "hidden",
				backgroundColor: SURFACE,
				border: "1px solid rgba(148,163,184,0.18)",
				boxShadow: `0 42px 120px rgba(0,0,0,0.55), 0 0 0 1px ${palette.glow}`,
				transform: `scale(${entranceScale(rise, 0.985, allowZoom)})`,
				opacity: rise,
			}}
		>
			{children}
		</div>
	);
};

const Backdrop: React.FC<{ palette: FramePalette; intense?: boolean }> = ({ palette, intense }) => (
	<AbsoluteFill
		style={{
			background: `radial-gradient(120% 90% at 78% 8%, ${palette.glow} 0%, rgba(0,0,0,0) ${
				intense ? "62%" : "48%"
			}), linear-gradient(180deg, ${SURFACE} 0%, ${CANVAS} 68%)`,
		}}
	/>
);

const Eyebrow: React.FC<{ text: string; palette: FramePalette; centered?: boolean }> = ({
	text,
	palette,
	centered,
}) => (
	<div
		style={{
			color: palette.soft,
			fontSize: 24,
			fontWeight: 620,
			letterSpacing: 3.4,
			textTransform: "uppercase",
			marginBottom: 26,
			alignSelf: centered ? "center" : "flex-start",
		}}
	>
		{text}
	</div>
);

const LowerThird: React.FC<{ frame: HyperFrame; palette: FramePalette }> = ({ frame, palette }) => {
	const rise = useRise();
	return (
		<div
			style={{
				position: "absolute",
				left: 84,
				bottom: 132,
				maxWidth: 900,
				padding: "22px 34px",
				borderRadius: 18,
				backgroundColor: "rgba(11,15,20,0.82)",
				borderLeft: `6px solid ${palette.base}`,
				opacity: rise,
				transform: `translateX(${(1 - rise) * -26}px)`,
			}}
		>
			<div style={{ color: INK, fontSize: 38, fontWeight: 660, letterSpacing: -0.8 }}>
				{frame.headline}
			</div>
			{frame.subhead ? (
				<div style={{ color: MUTED, fontSize: 25, marginTop: 10, lineHeight: 1.4 }}>
					{frame.subhead}
				</div>
			) : null}
		</div>
	);
};

const CalloutLabel: React.FC<{ frame: HyperFrame; palette: FramePalette }> = ({
	frame,
	palette,
}) => {
	const rise = useRise();
	return (
		<div
			style={{
				position: "absolute",
				top: 128,
				right: 128,
				maxWidth: 620,
				padding: "24px 34px",
				borderRadius: 20,
				backgroundColor: "rgba(11,15,20,0.9)",
				border: `1px solid ${palette.base}`,
				opacity: rise,
				transform: `translateY(${(1 - rise) * -20}px)`,
			}}
		>
			<div style={{ color: palette.soft, fontSize: 34, fontWeight: 640, lineHeight: 1.24 }}>
				{frame.headline}
			</div>
			{frame.subhead ? (
				<div style={{ color: MUTED, fontSize: 24, marginTop: 12, lineHeight: 1.42 }}>
					{frame.subhead}
				</div>
			) : null}
		</div>
	);
};

const CaptionBar: React.FC<{ text: string }> = ({ text }) => (
	<div
		style={{
			position: "absolute",
			left: 0,
			right: 0,
			bottom: 54,
			display: "flex",
			justifyContent: "center",
			padding: "0 200px",
		}}
	>
		<div
			style={{
				padding: "16px 30px",
				borderRadius: 14,
				backgroundColor: "rgba(0,0,0,0.68)",
				color: INK,
				fontSize: 30,
				fontWeight: 520,
				lineHeight: 1.34,
				textAlign: "center",
			}}
		>
			{text}
		</div>
	</div>
);

// ── Motion helpers ───────────────────────────────────────────────────────

function useRise() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.7) });
}

/** Short cross-fade at both ends so consecutive frames never hard-cut. */
function useFrameFade(durationInFrames: number) {
	const frame = useCurrentFrame();
	const edge = Math.min(8, Math.max(2, Math.round(durationInFrames * 0.12)));
	return interpolate(
		frame,
		[0, edge, Math.max(edge + 1, durationInFrames - edge), durationInFrames],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
}

function usePulse() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return (Math.sin((frame / fps) * Math.PI * 1.6) + 1) / 2;
}
