import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
	AIServiceConfig,
	CaptionTrack,
	ModelDownloadProgress,
	WhisperModelStatus,
} from "../src/lib/ai/types";
import type { NativeMacRecordingRequest } from "../src/lib/nativeMacRecording";
import type { NativeWindowsRecordingRequest } from "../src/lib/nativeWindowsRecording";
import type { RecordingSession, StoreRecordedSessionInput } from "../src/lib/recordingSession";
import type { ShortcutBinding } from "../src/lib/shortcuts";
import { NATIVE_BRIDGE_CHANNEL, type NativeBridgeRequest } from "../src/native/contracts";

// Asset base URL is passed from the main process via webPreferences.additionalArguments
// (see windows.ts). Sandboxed preloads cannot import node:path / node:url, so we
// can't compute it here.
const ASSET_BASE_URL_ARG_PREFIX = "--asset-base-url=";
const assetBaseUrlArg = process.argv.find((arg) => arg.startsWith(ASSET_BASE_URL_ARG_PREFIX));
const assetBaseUrl = assetBaseUrlArg ? assetBaseUrlArg.slice(ASSET_BASE_URL_ARG_PREFIX.length) : "";

contextBridge.exposeInMainWorld("electronAPI", {
	// ── Asset base path ──
	assetBaseUrl,
	getAssetBasePath: async () => {
		return await ipcRenderer.invoke("get-asset-base-path");
	},
	// Ensures the Whisper caption model is available locally (downloads on first use in the
	// packaged app) and returns a file:// URL for transformers.js `env.localModelPath`.
	ensureCaptionModel: async (): Promise<string> => {
		return await ipcRenderer.invoke("ensure-caption-model");
	},

	// ── Native bridge (Guide Studio) ──
	invokeNativeBridge: <TData>(request: NativeBridgeRequest) => {
		return ipcRenderer.invoke(NATIVE_BRIDGE_CHANNEL, request) as Promise<TData>;
	},

	// ── HUD overlay (Guide Studio) ──
	hudOverlayHide: () => {
		ipcRenderer.send("hud-overlay-hide");
	},
	hudOverlayClose: () => {
		ipcRenderer.send("hud-overlay-close");
	},
	setHudOverlayIgnoreMouseEvents: (ignore: boolean) => {
		ipcRenderer.send("hud-overlay-ignore-mouse-events", ignore);
	},
	moveHudOverlayBy: (deltaX: number, deltaY: number) => {
		ipcRenderer.send("hud-overlay-move-by", deltaX, deltaY);
	},
	setHudOverlaySize: (width: number, height: number) => {
		ipcRenderer.send("hud-overlay-set-size", width, height);
	},

	// ── Source selection & recording flow ──
	getSources: async (opts: Electron.SourcesOptions) => {
		return await ipcRenderer.invoke("get-sources", opts);
	},
	switchToEditor: () => {
		return ipcRenderer.invoke("switch-to-editor");
	},
	openAIVideoCreator: () => {
		return ipcRenderer.invoke("open-ai-video-creator");
	},
	switchToHud: () => {
		return ipcRenderer.invoke("switch-to-hud");
	},
	startNewRecording: () => {
		return ipcRenderer.invoke("start-new-recording");
	},
	openSourceSelector: (options?: { skipPermissionCheck?: boolean }) => {
		return ipcRenderer.invoke("open-source-selector", options);
	},
	selectSource: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("select-source", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	requestCameraAccess: () => {
		return ipcRenderer.invoke("request-camera-access");
	},
	requestScreenAccess: () => {
		return ipcRenderer.invoke("request-screen-access");
	},
	requestNativeMacCursorAccess: () => {
		return ipcRenderer.invoke("request-native-mac-cursor-access");
	},

	// ── Recording storage ──
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	storeRecordedSession: (payload: StoreRecordedSessionInput) => {
		return ipcRenderer.invoke("store-recorded-session", payload);
	},
	openRecordingStream: (fileName: string) => {
		return ipcRenderer.invoke("open-recording-stream", fileName);
	},
	appendRecordingChunk: (fileName: string, chunk: ArrayBuffer) => {
		return ipcRenderer.invoke("append-recording-chunk", fileName, chunk);
	},
	closeRecordingStream: (fileName: string) => {
		return ipcRenderer.invoke("close-recording-stream", fileName);
	},
	getRecordedVideoPath: () => {
		return ipcRenderer.invoke("get-recorded-video-path");
	},

	// ── Recording state (Guide Studio's richer signature with recordingId + cursorCaptureMode) ──
	setRecordingState: (
		recording: boolean,
		recordingId?: number,
		cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode,
	) => {
		return ipcRenderer.invoke("set-recording-state", recording, recordingId, cursorCaptureMode);
	},

	// ── Native Windows capture (Guide Studio) ──
	isNativeWindowsCaptureAvailable: () => {
		return ipcRenderer.invoke("is-native-windows-capture-available");
	},
	isNativeMacCaptureAvailable: () => {
		return ipcRenderer.invoke("is-native-mac-capture-available");
	},
	startNativeWindowsRecording: (request: NativeWindowsRecordingRequest) => {
		return ipcRenderer.invoke("start-native-windows-recording", request);
	},
	stopNativeWindowsRecording: (discard?: boolean) => {
		return ipcRenderer.invoke("stop-native-windows-recording", discard);
	},
	pauseNativeWindowsRecording: () => {
		return ipcRenderer.invoke("pause-native-windows-recording");
	},
	resumeNativeWindowsRecording: () => {
		return ipcRenderer.invoke("resume-native-windows-recording");
	},

	// ── Native Mac capture (Guide Studio) ──
	startNativeMacRecording: (request: NativeMacRecordingRequest) => {
		return ipcRenderer.invoke("start-native-mac-recording", request);
	},
	pauseNativeMacRecording: () => {
		return ipcRenderer.invoke("pause-native-mac-recording");
	},
	resumeNativeMacRecording: () => {
		return ipcRenderer.invoke("resume-native-mac-recording");
	},
	stopNativeMacRecording: (discard?: boolean) => {
		return ipcRenderer.invoke("stop-native-mac-recording", discard);
	},
	attachNativeMacWebcamRecording: (payload: {
		screenVideoPath: string;
		recordingId: number;
		webcam: { fileName: string; videoData: ArrayBuffer };
		cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode;
	}) => {
		return ipcRenderer.invoke("attach-native-mac-webcam-recording", payload);
	},

	// ── Native Capture ──
	nativeGetSources: () => {
		return ipcRenderer.invoke("native-get-sources");
	},
	nativeStartCapture: (options: import("../src/lib/native/types").CaptureOptions) => {
		return ipcRenderer.invoke("native-start-capture", options);
	},
	nativeStopCapture: () => {
		return ipcRenderer.invoke("native-stop-capture");
	},
	nativePauseCapture: () => {
		return ipcRenderer.invoke("native-pause-capture");
	},
	nativeResumeCapture: () => {
		return ipcRenderer.invoke("native-resume-capture");
	},
	nativeGetCaptureStatus: () => {
		return ipcRenderer.invoke("native-get-capture-status");
	},
	nativeGetBackend: () => {
		return ipcRenderer.invoke("native-get-backend");
	},

	// ── Cursor telemetry ──
	getCursorTelemetry: (videoPath?: string) => {
		return ipcRenderer.invoke("get-cursor-telemetry", videoPath);
	},
	discardCursorTelemetry: (recordingId: number) => {
		return ipcRenderer.invoke("discard-cursor-telemetry", recordingId);
	},

	// ── Recording event listeners ──
	onStopRecordingFromTray: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-tray", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
	},

	// ── File operations ──
	openExternalUrl: (url: string) => {
		return ipcRenderer.invoke("open-external-url", url);
	},
	pickExportSavePath: (fileName: string, exportFolder?: string) => {
		return ipcRenderer.invoke("pick-export-save-path", fileName, exportFolder);
	},
	writeExportToPath: (videoData: ArrayBuffer, filePath: string) => {
		return ipcRenderer.invoke("write-export-to-path", videoData, filePath);
	},
	saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("save-exported-video", videoData, fileName);
	},
	saveScreenshot: (imageData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("save-screenshot", imageData, fileName);
	},
	openVideoFilePicker: () => {
		return ipcRenderer.invoke("open-video-file-picker");
	},
	remuxVideo: (inputPath: string) => {
		return ipcRenderer.invoke("remux-video", inputPath);
	},
	mergeVideoAudio: (videoPath: string, audioPath: string) => {
		return ipcRenderer.invoke("merge-video-audio", videoPath, audioPath);
	},
	saveNarrationAudio: (data: ArrayBuffer) => {
		return ipcRenderer.invoke("save-narration-audio", data);
	},
	muxNarrationAudio: (
		videoPath: string,
		segments: Array<{ audioPath: string; offsetMs: number }>,
		music?: {
			audioPath: string;
			volume: number;
			duckWindows: Array<{ startMs: number; endMs: number }>;
		} | null,
		muteOriginal?: boolean,
	) => {
		return ipcRenderer.invoke("mux-narration-audio", videoPath, segments, music, muteOriginal);
	},
	setCurrentVideoPath: (path: string) => {
		return ipcRenderer.invoke("set-current-video-path", path);
	},
	setCurrentRecordingSession: (session: RecordingSession | null) => {
		return ipcRenderer.invoke("set-current-recording-session", session);
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	getCurrentRecordingSession: () => {
		return ipcRenderer.invoke("get-current-recording-session");
	},
	readBinaryFile: (filePath: string) => {
		return ipcRenderer.invoke("read-binary-file", filePath);
	},
	preparePreviewAudioTrack: (filePath: string) => {
		return ipcRenderer.invoke("prepare-preview-audio-track", filePath);
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	getPathForFile: (file: File) => {
		try {
			return webUtils.getPathForFile(file);
		} catch {
			return "";
		}
	},

	// ── Project file operations ──
	saveProjectFile: (projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
		return ipcRenderer.invoke("save-project-file", projectData, suggestedName, existingProjectPath);
	},
	autoSaveProject: (projectData: unknown, fileName: string) => {
		return ipcRenderer.invoke("auto-save-project", projectData, fileName);
	},
	loadProjectFile: (projectFolder?: string) => {
		return ipcRenderer.invoke("load-project-file", projectFolder);
	},
	loadProjectFileFromPath: (filePath: string) => {
		return ipcRenderer.invoke("load-project-file-from-path", filePath);
	},
	loadProjectByPath: (filePath: string) => {
		return ipcRenderer.invoke("load-project-by-path", filePath);
	},
	loadCurrentProjectFile: () => {
		return ipcRenderer.invoke("load-current-project-file");
	},

	// ── Menu event listeners ──
	onMenuNewProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-new-project", listener);
		return () => ipcRenderer.removeListener("menu-new-project", listener);
	},
	onMenuImportVideo: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-import-video", listener);
		return () => ipcRenderer.removeListener("menu-import-video", listener);
	},
	onMenuNewRecording: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-new-recording", listener);
		return () => ipcRenderer.removeListener("menu-new-recording", listener);
	},
	onMenuOpenWindowForRecording: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-open-window-for-recording", listener);
		return () => ipcRenderer.removeListener("menu-open-window-for-recording", listener);
	},
	onMenuCreateVideo: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-create-video", listener);
		return () => ipcRenderer.removeListener("menu-create-video", listener);
	},
	onMenuOpenVideo: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-open-video", listener);
		return () => ipcRenderer.removeListener("menu-open-video", listener);
	},
	onMenuLoadProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-load-project", listener);
		return () => ipcRenderer.removeListener("menu-load-project", listener);
	},
	onMenuSaveProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project", listener);
		return () => ipcRenderer.removeListener("menu-save-project", listener);
	},
	onMenuSaveProjectAs: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project-as", listener);
		return () => ipcRenderer.removeListener("menu-save-project-as", listener);
	},
	onMenuRecentProjects: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-recent-projects", listener);
		return () => ipcRenderer.removeListener("menu-recent-projects", listener);
	},

	// ── Platform / Settings / Shortcuts ──
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	saveAudioAs: (sourcePath: string, defaultFileName: string) => {
		return ipcRenderer.invoke("save-audio-as", sourcePath, defaultFileName);
	},
	getShortcuts: () => {
		return ipcRenderer.invoke("get-shortcuts");
	},
	saveShortcuts: (shortcuts: unknown) => {
		return ipcRenderer.invoke("save-shortcuts", shortcuts);
	},
	updateGlobalShortcut: (binding: ShortcutBinding) => {
		return ipcRenderer.invoke("update-global-shortcut", binding);
	},
	setLocale: (locale: string) => {
		return ipcRenderer.invoke("set-locale", locale);
	},
	getSettings: () => {
		return ipcRenderer.invoke("get-settings");
	},
	getSetting: (key: string) => {
		return ipcRenderer.invoke("get-setting", key);
	},
	setSetting: (key: string, value: unknown) => {
		return ipcRenderer.invoke("set-setting", key, value);
	},

	// ── Guide doc export ──
	saveGuideDoc: (content: string, defaultFileName: string, format: "html" | "md") => {
		return ipcRenderer.invoke("save-guide-doc", content, defaultFileName, format);
	},

	// ── Intro video ──
	saveIntroVideo: (videoData: ArrayBuffer) => {
		return ipcRenderer.invoke("save-intro-video", videoData);
	},
	deleteTempFile: (filePath: string) => {
		return ipcRenderer.invoke("delete-temp-file", filePath);
	},

	// ── FFmpeg ──
	getFfmpegPath: () => {
		return ipcRenderer.invoke("get-ffmpeg-path");
	},
	concatVideos: (inputPaths: string[], outputPath: string) => {
		return ipcRenderer.invoke("concat-videos", inputPaths, outputPath);
	},
	quickTrimExport: (
		inputPath: string,
		outputPath: string,
		segments: Array<{ startMs: number; endMs: number }>,
	) => {
		return ipcRenderer.invoke("quick-trim-export", inputPath, outputPath, segments);
	},
	flattenVideoClips: (segments: Array<{ sourcePath: string; startMs: number; endMs: number }>) => {
		return ipcRenderer.invoke("flatten-video-clips", segments);
	},
	assembleSmartExport: (options: {
		outputPath: string;
		renderedPath: string;
		cleanupRenderedFile?: boolean;
		width: number;
		height: number;
		fps: number;
		bitrate?: number;
		segments: Array<
			| { kind: "copy"; sourcePath: string; startMs: number; endMs: number }
			| { kind: "rendered"; startMs: number; endMs: number }
		>;
	}) => {
		return ipcRenderer.invoke("assemble-smart-export", options);
	},
	remuxExport: (inputPath: string, outputPath: string) => {
		return ipcRenderer.invoke("remux-export", inputPath, outputPath);
	},
	optimizeGif: (
		filePath: string,
		loop?: boolean,
		sizePreset?: "small" | "medium" | "large" | "original",
	) => {
		return ipcRenderer.invoke("optimize-gif", filePath, loop, sizePreset);
	},
	convertVideoToGif: (
		inputPath: string,
		outputPath: string,
		options: {
			fps: number;
			width: number;
			height: number;
			loop: boolean;
			sizePreset?: "small" | "medium" | "large" | "original";
			segments?: Array<{ startMs: number; endMs: number }>;
			crop?: { x: number; y: number; width: number; height: number };
		},
	) => {
		return ipcRenderer.invoke("convert-video-to-gif", inputPath, outputPath, options);
	},

	// ── UI state ──
	setMicrophoneExpanded: (expanded: boolean) => {
		ipcRenderer.send("hud:setMicrophoneExpanded", expanded);
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	setWindowTitle: (title: string) => {
		ipcRenderer.send("set-window-title", title);
	},

	// ── Countdown overlay (Guide Studio) ──
	showCountdownOverlay: (value: number, runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-show", value, runId);
	},
	setCountdownOverlayValue: (value: number, runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-set-value", value, runId);
	},
	hideCountdownOverlay: (runId: number) => {
		return ipcRenderer.invoke("countdown-overlay-hide", runId);
	},
	onCountdownOverlayValue: (callback: (value: number | null) => void) => {
		const listener = (_event: unknown, value: number | null) => callback(value);
		ipcRenderer.on("countdown-overlay-value", listener);
		return () => ipcRenderer.removeListener("countdown-overlay-value", listener);
	},

	// ── Close / save-before-close flow ──
	onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => {
		const listener = async () => {
			try {
				const shouldClose = await callback();
				ipcRenderer.send("save-before-close-done", shouldClose);
			} catch {
				ipcRenderer.send("save-before-close-done", false);
			}
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	onRequestCloseConfirm: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("request-close-confirm", listener);
		return () => ipcRenderer.removeListener("request-close-confirm", listener);
	},
	sendCloseConfirmResponse: (choice: "save" | "discard" | "cancel") => {
		ipcRenderer.send("close-confirm-response", choice);
	},

	// ── Multi-window recording ──
	openWindowForRecording: () => {
		return ipcRenderer.invoke("open-window-for-recording");
	},
	onOpenSourcePicker: (
		callback: (data: { preferredSourceId: string; targetWindowTitle: string }) => void,
	) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			data: { preferredSourceId: string; targetWindowTitle: string },
		) => callback(data);
		ipcRenderer.on("open-source-picker", handler);
		return () => ipcRenderer.removeListener("open-source-picker", handler);
	},
	setCaptureTargetMode: (sourceId: string, recording: boolean) => {
		return ipcRenderer.invoke("set-capture-target-mode", sourceId, recording);
	},
	onCaptureModeChanged: (callback: (data: { recording: boolean }) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, data: { recording: boolean }) =>
			callback(data);
		ipcRenderer.on("capture-mode-changed", handler);
		return () => ipcRenderer.removeListener("capture-mode-changed", handler);
	},

	// ── Recording bar ──
	showRecordingBar: () => {
		return ipcRenderer.invoke("show-recording-bar");
	},
	hideRecordingBar: () => {
		return ipcRenderer.invoke("hide-recording-bar");
	},
	stopRecordingFromBar: () => {
		return ipcRenderer.invoke("stop-recording-from-bar");
	},
	minimizeEditor: () => {
		return ipcRenderer.invoke("minimize-editor");
	},
	restoreEditor: () => {
		return ipcRenderer.invoke("restore-editor");
	},
	onStopRecordingFromBar: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-bar", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-bar", listener);
	},

	// ── Webcam preview ──
	showWebcamPreview: (deviceId?: string) => {
		return ipcRenderer.invoke("webcam-preview-show", deviceId);
	},
	hideWebcamPreview: () => {
		return ipcRenderer.invoke("webcam-preview-hide");
	},
	onWebcamPreviewDeviceChanged: (callback: (deviceId: string) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, deviceId: string) => callback(deviceId);
		ipcRenderer.on("webcam-preview-device-changed", handler);
		return () => ipcRenderer.removeListener("webcam-preview-device-changed", handler);
	},

	// ── Studio site cache ──
	studioCacheGet: (url: string) => {
		return ipcRenderer.invoke("studio-cache-get", url);
	},
	studioCacheSet: (url: string, entry: unknown) => {
		return ipcRenderer.invoke("studio-cache-set", url, entry);
	},
	studioCacheClear: (url?: string) => {
		return ipcRenderer.invoke("studio-cache-clear", url);
	},
	studioCacheList: () => {
		return ipcRenderer.invoke("studio-cache-list");
	},

	// ── AI features ──
	aiAnalyze: (
		prompt: string,
		context?: string,
		modelOverride?: { provider: string; model: string },
	) => {
		return ipcRenderer.invoke("ai-analyze", prompt, context, modelOverride);
	},
	// Bench keyframe capture — renders a single scene at a given frame in a
	// hidden BrowserWindow and returns the PNG path.
	benchCaptureFrame: (args: {
		code: string;
		frame: number;
		briefId: string;
		sceneIndex: number;
	}) => {
		return ipcRenderer.invoke("bench-capture-frame", args);
	},
	aiGenerateJSON: (prompt: string, context?: string, schema?: Record<string, unknown>) => {
		return ipcRenderer.invoke("ai-generate-json", prompt, context, schema);
	},
	aiAnalyzeImage: (prompt: string, imageBase64: string, systemPrompt?: string) => {
		return ipcRenderer.invoke("ai-analyze-image", prompt, imageBase64, systemPrompt);
	},
	aiCheckAvailability: () => {
		return ipcRenderer.invoke("ai-check-availability");
	},
	aiGetConfig: () => {
		return ipcRenderer.invoke("ai-get-config");
	},
	aiGetAllKeys: () => {
		return ipcRenderer.invoke("ai-get-all-keys") as Promise<{
			keys: Record<string, string>;
			models: Record<string, string>;
		}>;
	},
	aiSaveConfig: (config: Partial<AIServiceConfig>) => {
		return ipcRenderer.invoke("ai-save-config", config);
	},
	aiTtsSynthesize: (text: string, voice?: string) => {
		return ipcRenderer.invoke("ai-tts-synthesize", text, voice);
	},
	// MiniMax TTS — preferred for multi-scene narration (higher quality, voice picker)
	aiMinimaxTts: (
		text: string,
		options?: {
			voiceId?: string;
			speed?: number;
			volume?: number;
			pitch?: number;
			model?: string;
		},
	) => {
		return ipcRenderer.invoke("ai-minimax-tts", text, options);
	},
	aiMinimaxTtsBatch: (
		items: Array<{
			text: string;
			sceneIndex: number;
			options?: {
				voiceId?: string;
				speed?: number;
				volume?: number;
				pitch?: number;
				model?: string;
			};
		}>,
	) => {
		return ipcRenderer.invoke("ai-minimax-tts-batch", items);
	},
	aiMinimaxVoices: () => {
		return ipcRenderer.invoke("ai-minimax-voices");
	},
	// MiniMax image generation — backgrounds, subject references
	aiMinimaxImage: (
		prompt: string,
		options?: {
			aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
			count?: number;
			subjectReferenceUrl?: string;
		},
	) => {
		return ipcRenderer.invoke("ai-minimax-image", prompt, options);
	},
	// ElevenLabs Sound Effects — text-to-SFX, cached on disk by prompt hash
	aiElevenlabsSfx: (
		prompt: string,
		options?: { durationSec?: number; promptInfluence?: number },
	) => {
		return ipcRenderer.invoke("ai-elevenlabs-sfx", prompt, options) as Promise<{
			success: boolean;
			filePath?: string;
			cached?: boolean;
			error?: string;
		}>;
	},
	aiElevenlabsSfxBatch: (
		items: Array<{
			prompt: string;
			options?: { durationSec?: number; promptInfluence?: number };
		}>,
	) => {
		return ipcRenderer.invoke("ai-elevenlabs-sfx-batch", items) as Promise<
			Array<{ success: boolean; filePath?: string; cached?: boolean; error?: string }>
		>;
	},
	// ElevenLabs Music — text-to-music via /v1/music (alternative to MiniMax)
	aiElevenlabsMusic: (
		prompt: string,
		options?: {
			durationSec?: number;
			forceInstrumental?: boolean;
			outputFormat?: string;
			seed?: number;
		},
	) => {
		return ipcRenderer.invoke("ai-elevenlabs-music", prompt, options) as Promise<{
			success: boolean;
			audioPath?: string;
			songId?: string;
			durationSec?: number;
			error?: string;
		}>;
	},
	aiSaveServiceKey: (service: "elevenlabs", apiKey: string) => {
		return ipcRenderer.invoke("ai-save-service-key", service, apiKey) as Promise<{
			success: boolean;
			error?: string;
		}>;
	},
	aiGetServiceKey: (service: "elevenlabs") => {
		return ipcRenderer.invoke("ai-get-service-key", service) as Promise<{ apiKey: string }>;
	},
	aiGenerateMusic: (
		mood: string,
		customPrompt?: string,
		videoDurationSec?: number,
		vocalMode?: string,
		lyrics?: string,
	) => {
		return ipcRenderer.invoke(
			"ai-generate-music",
			mood,
			customPrompt,
			videoDurationSec,
			vocalMode,
			lyrics,
		);
	},
	aiGenerateLyrics: (themePrompt: string, title?: string) => {
		return ipcRenderer.invoke("ai-generate-lyrics", themePrompt, title);
	},

	// ── AI Token usage tracking ──
	aiTokenUsageReset: () =>
		ipcRenderer.invoke("ai-token-usage-reset") as Promise<{ success: boolean }>,
	aiTokenUsageGet: () => ipcRenderer.invoke("ai-token-usage-get"),

	// ── AI Video generation ──
	aiGenerateVideo: (
		prompt: string,
		options?: {
			model?: string;
			durationSec?: number;
			resolution?: "720P" | "768P" | "1080P";
		},
	) => {
		return ipcRenderer.invoke("ai-generate-video", prompt, options);
	},
	aiGenerateVideoBatch: (
		clips: Array<{
			prompt: string;
			sceneIndex: number;
			model?: string;
			durationSec?: number;
			resolution?: "720P" | "768P" | "1080P";
		}>,
	) => {
		return ipcRenderer.invoke("ai-generate-video-batch", clips);
	},

	// ── AI Video Creator (drives the user's own Claude Code install) ──
	claudeDetect: () => ipcRenderer.invoke("claude-detect"),
	claudeSkills: () => ipcRenderer.invoke("claude-skills"),
	claudePlan: (input: {
		request: string;
		format?: "landscape" | "vertical" | "square";
		targetSeconds?: number;
		model?: string;
		look?: "motion" | "cards";
	}) => ipcRenderer.invoke("claude-plan", input),
	claudePreview: (sessionId: string) => ipcRenderer.invoke("claude-preview", sessionId),
	claudeRender: (sessionId: string) => ipcRenderer.invoke("claude-render", sessionId),
	claudeSession: (sessionId: string) => ipcRenderer.invoke("claude-session", sessionId),
	claudeSessions: () => ipcRenderer.invoke("claude-sessions"),
	claudeCancel: (sessionId: string) => ipcRenderer.invoke("claude-cancel", sessionId),
	claudeDiscard: (sessionId: string) => ipcRenderer.invoke("claude-discard", sessionId),
	claudeInsertIntoEditor: (sessionId: string) =>
		ipcRenderer.invoke("claude-insert-into-editor", sessionId),
	onClaudeActivity: (
		callback: (activity: import("./claude-runtime/events").ClaudeActivity) => void,
	) => {
		const listener = (_: unknown, activity: import("./claude-runtime/events").ClaudeActivity) =>
			callback(activity);
		ipcRenderer.on("claude-activity", listener);
		return () => ipcRenderer.removeListener("claude-activity", listener);
	},
	onClaudeRenderProgress: (callback: (payload: { sessionId: string; percent: number }) => void) => {
		const listener = (_: unknown, payload: { sessionId: string; percent: number }) =>
			callback(payload);
		ipcRenderer.on("claude-render-progress", listener);
		return () => ipcRenderer.removeListener("claude-render-progress", listener);
	},
	onClaudeInsertClip: (callback: (payload: { videoPath: string; title: string }) => void) => {
		const listener = (_: unknown, payload: { videoPath: string; title: string }) =>
			callback(payload);
		ipcRenderer.on("claude-insert-clip", listener);
		return () => ipcRenderer.removeListener("claude-insert-clip", listener);
	},

	// ── Music library ──
	musicLibraryList: () => {
		return ipcRenderer.invoke("music-library-list");
	},
	musicLibraryDelete: (filePath: string) => {
		return ipcRenderer.invoke("music-library-delete", filePath);
	},

	// ── YouTube ──
	youtubeIsConnected: () => ipcRenderer.invoke("youtube-is-connected"),
	youtubeConnect: () => ipcRenderer.invoke("youtube-connect"),
	youtubeDisconnect: () => ipcRenderer.invoke("youtube-disconnect"),
	youtubeSetCredentials: (clientId: string, clientSecret: string) =>
		ipcRenderer.invoke("youtube-set-credentials", clientId, clientSecret),
	youtubeUpload: (opts: {
		filePath: string;
		title: string;
		description?: string;
		privacy: "public" | "unlisted" | "private";
	}) => ipcRenderer.invoke("youtube-upload", opts),
	onYoutubeUploadProgress: (callback: (percent: number) => void) => {
		const listener = (_: unknown, percent: number) => callback(percent);
		ipcRenderer.on("youtube-upload-progress", listener);
		return () => ipcRenderer.removeListener("youtube-upload-progress", listener);
	},
	youtubeFetchChannelShorts: (channelHandle: string) => {
		return ipcRenderer.invoke("youtube-fetch-channel-shorts", channelHandle);
	},

	// ── Lottie ──
	lottieSearch: (query: string, page?: number) => {
		return ipcRenderer.invoke("lottie-search", query, page);
	},
	lottiePopular: (page?: number) => {
		return ipcRenderer.invoke("lottie-popular", page);
	},
	lottieDownload: (lottieUrl: string, name: string) => {
		return ipcRenderer.invoke("lottie-download", lottieUrl, name);
	},

	// ── Free music search (Openverse) ──
	freeMusicSearch: (query: string, page?: number, pageSize?: number) => {
		return ipcRenderer.invoke("free-music-search", query, page, pageSize);
	},
	freeMusicDownload: (audioUrl: string, name: string) => {
		return ipcRenderer.invoke("free-music-download", audioUrl, name);
	},

	// ── Remotion SSR Export ──
	exportRemotion: (opts: {
		code: string;
		screenshots: string[];
		fps?: number;
		durationInFrames?: number;
		fileName?: string;
		musicPath?: string;
		musicVolume?: number;
	}) => {
		return ipcRenderer.invoke("export-remotion", opts);
	},
	onExportRemotionProgress: (callback: (percent: number) => void) => {
		const listener = (_: unknown, percent: number) => callback(percent);
		ipcRenderer.on("export-remotion-progress", listener);
		return () => ipcRenderer.removeListener("export-remotion-progress", listener);
	},

	// ── Updater (electron-updater against GitHub Releases) ──
	checkForUpdates: (manual?: boolean) => {
		return ipcRenderer.invoke("update:check", manual ?? false);
	},
	getUpdateStatus: () => {
		return ipcRenderer.invoke("update:status");
	},
	dismissUpdate: () => {
		return ipcRenderer.invoke("update:dismiss");
	},
	installUpdate: () => {
		return ipcRenderer.invoke("update:install");
	},
	getUpdateChannel: () => {
		return ipcRenderer.invoke("update:get-channel");
	},
	setUpdateChannel: (channel: "latest" | "beta") => {
		return ipcRenderer.invoke("update:set-channel", channel);
	},
	onUpdateEvent: (callback: (event: unknown) => void) => {
		const listener = (_: unknown, event: unknown) => callback(event);
		ipcRenderer.on("update:event", listener);
		return () => ipcRenderer.removeListener("update:event", listener);
	},

	// ── Project browser ──
	getRecentProjects: () => {
		return ipcRenderer.invoke("get-recent-projects");
	},
	removeRecentProject: (filePath: string) => {
		return ipcRenderer.invoke("remove-recent-project", filePath);
	},

	// ── Whisper / Captions ──
	whisperTranscribe: (
		videoPath: string,
		options?: { modelId?: string; language?: string; threads?: number },
	): Promise<{ success: boolean; captionTrack?: CaptionTrack; error?: string }> => {
		return ipcRenderer.invoke("whisper-transcribe", videoPath, options);
	},
	whisperModelStatus: (modelId: string): Promise<WhisperModelStatus> => {
		return ipcRenderer.invoke("whisper-model-status", modelId);
	},
	whisperModelDownload: (
		modelId: string,
	): Promise<{ success: boolean; path?: string; error?: string }> => {
		return ipcRenderer.invoke("whisper-model-download", modelId);
	},
	whisperModelDelete: (modelId: string): Promise<{ success: boolean; error?: string }> => {
		return ipcRenderer.invoke("whisper-model-delete", modelId);
	},
	whisperAvailable: (): Promise<boolean> => {
		return ipcRenderer.invoke("whisper-available");
	},
	onWhisperModelDownloadProgress: (callback: (progress: ModelDownloadProgress) => void) => {
		const listener = (_: unknown, progress: ModelDownloadProgress) => callback(progress);
		ipcRenderer.on("whisper-model-download-progress", listener);
		return () => ipcRenderer.removeListener("whisper-model-download-progress", listener);
	},

	// ── AI Demo Recorder ──
	demoStart: (config: {
		url: string;
		prompt: string;
		maxSteps?: number;
		viewport?: { width: number; height: number };
		headless?: boolean;
	}) => {
		return ipcRenderer.invoke("demo-start", config);
	},
	demoStop: () => {
		return ipcRenderer.invoke("demo-stop");
	},
	demoResume: () => {
		return ipcRenderer.invoke("demo-resume");
	},
	demoGetStatus: () => {
		return ipcRenderer.invoke("demo-get-status");
	},
	onDemoProgress: (
		callback: (data: {
			step: {
				action: {
					action: string;
					target?: string;
					value?: string;
					narration: string;
					waitMs?: number;
					reasoning?: string;
				};
				timestamp: number;
				screenshotDataUrl?: string;
			};
			stepIndex: number;
		}) => void,
	) => {
		const listener = (_: unknown, data: Parameters<typeof callback>[0]) => callback(data);
		ipcRenderer.on("demo-progress", listener);
		return () => ipcRenderer.removeListener("demo-progress", listener);
	},
});
