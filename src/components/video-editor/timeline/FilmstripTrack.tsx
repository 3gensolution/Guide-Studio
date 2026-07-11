/**
 * FilmstripTrack — CapCut-style band of video frames across the main track.
 * Renders from a pre-extracted frame pool, so zooming/panning the timeline
 * just re-tiles cached images (no decoding on the hot path). The band is
 * pointer-transparent: clicks fall through to the timeline's scrub/seek.
 */
import {
	type Filmstrip,
	pickFilmstripTiles,
	useFilmstripThumbnails,
} from "@/hooks/useFilmstripThumbnails";

/** CSS height of the filmstrip band */
const BAND_HEIGHT = 36;

interface FilmstripTrackProps {
	videoUrl?: string;
	/** Main-video span in timeline coordinates (after intro offset) */
	spanStartMs: number;
	spanEndMs: number;
	/** Timeline range → pixel mapping from the parent editor */
	rangeStartMs: number;
	valueToPixels: (value: number) => number;
}

function Tiles({
	filmstrip,
	durationMs,
	widthPx,
}: {
	filmstrip: Filmstrip;
	/** Video-local duration — frame timestamps are relative to video start */
	durationMs: number;
	widthPx: number;
}) {
	const tileWidth = Math.max(1, Math.round(BAND_HEIGHT * filmstrip.aspect));
	const tiles = pickFilmstripTiles(filmstrip, 0, durationMs, widthPx, tileWidth);

	return (
		<>
			{tiles.map((frame, i) => (
				<img
					key={`${i}-${frame.timeMs}`}
					src={frame.dataUrl}
					alt=""
					draggable={false}
					className="h-full flex-shrink-0 object-cover"
					style={{ width: tileWidth }}
				/>
			))}
		</>
	);
}

export default function FilmstripTrack({
	videoUrl,
	spanStartMs,
	spanEndMs,
	rangeStartMs,
	valueToPixels,
}: FilmstripTrackProps) {
	const filmstrip = useFilmstripThumbnails(videoUrl, spanEndMs - spanStartMs);

	if (!videoUrl || spanEndMs <= spanStartMs) return null;

	const startPx = valueToPixels(spanStartMs - rangeStartMs);
	const endPx = valueToPixels(spanEndMs - rangeStartMs);
	const widthPx = endPx - startPx;
	if (widthPx <= 0) return null;

	return (
		<div
			className="relative my-0.5 pointer-events-none"
			style={{ height: BAND_HEIGHT }}
			aria-hidden
		>
			<div
				className="absolute top-0 h-full rounded-md overflow-hidden flex bg-[#16181d] border border-white/10"
				style={{ left: startPx, width: widthPx }}
			>
				{filmstrip ? (
					<Tiles filmstrip={filmstrip} durationMs={spanEndMs - spanStartMs} widthPx={widthPx} />
				) : (
					// Shimmer placeholder while frames extract
					<div className="w-full h-full animate-pulse bg-gradient-to-r from-white/[0.03] via-white/[0.07] to-white/[0.03]" />
				)}
			</div>
		</div>
	);
}
