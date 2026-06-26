import { ipcMain } from "electron";
import { concatenateVideos, getFfmpegPath } from "../ffmpeg";

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
}
