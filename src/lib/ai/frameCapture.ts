/**
 * Frame capture for guide docs — loads the source recording in an offscreen
 * <video>, seeks to each step timestamp and captures a JPEG screenshot with
 * the click position highlighted, Scribe-style.
 */
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import type { GuideStep } from "./types";

/** Screenshots are downscaled to this width to keep exported docs small */
const MAX_FRAME_WIDTH = 1440;
const JPEG_QUALITY = 0.85;
const SEEK_TIMEOUT_MS = 10_000;

/** Click marker ring, sized relative to frame width */
const MARKER_RADIUS_FRACTION = 0.022;
const MARKER_COLOR = "#6E6BFF";

function loadVideo(videoPath: string): Promise<HTMLVideoElement> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.muted = true;
		video.preload = "auto";
		video.src = videoPath.startsWith("file://") ? videoPath : toFileUrl(videoPath);

		const onError = () => reject(new Error("Could not load recording for screenshots"));
		video.addEventListener("error", onError, { once: true });
		video.addEventListener(
			"loadedmetadata",
			() => {
				video.removeEventListener("error", onError);
				resolve(video);
			},
			{ once: true },
		);
	});
}

function seekTo(video: HTMLVideoElement, timeMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(
			() => reject(new Error(`Timed out seeking to ${Math.round(timeMs / 1000)}s`)),
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

function drawClickMarker(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	cx: number,
	cy: number,
): void {
	const x = cx * width;
	const y = cy * height;
	const radius = Math.max(12, width * MARKER_RADIUS_FRACTION);

	ctx.save();
	// Soft outer halo, then a crisp ring — readable on any screenshot content
	ctx.beginPath();
	ctx.arc(x, y, radius * 1.6, 0, Math.PI * 2);
	ctx.fillStyle = `${MARKER_COLOR}33`;
	ctx.fill();
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.lineWidth = Math.max(3, radius * 0.22);
	ctx.strokeStyle = MARKER_COLOR;
	ctx.stroke();
	ctx.restore();
}

/**
 * Capture a screenshot for each step, mutating nothing — returns new steps
 * with `screenshotDataUrl` filled in. Steps whose seek/capture fails are
 * returned without a screenshot rather than failing the whole run.
 */
export async function captureStepScreenshots(
	videoPath: string,
	steps: GuideStep[],
	onProgress?: (done: number, total: number) => void,
): Promise<GuideStep[]> {
	if (steps.length === 0) return [];

	const video = await loadVideo(videoPath);
	try {
		const sourceWidth = video.videoWidth || 1920;
		const sourceHeight = video.videoHeight || 1080;
		const scale = Math.min(1, MAX_FRAME_WIDTH / sourceWidth);
		const width = Math.round(sourceWidth * scale);
		const height = Math.round(sourceHeight * scale);

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Failed to create screenshot canvas");

		const result: GuideStep[] = [];
		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			try {
				await seekTo(video, step.timeMs);
				ctx.drawImage(video, 0, 0, width, height);
				drawClickMarker(ctx, width, height, step.cx, step.cy);
				result.push({ ...step, screenshotDataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY) });
			} catch {
				result.push({ ...step });
			}
			onProgress?.(i + 1, steps.length);
		}
		return result;
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}
