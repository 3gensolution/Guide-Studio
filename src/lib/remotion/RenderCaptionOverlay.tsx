import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export interface RenderCaptionLine {
	text: string;
	startMs: number;
	endMs: number;
}

/**
 * A deliberately restrained caption treatment for social delivery. Captions
 * are rendered by Remotion so they remain crisp, safe, and deterministic in
 * the final MP4 rather than depending on a player-specific subtitle track.
 */
export const RenderCaptionOverlay: React.FC<{
	lines?: RenderCaptionLine[];
}> = ({ lines = [] }) => {
	const frame = useCurrentFrame();
	const { fps, height } = useVideoConfig();
	if (lines.length === 0 || fps <= 0) return null;

	const timeMs = (frame / fps) * 1000;
	const active = lines.find((line) => timeMs >= line.startMs && timeMs < line.endMs);
	if (!active?.text.trim()) return null;

	return (
		<div
			style={{
				position: "absolute",
				left: "7%",
				right: "7%",
				bottom: height >= 1500 ? "3.5%" : "3%",
				display: "flex",
				justifyContent: "flex-start",
				pointerEvents: "none",
				zIndex: 100,
			}}
		>
			<div
				style={{
					maxWidth: "68%",
					maxHeight: height >= 1500 ? 92 : 72,
					overflow: "hidden",
					padding: 0,
					borderRadius: 0,
					backgroundColor: "transparent",
					border: "none",
					color: "#FFFFFF",
					fontFamily: 'Inter, -apple-system, "Segoe UI", sans-serif',
					fontSize: height >= 1500 ? 28 : 24,
					fontWeight: 600,
					lineHeight: 1.25,
					letterSpacing: -0.2,
					textAlign: "left",
					display: "-webkit-box",
					WebkitBoxOrient: "vertical",
					WebkitLineClamp: 2,
					textShadow: "0 1px 8px rgba(0,0,0,.35)",
				}}
			>
				{active.text}
			</div>
		</div>
	);
};
