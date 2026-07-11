/**
 * Filmstrip thumbnails for the timeline — extracts a pool of small frames
 * from the recording (CapCut-style) once per video, then lets the timeline
 * tile them at any zoom level without re-decoding.
 */
import { useEffect, useState } from "react";
import { toFileUrl } from "@/components/video-editor/projectPersistence";

export interface FilmstripFrame {
	timeMs: number;
	dataUrl: string;
}

export interface Filmstrip {
	frames: FilmstripFrame[];
	/** Width/height ratio of a single tile */
	aspect: number;
}

/** Number of frames extracted per video — the pool covers every zoom level */
const FRAME_COUNT = 24;
/** Tile height in device pixels (rendered at ~36 CSS px row height) */
const FRAME_HEIGHT = 72;
const SEEK_TIMEOUT_MS = 5_000;

const cache = new Map<string, Promise<Filmstrip>>();

function seekTo(video: HTMLVideoElement, timeMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(
			() => reject(new Error("Filmstrip seek timed out")),
			SEEK_TIMEOUT_MS,
		);
		video.addEventListener(
			"seeked",
			() => {
				window.clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
		video.currentTime = timeMs / 1000;
	});
}

async function extractFilmstrip(videoUrl: string, durationMs: number): Promise<Filmstrip> {
	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	video.src = videoUrl.startsWith("file://") ? videoUrl : toFileUrl(videoUrl);

	await new Promise<void>((resolve, reject) => {
		const onError = () => reject(new Error("Could not load video for filmstrip"));
		video.addEventListener("error", onError, { once: true });
		video.addEventListener(
			"loadedmetadata",
			() => {
				video.removeEventListener("error", onError);
				resolve();
			},
			{ once: true },
		);
	});

	try {
		const sourceWidth = video.videoWidth || 16;
		const sourceHeight = video.videoHeight || 9;
		const aspect = sourceWidth / sourceHeight;
		const width = Math.round(FRAME_HEIGHT * aspect);

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = FRAME_HEIGHT;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Failed to create filmstrip canvas");

		const frames: FilmstripFrame[] = [];
		for (let i = 0; i < FRAME_COUNT; i++) {
			// Sample at slot centers so the first/last frames aren't black edges
			const timeMs = ((i + 0.5) / FRAME_COUNT) * durationMs;
			try {
				await seekTo(video, timeMs);
				ctx.drawImage(video, 0, 0, width, FRAME_HEIGHT);
				frames.push({ timeMs, dataUrl: canvas.toDataURL("image/jpeg", 0.6) });
			} catch {
				// Skip frames that fail to seek — tiles fall back to neighbours
			}
		}

		if (frames.length === 0) throw new Error("No filmstrip frames could be captured");
		return { frames, aspect };
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}

/**
 * Pick which pooled frame each visible tile should show. Pure — exported for
 * tests and reused by the FilmstripTrack renderer.
 */
export function pickFilmstripTiles(
	filmstrip: Filmstrip,
	spanStartMs: number,
	spanEndMs: number,
	widthPx: number,
	tileWidthPx: number,
): FilmstripFrame[] {
	if (widthPx <= 0 || tileWidthPx <= 0 || spanEndMs <= spanStartMs) return [];
	const { frames } = filmstrip;
	if (frames.length === 0) return [];

	const tileCount = Math.max(1, Math.ceil(widthPx / tileWidthPx));
	const spanMs = spanEndMs - spanStartMs;

	return Array.from({ length: tileCount }, (_, i) => {
		const centerMs = spanStartMs + ((i + 0.5) * tileWidthPx * spanMs) / widthPx;
		let best = frames[0];
		for (const frame of frames) {
			if (Math.abs(frame.timeMs - centerMs) < Math.abs(best.timeMs - centerMs)) {
				best = frame;
			}
		}
		return best;
	});
}

/** Load (or reuse) the filmstrip frame pool for a video */
export function useFilmstripThumbnails(
	videoUrl: string | undefined,
	durationMs: number,
): Filmstrip | null {
	const [filmstrip, setFilmstrip] = useState<Filmstrip | null>(null);

	useEffect(() => {
		if (!videoUrl || durationMs <= 0) {
			setFilmstrip(null);
			return;
		}

		let cancelled = false;
		const key = videoUrl;
		let promise = cache.get(key);
		if (!promise) {
			promise = extractFilmstrip(videoUrl, durationMs);
			cache.set(key, promise);
			// A failed extraction shouldn't poison the cache forever
			promise.catch(() => cache.delete(key));
		}

		promise
			.then((result) => {
				if (!cancelled) setFilmstrip(result);
			})
			.catch(() => {
				if (!cancelled) setFilmstrip(null);
			});

		return () => {
			cancelled = true;
		};
	}, [videoUrl, durationMs]);

	return filmstrip;
}
