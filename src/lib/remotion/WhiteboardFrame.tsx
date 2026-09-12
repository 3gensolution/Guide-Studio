import { measureText } from "@remotion/layout-utils";
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { DOODLE_GRID, type Doodle, type DoodleStroke, getDoodle } from "./whiteboardDoodles";
import { pointAt, type SampledPath, samplePath } from "./whiteboardPath";

// ── Whiteboard frame ─────────────────────────────────────────────────────
//
// The "scribe" look: copy appears as though a hand were writing it, the pen
// leading the reveal, and a picture is drawn beside it stroke by stroke.
// Everything here is derived from the frame number, so a render is
// deterministic and a frame can be drawn in isolation — Remotion renders frames
// out of order and in parallel, so no part of this may depend on having drawn
// the previous one.
//
// The reveal of the *text* is a clip rectangle that widens across each line. It
// is not a stroke-dashoffset animation, because that requires glyph outlines as
// paths: tracing an outline reads as *outlining* a letter, not writing it, and
// getting true single-stroke handwriting needs a hairline font this app has no
// licence to ship. A left-to-right wipe with the pen tip pinned to its leading
// edge is what the commercial scribe tools do, and it reads correctly at speed.
//
// The *artwork* is the opposite case, and so uses the opposite technique: a
// doodle is already line art, so advancing a dash along its stroke is literally
// the line being drawn, and that is exactly what a marker does.

/**
 * Measurement and rendering must use the *same* family string or the pen drifts
 * away from the ink. Handwriting faces differ per platform — Bradley Hand on
 * macOS, Segoe Script on Windows — so rather than pick one and bundle it, both
 * sides read this stack and `measureText` reports whatever the renderer will
 * actually draw with. The pen tracks the text on any machine; only the
 * handwriting style differs.
 */
export const WHITEBOARD_FONT =
	'"Bradley Hand", "Segoe Script", "Brush Script MT", "Comic Sans MS", "Chalkboard SE", cursive, sans-serif';

/** Paper, not the studio's dark canvas: a whiteboard scene is white by definition. */
const PAPER = "#FAFAF7";
const PAPER_EDGE = "#ECECE4";
const PEN_INK = "#1F2933";

const HEADLINE_SIZE = 82;
const BODY_SIZE = 46;
const LINE_GAP = 30;
const MARGIN_X = 190;
/** A narrower margin when a picture shares the board, to buy the copy width. */
const DOODLE_MARGIN_X = 120;
/** Space between the copy and the picture. */
const DOODLE_GAP = 80;
/** How thick the marker draws artwork, in design pixels. */
const DOODLE_STROKE = 5.5;

/** Seconds of pen travel between one line and the next, where nothing is drawn. */
const LIFT_SECONDS = 0.16;

/**
 * The most of a frame's time the picture may take. Artwork has far more line in
 * it than a sentence does — a single circle is longer than a whole headline —
 * so left purely proportional the hand would spend the frame drawing and cut
 * away mid-word. The copy is the point of the frame; the picture supports it.
 */
const DOODLE_TIME_SHARE = 0.55;

export interface WhiteboardLine {
	text: string;
	size: number;
	weight: number;
	/** Bulleted lines get a drawn dot and a deeper indent. */
	bulleted: boolean;
}

/**
 * How wide a run of text will be drawn. Injectable so the layout and timing
 * maths can be tested without a font: the real measurer needs a laid-out DOM
 * and reports zero under jsdom, which would make every line look empty.
 */
export type MeasureText = (text: string, size: number, weight: number) => number;

/**
 * Greedy word wrap against real measured widths. Done here rather than with CSS
 * because the pen has to know where each line ends, and only an explicit line
 * list gives us that.
 */
export function wrapLine(
	text: string,
	size: number,
	weight: number,
	maxWidth: number,
	measure: MeasureText = widthOf,
): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (current && measure(candidate, size, weight) > maxWidth) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines;
}

function widthOf(text: string, size: number, weight: number) {
	if (!text) return 0;
	return measureText({
		text,
		fontFamily: WHITEBOARD_FONT,
		fontSize: size,
		fontWeight: String(weight),
	}).width;
}

/**
 * Splits the frame's copy into the lines the pen will write, in order.
 * Exported for the tests, which assert the wrap without rendering.
 */
export function buildWhiteboardLines(
	headline: string | undefined,
	bullets: string[] | undefined,
	maxWidth: number,
	measure: MeasureText = widthOf,
): WhiteboardLine[] {
	const lines: WhiteboardLine[] = [];
	for (const text of wrapLine(headline ?? "", HEADLINE_SIZE, 700, maxWidth, measure)) {
		lines.push({ text, size: HEADLINE_SIZE, weight: 700, bulleted: false });
	}
	for (const bullet of bullets ?? []) {
		// Only the first visual line of a wrapped bullet carries the dot.
		const wrapped = wrapLine(bullet, BODY_SIZE, 500, maxWidth - 70, measure);
		wrapped.forEach((text, index) => {
			lines.push({ text, size: BODY_SIZE, weight: 500, bulleted: index === 0 });
		});
	}
	return lines;
}

export interface Timed extends WhiteboardLine {
	width: number;
	/** Top of this line's box in design pixels. */
	y: number;
	/** Left edge, deeper for a bullet so the dot sits in the margin. */
	x: number;
	startFrame: number;
	endFrame: number;
}

/** One stroke of the picture, with the slice of the frame it is drawn in. */
export interface TimedStroke {
	/** Index into the doodle's own stroke list. */
	index: number;
	startFrame: number;
	endFrame: number;
}

export interface BoardSchedule {
	lines: Timed[];
	strokes: TimedStroke[];
}

/**
 * Lays the board out in time: every line of copy and every stroke of the
 * picture gets a slice of the frame in proportion to how much line it is, so
 * the pen moves at one constant speed for the whole frame. Splitting the time
 * evenly per segment instead would make the pen race across long lines and
 * crawl across short ones.
 *
 * `strokeLengths` is measured in the same design pixels as the text widths —
 * the caller scales the doodle grid to the screen before asking — which is what
 * lets one speed cover both writing and drawing.
 */
export function scheduleBoard(
	lines: WhiteboardLine[],
	strokeLengths: number[],
	durationInFrames: number,
	fps: number,
	indent: number,
	measure: MeasureText = widthOf,
): BoardSchedule {
	const measured = lines.map((line) => ({
		...line,
		width: measure(line.text, line.size, line.weight),
	}));
	const textCost = measured.reduce((sum, line) => sum + line.width, 0);

	// Hold the picture to its share of the frame by slowing the clock for it,
	// not by dropping strokes: a half-drawn cat is worse than a quick one.
	const rawDoodle = strokeLengths.reduce((sum, length) => sum + length, 0);
	const ceiling = (DOODLE_TIME_SHARE / (1 - DOODLE_TIME_SHARE)) * textCost;
	const squeeze = textCost > 0 && rawDoodle > ceiling ? ceiling / rawDoodle : 1;
	const strokeCosts = strokeLengths.map((length) => length * squeeze);

	const totalCost = textCost + strokeCosts.reduce((sum, cost) => sum + cost, 0);
	const segments = measured.length + strokeCosts.length;

	// Writing stops a little before the frame ends so the finished board is
	// readable rather than cutting the instant the last letter lands.
	const settle = Math.round(fps * 0.55);
	const lift = Math.round(fps * LIFT_SECONDS);
	const writable = Math.max(1, durationInFrames - settle - lift * Math.max(0, segments - 1));

	let cursorFrame = 0;
	let cursorY = 0;
	const share = (cost: number) => (totalCost > 0 ? cost / totalCost : 1 / Math.max(1, segments));
	const slice = (cost: number) => {
		const span = Math.max(1, Math.round(writable * share(cost)));
		const startFrame = cursorFrame;
		cursorFrame += span + lift;
		return { startFrame, endFrame: startFrame + span };
	};

	const timedLines = measured.map((line) => {
		const { startFrame, endFrame } = slice(line.width);
		const timed: Timed = {
			...line,
			y: cursorY,
			x: line.bulleted || line.size === BODY_SIZE ? indent : 0,
			startFrame,
			endFrame,
		};
		cursorY += line.size * 1.32 + LINE_GAP;
		return timed;
	});

	const timedStrokes = strokeCosts.map((cost, index) => ({ index, ...slice(cost) }));

	return { lines: timedLines, strokes: timedStrokes };
}

/**
 * The text-only schedule. Kept as its own name because most frames have no
 * picture and reading `scheduleBoard(lines, [], …).lines` at every call site
 * would be noise.
 */
export function schedule(
	lines: WhiteboardLine[],
	durationInFrames: number,
	fps: number,
	indent: number,
	measure: MeasureText = widthOf,
): Timed[] {
	return scheduleBoard(lines, [], durationInFrames, fps, indent, measure).lines;
}

export interface BoardColumns {
	/** True when the picture goes under the copy rather than beside it. */
	stacked: boolean;
	marginX: number;
	textWidth: number;
	/** Side of the square the picture is drawn in; zero when there is none. */
	doodleSize: number;
}

/**
 * Splits the board between copy and picture. A portrait or square frame has no
 * room for two columns, so the picture goes underneath instead of beside —
 * otherwise a 9:16 headline would wrap to one word per line.
 */
export function boardColumns(
	canvasWidth: number,
	canvasHeight: number,
	hasDoodle: boolean,
): BoardColumns {
	if (!hasDoodle) {
		return {
			stacked: false,
			marginX: MARGIN_X,
			textWidth: canvasWidth - MARGIN_X * 2,
			doodleSize: 0,
		};
	}
	if (canvasHeight >= canvasWidth) {
		const marginX = 150;
		const textWidth = canvasWidth - marginX * 2;
		return {
			stacked: true,
			marginX,
			textWidth,
			doodleSize: Math.min(textWidth * 0.6, canvasHeight * 0.28),
		};
	}
	const marginX = DOODLE_MARGIN_X;
	const doodleSize = Math.min(canvasWidth * 0.28, canvasHeight * 0.52);
	return {
		stacked: false,
		marginX,
		doodleSize,
		textWidth: Math.max(240, canvasWidth - marginX * 2 - doodleSize - DOODLE_GAP),
	};
}

/**
 * A hand holding a marker, drawn with the pen tip at the local origin so the
 * caller positions it by the tip and never has to know the sprite's shape.
 * Inline rather than an image file: it must render identically in headless
 * Chrome with no asset resolution and no network.
 */
const SKIN = "#EDBE9B";
const SKIN_LIT = "#F6D3B6";
const SKIN_SHADE = "#D9A582";

/**
 * The whole sprite is drawn upright — barrel straight up from a nib at the
 * origin, hand to its right — and then rotated about that origin. Composing it
 * that way means every coordinate below is readable, and the writing angle is
 * one number rather than a rewrite of forty bezier control points.
 */
const PEN_ANGLE = 34;

const PenHand: React.FC<{ accent: string }> = ({ accent }) => (
	<svg
		width={520}
		height={470}
		// The origin of this viewBox is the nib, so `left`/`top` below shift the
		// box to hang off that point rather than off its own corner.
		viewBox="-190 -300 520 470"
		style={{ position: "absolute", left: -190, top: -300, pointerEvents: "none" }}
		aria-hidden
	>
		<g transform={`rotate(${PEN_ANGLE})`}>
			{/* Soft contact shadow, so the nib sits on the board instead of floating. */}
			<ellipse cx={0} cy={6} rx={26} ry={7} fill="rgba(15,23,42,0.16)" />

			{/* Marker: barrel, grip band, tapered cone, nib. */}
			<rect x={-15} y={-236} width={30} height={188} rx={11} fill={accent} />
			<rect x={-15} y={-236} width={11} height={188} rx={6} fill="rgba(255,255,255,0.30)" />
			<rect x={9} y={-236} width={6} height={188} rx={3} fill="rgba(15,23,42,0.16)" />
			<rect x={-18} y={-64} width={36} height={22} rx={6} fill="#2E3A45" />
			<path d="M-15 -42 L15 -42 L6 -8 L-6 -8 Z" fill="#3D4A57" />
			<path d="M-6 -8 L6 -8 L0 3 Z" fill={PEN_INK} />

			{/*
			  Hand, drawn back-to-front: palm, then the fingers that wrap the barrel.
			  Offset down and across the barrel so that, once rotated, the fist sits
			  below and to the right of the nib. Centred on the grip it reads as a
			  hand written *over* the line above, hiding the words just drawn.
			*/}
			<g transform="translate(74 34)">
				<path
					d="M14 -150 C74 -166 132 -132 150 -74 C170 -10 156 66 118 112 C86 150 36 158 8 132 C-16 110 -14 62 -6 20 C2 -22 -6 -104 14 -150 Z"
					fill={SKIN}
				/>
				<path
					d="M18 -146 C70 -158 120 -128 138 -78 C110 -96 66 -98 34 -82 C16 -74 8 -112 18 -146 Z"
					fill={SKIN_LIT}
				/>
				{/* Index finger lying along the barrel, and the thumb crossing beneath it. */}
				<path
					d="M6 -172 C34 -182 56 -170 58 -146 C60 -120 44 -104 22 -102 C2 -100 -8 -114 -6 -138 C-5 -154 -4 -166 6 -172 Z"
					fill={SKIN_LIT}
				/>
				<path
					d="M-2 -96 C26 -104 52 -92 58 -68 C64 -44 50 -22 26 -18 C6 -14 -8 -30 -8 -56 C-8 -74 -8 -90 -2 -96 Z"
					fill={SKIN}
				/>
				<path
					d="M10 -104 C34 -110 54 -100 58 -80 C40 -92 18 -94 2 -88 Z"
					fill={SKIN_SHADE}
					opacity={0.55}
				/>
				{/* Wrist and cuff, running out of frame so the hand reads as attached. */}
				<path
					d="M52 -34 C86 -40 116 -26 128 -2"
					stroke={SKIN_SHADE}
					strokeWidth={5}
					strokeLinecap="round"
					fill="none"
					opacity={0.6}
				/>
				<path
					d="M50 16 C84 10 114 22 128 44"
					stroke={SKIN_SHADE}
					strokeWidth={5}
					strokeLinecap="round"
					fill="none"
					opacity={0.5}
				/>
				<path d="M40 96 C86 88 122 104 138 140 L150 180 L34 180 Z" fill={SKIN} />
				<path d="M28 168 L156 168 L168 240 L18 240 Z" fill="#4C566A" />
				<path d="M28 168 L156 168 L160 186 L26 186 Z" fill="#5B6883" />
			</g>
		</g>
	</svg>
);

/**
 * The picture, drawn as far as the frame has got. Each stroke is dashed with a
 * single dash the length of the whole path, and the dash is slid into view —
 * `pathLength={1}` normalises every path to one unit so the offset is simply
 * the remaining fraction, with no measurement of the rendered geometry.
 */
const DoodleArt: React.FC<{
	doodle: Doodle;
	strokes: TimedStroke[];
	frame: number;
	size: number;
	accent: string;
}> = ({ doodle, strokes, frame, size, accent }) => {
	const scale = size / DOODLE_GRID;
	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${DOODLE_GRID} ${DOODLE_GRID}`}
			style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
			aria-hidden
		>
			{strokes.map((timed) => {
				const stroke = doodle.strokes[timed.index] as DoodleStroke;
				const progress = interpolate(frame, [timed.startFrame, timed.endFrame], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				if (progress <= 0) return null;
				const colour = stroke.accent ? accent : PEN_INK;
				// A wash of colour floods in behind a closed shape once its outline
				// is closed, the way a marker is used to block something in.
				const wash = stroke.fill
					? interpolate(progress, [0.82, 1], [0, 0.16], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						})
					: 0;
				return (
					<React.Fragment key={timed.index}>
						{wash > 0 ? <path d={stroke.d} fill={colour} opacity={wash} /> : null}
						<path
							d={stroke.d}
							fill="none"
							stroke={colour}
							strokeWidth={(DOODLE_STROKE * (stroke.weight ?? 1)) / scale}
							strokeLinecap="round"
							strokeLinejoin="round"
							pathLength={1}
							strokeDasharray="1 1"
							strokeDashoffset={1 - progress}
						/>
					</React.Fragment>
				);
			})}
		</svg>
	);
};

export interface WhiteboardFrameProps {
	headline?: string;
	bullets?: string[];
	eyebrow?: string;
	caption?: string;
	/** Id from the doodle catalog; an unknown one simply draws no picture. */
	doodle?: string;
	accent: string;
	durationInFrames: number;
	/** The 1920-wide design canvas, so the frame scales with every aspect ratio. */
	canvasWidth: number;
	canvasHeight: number;
}

export const WhiteboardFrame: React.FC<WhiteboardFrameProps> = ({
	headline,
	bullets,
	eyebrow,
	caption,
	doodle: doodleId,
	accent,
	durationInFrames,
	canvasWidth,
	canvasHeight,
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const doodle = React.useMemo(() => getDoodle(doodleId), [doodleId]);
	const columns = React.useMemo(
		() => boardColumns(canvasWidth, canvasHeight, Boolean(doodle)),
		[canvasWidth, canvasHeight, doodle],
	);

	// The picture is flattened once per frame's worth of props, not per frame:
	// the pen needs a point along a stroke, which means the polyline behind it.
	const paths = React.useMemo<SampledPath[]>(
		() => (doodle ? doodle.strokes.map((stroke) => samplePath(stroke.d)) : []),
		[doodle],
	);
	const doodleScale = columns.doodleSize / DOODLE_GRID;

	const lines = React.useMemo(
		() => buildWhiteboardLines(headline, bullets, columns.textWidth),
		[headline, bullets, columns.textWidth],
	);
	const board = React.useMemo(
		() =>
			scheduleBoard(
				lines,
				paths.map((path) => path.length * doodleScale),
				durationInFrames,
				fps,
				70,
			),
		[lines, paths, doodleScale, durationInFrames, fps],
	);
	const timed = board.lines;

	const blockHeight = timed.length
		? (timed[timed.length - 1]?.y ?? 0) + (timed[timed.length - 1]?.size ?? 0) * 1.32
		: 0;
	const stackedHeight = columns.stacked
		? blockHeight + (doodle ? DOODLE_GAP + columns.doodleSize : 0)
		: blockHeight;
	const originY = Math.max(140, (canvasHeight - stackedHeight) / 2);
	const doodleX = columns.stacked
		? (canvasWidth - columns.doodleSize) / 2
		: canvasWidth - columns.marginX - columns.doodleSize;
	const doodleY = columns.stacked
		? originY + blockHeight + DOODLE_GAP
		: Math.max(140, (canvasHeight - columns.doodleSize) / 2);

	// Where the pen is right now: the leading edge of whatever is being drawn —
	// a half-written line or a half-drawn stroke — or resting at the end of the
	// last thing it finished. Copy is written first, then the picture, so the
	// stroke schedule is searched only once the words are done.
	const activeLine = timed.find((line) => frame >= line.startFrame && frame < line.endFrame);
	const activeStroke = board.strokes.find(
		(stroke) => frame >= stroke.startFrame && frame < stroke.endFrame,
	);
	const finishedLines = timed.filter((line) => frame >= line.endFrame);
	const finishedStrokes = board.strokes.filter((stroke) => frame >= stroke.endFrame);

	const progressOf = (span: { startFrame: number; endFrame: number } | undefined) =>
		span
			? interpolate(frame, [span.startFrame, span.endFrame], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				})
			: 1;

	// A small bob keeps the hand from looking like it is on rails. It is tied to
	// the frame number, not to time elapsed, so it too survives out-of-order
	// rendering.
	const drawing = Boolean(activeLine ?? activeStroke);
	const bob = drawing ? Math.sin(frame * 0.85) * 3.5 : 0;

	let pen: { x: number; y: number } | null = null;
	const strokeUnderPen = activeStroke ?? finishedStrokes[finishedStrokes.length - 1];
	const lineUnderPen = activeLine ?? finishedLines[finishedLines.length - 1];
	if (!activeLine && strokeUnderPen) {
		const path = paths[strokeUnderPen.index];
		if (path) {
			const point = pointAt(path, progressOf(activeStroke));
			pen = {
				x: doodleX + point.x * doodleScale,
				y: doodleY + point.y * doodleScale + bob,
			};
		}
	}
	if (!pen && lineUnderPen) {
		const progress = progressOf(activeLine);
		pen = {
			x: columns.marginX + lineUnderPen.x + lineUnderPen.width * progress,
			y: originY + lineUnderPen.y + lineUnderPen.size * 0.92 + bob,
		};
	}

	// The pen leaves once the drawing is done, so the finished board is clean.
	const handFade = interpolate(
		frame,
		[durationInFrames - Math.round(fps * 0.45), durationInFrames - Math.round(fps * 0.15)],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	return (
		<AbsoluteFill style={{ backgroundColor: PAPER, fontFamily: WHITEBOARD_FONT }}>
			{/* Faint vignette so a pure-white field does not bloom on a bright display. */}
			<AbsoluteFill
				style={{
					background: `radial-gradient(circle at 50% 42%, transparent 55%, ${PAPER_EDGE} 100%)`,
				}}
			/>

			{eyebrow ? (
				<div
					style={{
						position: "absolute",
						left: columns.marginX,
						top: Math.max(70, originY - 120),
						color: accent,
						fontSize: 30,
						fontWeight: 700,
						letterSpacing: 3,
						textTransform: "uppercase",
						opacity: interpolate(frame, [0, Math.round(fps * 0.4)], [0, 1], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						}),
					}}
				>
					{eyebrow}
				</div>
			) : null}

			{timed.map((line, index) => {
				const progress = progressOf(line);
				if (frame < line.startFrame) return null;
				return (
					<React.Fragment key={`${line.text}-${index}`}>
						{/*
						  The dot is a sibling of the clipped text, not a child of it: the
						  wipe's own left inset is a percentage of the line's width, which
						  is nowhere near far enough left to include a marker sitting out
						  in the margin, so a nested dot is simply clipped away.
						*/}
						{line.bulleted ? (
							<div
								style={{
									position: "absolute",
									left: columns.marginX + line.x - 52,
									top: originY + line.y + line.size * 0.46,
									width: 18,
									height: 18,
									borderRadius: 9,
									backgroundColor: accent,
									// Drawn with a dab at the start of the line rather than
									// wiped, because a pen makes a dot in one motion.
									transform: `scale(${Math.min(1, progress * 12)})`,
								}}
							/>
						) : null}
						<div
							style={{
								position: "absolute",
								left: columns.marginX + line.x,
								top: originY + line.y,
								width: line.width + 8,
								whiteSpace: "pre",
								color: PEN_INK,
								fontSize: line.size,
								fontWeight: line.weight,
								lineHeight: 1.32,
								// The wipe. `inset` from the right shrinks to zero as the pen
								// crosses the line, so ink only ever exists behind the nib.
								clipPath: `inset(-14% ${(1 - progress) * 100}% -14% -2%)`,
							}}
						>
							{line.text}
						</div>
					</React.Fragment>
				);
			})}

			{doodle ? (
				<div style={{ position: "absolute", left: doodleX, top: doodleY }}>
					<DoodleArt
						doodle={doodle}
						strokes={board.strokes}
						frame={frame}
						size={columns.doodleSize}
						accent={accent}
					/>
				</div>
			) : null}

			{caption ? (
				<div
					style={{
						position: "absolute",
						left: columns.marginX,
						bottom: 96,
						color: "#6B7280",
						fontSize: 28,
						opacity: interpolate(
							frame,
							[durationInFrames - Math.round(fps * 0.9), durationInFrames - Math.round(fps * 0.5)],
							[0, 1],
							{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
						),
					}}
				>
					{caption}
				</div>
			) : null}

			{pen && handFade > 0 ? (
				<div
					style={{
						position: "absolute",
						left: pen.x,
						top: pen.y,
						opacity: handFade,
						transformOrigin: "0 0",
					}}
				>
					<PenHand accent={accent} />
				</div>
			) : null}
		</AbsoluteFill>
	);
};
