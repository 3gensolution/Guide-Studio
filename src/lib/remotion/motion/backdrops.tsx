// ── Purpose-built backdrops ──────────────────────────────────────────────
//
// The adapted `helpers/scenes/` library is a demo reel: nearly every component
// paints its own title ("AURORA", "BOKEH", "OIL SPILL"), which is fine in a
// showcase and unusable behind a customer's copy. Only a handful survived the
// contact-sheet audit, so these four fill the gap.
//
// Each one is deliberately quiet — a backdrop competing with the headline is a
// worse backdrop — dark enough for white type, and a pure function of the
// frame so Remotion's parallel renderers agree on every frame.

import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";

/** Slow-moving colour masses. The safe default behind almost any copy. */
export const GradientDrift: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const t = frame / fps;

	const blobs = [
		{ hue: 244, x: 25 + Math.sin(t * 0.22) * 12, y: 32 + Math.cos(t * 0.17) * 10, size: 60 },
		{ hue: 268, x: 74 + Math.cos(t * 0.19) * 14, y: 66 + Math.sin(t * 0.23) * 12, size: 55 },
		{ hue: 210, x: 52 + Math.sin(t * 0.13 + 1.4) * 16, y: 78 + Math.cos(t * 0.15) * 9, size: 48 },
	];

	return (
		<AbsoluteFill style={{ backgroundColor: "#070A10", overflow: "hidden" }}>
			{blobs.map((blob) => (
				<div
					key={blob.hue}
					style={{
						position: "absolute",
						left: `${blob.x}%`,
						top: `${blob.y}%`,
						width: `${blob.size}%`,
						height: `${blob.size}%`,
						transform: "translate(-50%, -50%)",
						borderRadius: "50%",
						background: `radial-gradient(circle, hsla(${blob.hue}, 78%, 58%, 0.62) 0%, hsla(${blob.hue}, 72%, 40%, 0) 68%)`,
						filter: "blur(48px)",
					}}
				/>
			))}
		</AbsoluteFill>
	);
};

/** Fine particles drifting upward. Reads as depth without pulling focus. */
export const ParticleDrift: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps, height } = useVideoConfig();
	const count = 70;

	return (
		<AbsoluteFill style={{ backgroundColor: "#070A10", overflow: "hidden" }}>
			{Array.from({ length: count }).map((_, index) => {
				const seed = `particle-${index}`;
				const x = random(`${seed}-x`) * 100;
				const speed = 6 + random(`${seed}-s`) * 12;
				const size = 2 + random(`${seed}-r`) * 4;
				const drift = Math.sin(frame / fps + index) * 1.6;
				// Wrap with a modulo so the field never empties out.
				const progress = (random(`${seed}-o`) * 100 + (frame / fps) * speed) % 120;
				const y = 110 - progress;
				// interpolate() requires an ascending input range, so this reads
				// bottom-of-frame first: fade in on entry, hold, fade out at the top.
				const opacity = interpolate(y, [-5, 20, 85, 110], [0, 0.5, 0.5, 0], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				return (
					<div
						key={seed}
						style={{
							position: "absolute",
							left: `${x + drift}%`,
							top: `${y}%`,
							width: size,
							height: size,
							borderRadius: "50%",
							background: "#A5B4FC",
							opacity: opacity * 1.6,
							boxShadow: `0 0 ${size * 3}px rgba(165,180,252,0.6)`,
						}}
					/>
				);
			})}
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse at 50% ${height * 0.4}px, rgba(99,102,241,0.16) 0%, rgba(7,10,16,0) 60%)`,
				}}
			/>
		</AbsoluteFill>
	);
};

/** A technical grid with a highlight sweeping across it. */
export const SoftGrid: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const sweep = (((frame / fps) * 14) % 140) - 20;

	return (
		<AbsoluteFill style={{ backgroundColor: "#070A10", overflow: "hidden" }}>
			<AbsoluteFill
				style={{
					backgroundImage:
						"linear-gradient(rgba(148,163,184,0.20) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.20) 1px, transparent 1px)",
					backgroundSize: "72px 72px",
				}}
			/>
			<div
				style={{
					position: "absolute",
					top: 0,
					bottom: 0,
					left: `${sweep}%`,
					width: "26%",
					background:
						"linear-gradient(90deg, rgba(99,102,241,0) 0%, rgba(99,102,241,0.45) 50%, rgba(99,102,241,0) 100%)",
					filter: "blur(28px)",
				}}
			/>
		</AbsoluteFill>
	);
};

/** A single slow pulse of light. Good under a closing line. */
export const GlowPulse: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const pulse = (Math.sin((frame / fps) * 0.9) + 1) / 2;

	return (
		<AbsoluteFill style={{ backgroundColor: "#070A10", overflow: "hidden" }}>
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: "52%",
					width: `${74 + pulse * 12}%`,
					height: `${74 + pulse * 12}%`,
					transform: "translate(-50%, -50%)",
					borderRadius: "50%",
					background:
						"radial-gradient(circle, rgba(129,140,248,0.46) 0%, rgba(76,29,149,0.24) 45%, rgba(7,10,16,0) 70%)",
					filter: "blur(40px)",
				}}
			/>
		</AbsoluteFill>
	);
};
