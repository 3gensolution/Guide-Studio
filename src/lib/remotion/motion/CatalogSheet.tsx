// ── Catalog contact sheet ────────────────────────────────────────────────
//
// An internal audit surface, not a user-facing composition. It tiles catalog
// entries into one frame so a single still shows how a whole family renders.
//
// It exists because the components in `helpers/scenes/` were adapted from a
// demo reel: several paint hard-coded words, which is fine in a demo and fatal
// in a customer's video. Reading the source is not a reliable way to tell —
// rendering them is. Anything that turns out to carry text gets dropped from
// `catalog.ts` rather than shipped.

import React from "react";
import { AbsoluteFill } from "remotion";
import { BACKDROPS, TEXT_SCENES } from "./catalog";

export interface CatalogSheetProps {
	/** Which slice of the list this sheet shows. */
	offset: number;
	count: number;
	columns: number;
	/** Which half of the catalog to audit. */
	family?: "backdrops" | "text";
	/** Copy handed to every typography entry, to prove it animates real words. */
	sampleText?: string;
}

export const CatalogSheet: React.FC<CatalogSheetProps> = ({
	offset = 0,
	count = 9,
	columns = 3,
	family = "backdrops",
	sampleText = "Ship it faster",
}) => {
	const source =
		family === "text"
			? TEXT_SCENES.map((entry) => ({
					id: entry.id,
					component: entry.component as React.FC<{ text?: string }>,
				}))
			: BACKDROPS.map((entry) => ({
					id: entry.id,
					component: entry.component as React.FC<{ text?: string }>,
				}));
	const entries = source.slice(offset, offset + count);
	const rows = Math.ceil(entries.length / columns);

	return (
		<AbsoluteFill style={{ backgroundColor: "#000", display: "flex", flexDirection: "column" }}>
			{Array.from({ length: rows }).map((_, rowIndex) => (
				<div key={`row-${rowIndex + offset}`} style={{ display: "flex", flex: 1, minHeight: 0 }}>
					{entries.slice(rowIndex * columns, rowIndex * columns + columns).map((entry) => {
						const Component = entry.component;
						return (
							<div
								key={entry.id}
								style={{
									flex: 1,
									position: "relative",
									overflow: "hidden",
									border: "2px solid #1e293b",
								}}
							>
								{/* Each component is an AbsoluteFill sized to the frame, so it is
								    scaled down into the tile rather than cropped to it. */}
								<div
									style={{
										position: "absolute",
										width: `${100 * columns}%`,
										height: `${100 * rows}%`,
										transform: `scale(${1 / columns}, ${1 / rows})`,
										transformOrigin: "top left",
									}}
								>
									<Component {...(family === "text" ? { text: sampleText } : {})} />
								</div>
								<div
									style={{
										position: "absolute",
										left: 0,
										bottom: 0,
										padding: "6px 12px",
										background: "rgba(0,0,0,0.75)",
										color: "#fff",
										fontFamily: "monospace",
										fontSize: 22,
									}}
								>
									{entry.id}
								</div>
							</div>
						);
					})}
				</div>
			))}
		</AbsoluteFill>
	);
};
