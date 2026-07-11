import { ipcMain } from "electron";
import {
	assembleSmartExport,
	type ConvertVideoToGifOptions,
	concatenateVideos,
	convertVideoToGif,
	type FlattenClipSegment,
	flattenVideoClips,
	getFfmpegPath,
	optimizeGif,
	quickTrimExport,
	remuxExport,
	type SmartAssembleOptions,
} from "../ffmpeg";

export function registerFfmpegHandlers() {
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
