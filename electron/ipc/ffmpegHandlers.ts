import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { app, ipcMain } from "electron";
import {
	assembleSmartExport,
	type ConvertVideoToGifOptions,
	concatenateVideos,
	convertVideoToGif,
	type FlattenClipSegment,
	flattenVideoClips,
	getFfmpegPath,
	type MusicMuxBed,
	muxNarrationAudio,
	type NarrationMuxSegment,
	optimizeGif,
	quickTrimExport,
	remuxExport,
	type SmartAssembleOptions,
} from "../ffmpeg";

export function registerFfmpegHandlers() {
	// ── AI narration audio ──
	// TTS bytes fetched by the renderer land here as local files so both the
	// preview <audio> elements and the export-time FFmpeg mux can use them.
	ipcMain.handle("save-narration-audio", async (_event, data: ArrayBuffer) => {
		try {
			const dir = path.join(app.getPath("userData"), "narration");
			await fs.mkdir(dir, { recursive: true });
			const filePath = path.join(dir, `tts-${randomUUID()}.mp3`);
			await fs.writeFile(filePath, Buffer.from(data));
			return { success: true, path: filePath };
		} catch (error) {
			console.error("Failed to save narration audio:", error);
			return { success: false, error: String(error) };
		}
	});

	// Mux narration segments into an exported video IN PLACE: write to a
	// sibling temp file, then swap it over the original on success.
	ipcMain.handle(
		"mux-narration-audio",
		async (
			_event,
			videoPath: string,
			segments: NarrationMuxSegment[],
			music?: MusicMuxBed | null,
			muteOriginal?: boolean,
		) => {
			const tempPath = `${videoPath}.narration.tmp.mp4`;
			try {
				const result = await muxNarrationAudio(
					videoPath,
					segments,
					tempPath,
					music,
					Boolean(muteOriginal),
				);
				if (!result.success) {
					await fs.rm(tempPath, { force: true });
					return result;
				}
				await fs.rename(tempPath, videoPath);
				return { success: true };
			} catch (error) {
				await fs.rm(tempPath, { force: true }).catch(() => {});
				console.error("Failed to mux narration audio:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("get-ffmpeg-path", async () => {
		try {
			const ffmpegPath = await getFfmpegPath();
			return { success: !!ffmpegPath, path: ffmpegPath };
		} catch (error) {
			console.error("Failed to get FFmpeg path:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("concat-videos", async (_event, inputPaths: string[], outputPath: string) => {
		try {
			return await concatenateVideos(inputPaths, outputPath);
		} catch (error) {
			console.error("Failed to concatenate videos:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(
		"optimize-gif",
		async (
			_event,
			filePath: string,
			loop?: boolean,
			sizePreset?: "small" | "medium" | "large" | "original",
		) => {
			try {
				return await optimizeGif(filePath, loop ?? true, sizePreset ?? "original");
			} catch (error) {
				console.error("Failed to optimize GIF:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle(
		"convert-video-to-gif",
		async (_event, inputPath: string, outputPath: string, options: ConvertVideoToGifOptions) => {
			try {
				return await convertVideoToGif(inputPath, outputPath, options);
			} catch (error) {
				console.error("Failed to convert video to GIF:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("remux-export", async (_event, inputPath: string, outputPath: string) => {
		try {
			return await remuxExport(inputPath, outputPath);
		} catch (error) {
			console.error("Failed to remux export:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("flatten-video-clips", async (_event, segments: FlattenClipSegment[]) => {
		try {
			return await flattenVideoClips(segments);
		} catch (error) {
			console.error("Failed to flatten video clips:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("assemble-smart-export", async (_event, options: SmartAssembleOptions) => {
		try {
			return await assembleSmartExport(options);
		} catch (error) {
			console.error("Failed to assemble smart export:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(
		"quick-trim-export",
		async (
			_event,
			inputPath: string,
			outputPath: string,
			segments: Array<{ startMs: number; endMs: number }>,
		) => {
			try {
				return await quickTrimExport(inputPath, outputPath, segments);
			} catch (error) {
				console.error("Failed to quick-trim export:", error);
				return { success: false, error: String(error) };
			}
		},
	);
}
