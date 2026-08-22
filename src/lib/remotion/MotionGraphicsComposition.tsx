// ── Motion graphics composition ──────────────────────────────────────────
//
// The animated counterpart to HyperFrame. Where HyperFrame lays out clean
// document-style cards, this composes the existing animated component library
// in `helpers/scenes/`: real particle, liquid, shape and typography motion.
//
// A scene is one of two shapes, and the distinction is forced by how those
// components are written — each paints its own opaque full-frame background
// and none accepts children, so they cannot be layered arbitrarily:
//
//   kind "text"  — an animated typography component renders the copy itself.
//   kind "card"  — an animated backdrop runs full-frame with our own
//                  typography drawn over it.
//
// Everything is a pure function of the frame, so Remotion's parallel renderers
// agree on every frame. The planner supplies ids and copy; no code from the
// model is compiled or executed here.

import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { findBackdrop, findTextScene } from "./motion/catalog";

export type MotionAccent = "indigo" | "emerald" | "amber" | "rose" | "violet";

const ACCENTS: Record<MotionAccent, string> = {
	indigo: "#818CF8",
	emerald: "#34D399",
	amber: "#FBBF24",
	rose: "#FB7185",
	violet: "#C4B5FD",
};

export interface MotionScene {
	id: string;
	kind: "text" | "card";
	durationSeconds: number;
	/** kind "text": which typography animation, and the words it animates. */
	textScene?: string;
	text?: string;
	/** kind "card": the animated backdrop behind the copy. */
	backdrop?: string;
	eyebrow?: string;
	headline?: string;
	subhead?: string;
	bullets?: string[];
}

export interface MotionCompositionProps {
	title: string;
	accent: MotionAccent;
	scenes: MotionScene[];
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
const CardCopy: React.FC<{ scene: MotionScene; accent: string; scale: number }> = ({
	scene,
	accent,
	scale,
}) => {
	const px = (value: number) => Math.round(value * scale);
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
						color: "#F8FAFC",
						fontSize: px(96),
						fontWeight: 800,
						lineHeight: 1.05,
						letterSpacing: px(-2),
						textShadow: "0 4px 40px rgba(0,0,0,0.55)",
					}}
				>
					{scene.headline}
				</div>
			)}
			{scene.subhead && (
				<div
					style={{
						color: "#CBD5E1",
						fontSize: px(40),
						fontWeight: 400,
						lineHeight: 1.4,
						marginTop: px(28),
						maxWidth: px(1300),
						textShadow: "0 2px 24px rgba(0,0,0,0.6)",
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
									color: "#E2E8F0",
									fontSize: px(38),
									fontWeight: 500,
									textShadow: "0 2px 20px rgba(0,0,0,0.6)",
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
const Scrim: React.FC = () => (
	<AbsoluteFill
		style={{
			background:
				"linear-gradient(90deg, rgba(6,9,14,0.58) 0%, rgba(6,9,14,0.34) 48%, rgba(6,9,14,0.06) 100%)",
		}}
	/>
);

const MotionSceneView: React.FC<{ scene: MotionScene; accent: string; scale: number }> = ({
	scene,
	accent,
	scale,
}) => {
	if (scene.kind === "text") {
		const entry = findTextScene(scene.textScene);
		if (entry) {
			const Component = entry.component;
			return <Component text={scene.text ?? scene.headline ?? ""} />;
		}
		// An unknown id must not blank the video — fall through to a card.
	}

	const backdrop = findBackdrop(scene.backdrop);
	const Backdrop = backdrop?.component;
	return (
		<AbsoluteFill style={{ backgroundColor: "#06090E" }}>
			{Backdrop ? <Backdrop /> : null}
			<Scrim />
			<CardCopy scene={scene} accent={accent} scale={scale} />
		</AbsoluteFill>
	);
};

export const MotionGraphicsComposition: React.FC<MotionCompositionProps> = ({ accent, scenes }) => {
	const { fps, width } = useVideoConfig();
	const scale = width / 1920;
	const accentHex = ACCENTS[accent] ?? ACCENTS.indigo;

	let cursor = 0;
	const placed = scenes.map((scene) => {
		const durationInFrames = Math.max(1, Math.round(Math.max(0.5, scene.durationSeconds) * fps));
		const from = cursor;
		cursor += durationInFrames;
		return { scene, from, durationInFrames };
	});

	return (
		<AbsoluteFill style={{ backgroundColor: "#06090E" }}>
			{placed.map(({ scene, from, durationInFrames }, index) => (
				<Sequence
					key={scene.id || `scene-${index}`}
					from={from}
					durationInFrames={durationInFrames}
					layout="none"
				>
					<MotionSceneView scene={scene} accent={accentHex} scale={scale} />
				</Sequence>
			))}
		</AbsoluteFill>
	);
};
