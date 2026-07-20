import type { Span } from "dnd-timeline";
import { Bot, Camera, Download, FilePlus2, FolderOpen, Languages, Save, Video } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import guideLogo from "@/assets/guide-logo.svg";
import { WelcomeScreen } from "@/components/recording/WelcomeScreen";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ProGateDialog, useProGate } from "@/components/ui/ProGate";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useBackend } from "@/contexts/BackendContext";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import type { EditorState } from "@/hooks/useEditorHistory";
import { INITIAL_EDITOR_STATE, useEditorHistory } from "@/hooks/useEditorHistory";
import { type Locale } from "@/i18n/config";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import { AutoPolishAuthError, runAutoPolish } from "@/lib/ai/autoPolish";
import {
	DEFAULT_POLISH_OPTIONS,
	normalizePolishOptions,
	type PolishOptions,
} from "@/lib/ai/polishTemplates";
import { fetchPolishTemplates } from "@/lib/api/templates";
import {
	captionSegmentsToAnnotationRegions,
	extractMono16kFromVideoUrl,
	MAX_CAPTION_AUDIO_SEC,
	reconcileAutoCaptionTimelineGaps,
	shiftTrimRegionsMsForCaptionBuffer,
	transcribeMono16kToSegments,
	trimLeadingSilenceMono16k,
} from "@/lib/captioning";
import { hasNativeCursorRecordingData } from "@/lib/cursor/nativeCursor";
import {
	calculateEffectiveSourceDimensions,
	calculateMp4ExportSettings,
	calculateOutputDimensions,
	type EncodingMode,
	type ExportFormat,
	type ExportPipelineModel,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	type Mp4FrameRate,
	VideoExporter,
} from "@/lib/exporter";
import {
	buildClipFlattenPlan,
	type ClipFlattenPlan,
	remapPrimaryCursorTelemetry,
	remapSpanRegions,
	toFlattenIpcSegments,
} from "@/lib/exporter/clipFlatten";
import {
	buildEffectSpans,
	buildSmartRenderPlan,
	sliceFlattenPlanFlat,
} from "@/lib/exporter/smartRender";
import { computeFrameStepTime } from "@/lib/frameStep";
import { renderIntroToBlob } from "@/lib/intro/introRenderer";
import type { IntroConfig } from "@/lib/intro/introTypes";
import type { CursorCaptureMode, ProjectMedia } from "@/lib/recordingSession";
import { matchesShortcut } from "@/lib/shortcuts";
import {
	getExportFolder,
	getProjectFolder,
	loadUserPreferences,
	parentDirectoryOf,
	saveUserPreferences,
} from "@/lib/userPreferences";
import { BackgroundLoadError } from "@/lib/wallpaper";
import { nativeBridgeClient, useCursorRecordingData, useCursorTelemetry } from "@/native";
import type { NativePlatform } from "@/native/contracts";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import { getTestId } from "@/utils/getTestId";
import { AIPanelSidebar } from "./AIPanelSidebar";
import { EditorEmptyState } from "./EditorEmptyState";
import { ExportDialog } from "./ExportDialog";
import {
	DEFAULT_CURSOR_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
	DEFAULT_GIF_SETTINGS,
	DEFAULT_SOURCE_DIMENSIONS,
} from "./editorDefaults";
import PlaybackControls from "./PlaybackControls";
import { PolishSetupDialog } from "./PolishSetupDialog";
import {
	createProjectData,
	createProjectSnapshot,
	deriveNextId,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel, type SettingsPanelMode } from "./SettingsPanel";
import { ToolRail, type ToolRailTool } from "./ToolRail";
import TimelineEditor from "./timeline/TimelineEditor";
import { buildAutoZoomSuggestions } from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type BlurData,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_DATA,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type FigureData,
	type PlaybackSpeed,
	type Rotation3DPreset,
	type SpeedRegion,
	type TrimRegion,
	type VideoClip,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomFocusMode,
	type ZoomRegion,
} from "./types";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";

/** Single Sonner slot so auto-caption phases update in place instead of stacking. */
const AUTO_CAPTION_PROGRESS_TOAST_ID = "auto-caption-progress";

function isClickInteractionType(interactionType: string | null | undefined) {
	return (
		interactionType === "click" ||
		interactionType === "double-click" ||
		interactionType === "right-click" ||
		interactionType === "middle-click"
	);
}

interface ExportDiagnostics {
	formatLabel: "GIF" | "Video";
	reason?: string;
	sourcePath?: string | null;
	width?: number;
	height?: number;
	frameRate?: number;
	codec?: string;
	bitrate?: number;
}

function getFileNameForDiagnostics(filePath?: string | null) {
	if (!filePath) return "unknown";

	try {
		const url = new URL(filePath);
		if (url.protocol === "file:") {
			return decodeURIComponent(url.pathname).split(/[\\/]/).pop() || filePath;
		}
	} catch {
		// Treat non-URL values as filesystem paths.
	}

	return filePath.split(/[\\/]/).pop() || filePath;
}

function buildExportDiagnosticMessage(diagnostics: ExportDiagnostics) {
	const details = [
		diagnostics.reason ? `Reason: ${diagnostics.reason}` : null,
		`Source: ${getFileNameForDiagnostics(diagnostics.sourcePath)}`,
		diagnostics.width && diagnostics.height
			? `Output: ${diagnostics.width}x${diagnostics.height}${
					diagnostics.frameRate ? ` @ ${diagnostics.frameRate} fps` : ""
				}`
			: null,
		diagnostics.codec ? `Codec: ${diagnostics.codec}` : null,
		diagnostics.bitrate ? `Bitrate: ${Math.round(diagnostics.bitrate / 1_000_000)} Mbps` : null,
		`VideoEncoder: ${"VideoEncoder" in window ? "available" : "unavailable"}`,
	].filter(Boolean);

	return `${diagnostics.formatLabel} export failed\n${details.join("\n")}`;
}

function buildSaveDiagnosticMessage(formatLabel: "GIF" | "Video", reason?: string) {
	return `${formatLabel} export save failed${reason ? `\nReason: ${reason}` : ""}`;
}

const CAPTION_WORD_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const POLISH_OPTIONS_STORAGE_KEY = "guide_studio_polish_options";

/** Load the user's saved polish selections, falling back to defaults. */
function loadPolishOptions(): PolishOptions {
	try {
		const raw = localStorage.getItem(POLISH_OPTIONS_STORAGE_KEY);
		return normalizePolishOptions(raw ? JSON.parse(raw) : null);
	} catch {
		return DEFAULT_POLISH_OPTIONS;
	}
}

/** Persist the user's polish selections. */
function savePolishOptions(options: PolishOptions): void {
	try {
		localStorage.setItem(POLISH_OPTIONS_STORAGE_KEY, JSON.stringify(options));
	} catch {
		// Ignore storage failures (e.g. private mode); prefs just won't persist.
	}
}

/** Derive a human-friendly guide title from the project file path. */
function deriveProjectTitle(projectPath: string | null): string {
	if (!projectPath) return "Untitled guide";
	const base = projectPath.split(/[\\/]/).pop() ?? "";
	const name = base
		.replace(/\.[^.]+$/, "")
		.replace(/[-_]+/g, " ")
		.trim();
	return name || "Untitled guide";
}

export default function VideoEditor() {
	const {
		state: editorState,
		pushState,
		updateState,
		commitState,
		undo,
		redo,
		resetState,
	} = useEditorHistory(INITIAL_EDITOR_STATE);

	const {
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		trimRegions,
		speedRegions,
		annotationRegions,
		cropRegion,
		wallpaper,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
	} = editorState;

	// Non-undoable state
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [webcamVideoPath, setWebcamVideoPath] = useState<string | null>(null);
	const [webcamVideoSourcePath, setWebcamVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const currentTimeRef = useRef(currentTime);
	currentTimeRef.current = currentTime;
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [isPreviewingZoom, setIsPreviewingZoom] = useState(false);
	const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
	const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
	const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [settingsPanel, setSettingsPanel] = useState<
		"background" | "effects" | "layout" | "cursor" | "export" | "timeline" | undefined
	>(undefined);
	const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
	const [exportQuality, setExportQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_SETTINGS.quality,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(DEFAULT_EXPORT_SETTINGS.format);
	const [mp4FrameRate, setMp4FrameRate] = useState<Mp4FrameRate>(DEFAULT_EXPORT_SETTINGS.frameRate);
	const [encodingMode, setEncodingMode] = useState<EncodingMode>(
		DEFAULT_EXPORT_SETTINGS.encodingMode,
	);
	const [pipelineModel, setPipelineModel] = useState<ExportPipelineModel>(
		DEFAULT_EXPORT_SETTINGS.pipelineModel,
	);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(DEFAULT_GIF_SETTINGS.frameRate);
	const [gifLoop, setGifLoop] = useState(DEFAULT_GIF_SETTINGS.loop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
		DEFAULT_GIF_SETTINGS.sizePreset,
	);
	const [gifVideoOnly, setGifVideoOnly] = useState(DEFAULT_GIF_SETTINGS.videoOnly);
	const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [unsavedExport, setUnsavedExport] = useState<{
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	// AI panel state
	const [showAIPanel, setShowAIPanel] = useState(false);
	const [aiPanelMode, setAIPanelMode] = useState<"chat" | "tools">("chat");
	// Right inspector state (driven by the far-left tool rail)
	const [inspectorOpen, setInspectorOpen] = useState(true);
	const [showCropDialog, setShowCropDialog] = useState(false);
	// Selecting a timeline region reveals its contextual inspector.
	useEffect(() => {
		if (
			selectedZoomId ||
			selectedTrimId ||
			selectedSpeedId ||
			selectedAnnotationId ||
			selectedBlurId
		) {
			setShowAIPanel(false);
			setInspectorOpen(true);
		}
	}, [selectedZoomId, selectedTrimId, selectedSpeedId, selectedAnnotationId, selectedBlurId]);
	// Auto-Polish (Guidde-style one-click production) runs asynchronously.
	const [isAutoPolishing, setIsAutoPolishing] = useState(false);
	const [showPolishSetup, setShowPolishSetup] = useState(false);
	// Background music is temporarily disabled in Magic Polish — force it off even
	// if a saved selection had it on.
	const [polishOptions, setPolishOptions] = useState<PolishOptions>(() => ({
		...loadPolishOptions(),
		music: false,
	}));
	const { isAuthenticated: isBackendAuthed, showLogin } = useBackend();
	// Video (export) is gated to paid plans — free = AI chat only, no video.
	const { isPro: hasActivePlan } = useProGate();
	const [showPublishGate, setShowPublishGate] = useState(false);

	// Persist polish selections so the setup dialog opens pre-filled next time.
	const updatePolishOptions = useCallback((next: PolishOptions) => {
		setPolishOptions(next);
		savePolishOptions(next);
	}, []);
	const [previewWallpaper, setPreviewWallpaper] = useState<string | null>(null);
	const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);
	// Unsaved-changes confirmation for New Project / Load Project.
	// The window-close flow uses showCloseConfirmDialog above.
	const [confirmDialogVariant, setConfirmDialogVariant] = useState<
		"newProject" | "loadProject" | null
	>(null);
	// Fresh-boot Welcome dashboard: shown when the editor opens with nothing to
	// edit. Dismissed by New Project so that flow keeps its in-editor empty state.
	const [welcomeDismissed, setWelcomeDismissed] = useState(false);
	const playerContainerRef = useRef<HTMLDivElement | null>(null);
	const cursorTelemetrySourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
	const { samples: cursorTelemetry, error: cursorTelemetryError } =
		useCursorTelemetry(cursorTelemetrySourcePath);
	const { data: cursorRecordingData, error: cursorRecordingDataError } =
		useCursorRecordingData(cursorTelemetrySourcePath);
	const cursorClickTimestamps = useMemo<number[]>(() => {
		const recordingClicks =
			cursorRecordingData?.samples
				.filter((sample) => isClickInteractionType(sample.interactionType))
				.map((sample) => sample.timeMs) ?? [];
		if (recordingClicks.length > 0) {
			return recordingClicks;
		}

		return cursorTelemetry
			.filter((sample) => isClickInteractionType(sample.interactionType))
			.map((sample) => sample.timeMs);
	}, [cursorRecordingData, cursorTelemetry]);

	// Cursor & motion blur visual settings (non-undoable preferences)
	const [showCursor, setShowCursor] = useState(DEFAULT_CURSOR_SETTINGS.show);
	const [cursorSize, setCursorSize] = useState(DEFAULT_CURSOR_SETTINGS.size);
	const [cursorSmoothing, setCursorSmoothing] = useState(DEFAULT_CURSOR_SETTINGS.smoothing);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(DEFAULT_CURSOR_SETTINGS.motionBlur);
	const [cursorClickBounce, setCursorClickBounce] = useState(DEFAULT_CURSOR_SETTINGS.clickBounce);
	const [cursorClipToBounds, setCursorClipToBounds] = useState(
		DEFAULT_CURSOR_SETTINGS.clipToBounds,
	);
	const [cursorTheme, setCursorTheme] = useState(DEFAULT_CURSOR_SETTINGS.theme);
	const [nativePlatform, setNativePlatform] = useState<NativePlatform | null>(null);
	const [recordingCursorCaptureMode, setRecordingCursorCaptureMode] =
		useState<CursorCaptureMode | null>(null);

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

	const nextZoomIdRef = useRef(1);
	const nextTrimIdRef = useRef(1);
	const nextSpeedIdRef = useRef(1);

	const { shortcuts, isMac } = useShortcuts();
	// Windows recordings include captured cursor assets. macOS hides the system
	// cursor in ScreenCaptureKit and renders telemetry samples with the
	// default arrow asset for the editable overlay.
	const hasEditableCursorRecording =
		recordingCursorCaptureMode === "editable-overlay" &&
		(nativePlatform === "win32" || nativePlatform === "darwin") &&
		hasNativeCursorRecordingData(cursorRecordingData);
	const effectiveShowCursor = showCursor && hasEditableCursorRecording;
	const showCursorSettings = hasEditableCursorRecording;
	const { locale, setLocale, t: rawT } = useI18n();
	const t = useScopedT("editor");
	const ts = useScopedT("settings");
	const availableLocales = getAvailableLocales();

	const nextAnnotationIdRef = useRef(1);
	const nextAnnotationZIndexRef = useRef(1);
	const isAutoCaptioningRef = useRef(false);
	const [isAutoCaptioning, setIsAutoCaptioning] = useState(false);
	const [showAutoCaptionsDialog, setShowAutoCaptionsDialog] = useState(false);
	const [captionWordsMin, setCaptionWordsMin] = useState(2);
	const [captionWordsMax, setCaptionWordsMax] = useState(7);
	const exporterRef = useRef<VideoExporter | null>(null);

	const annotationOnlyRegions = useMemo(
		() => annotationRegions.filter((region) => region.type !== "blur"),
		[annotationRegions],
	);
	const blurRegions = useMemo(
		() => annotationRegions.filter((region) => region.type === "blur"),
		[annotationRegions],
	);

	const currentProjectMedia = useMemo<ProjectMedia | null>(() => {
		const screenVideoPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!screenVideoPath) {
			return null;
		}

		const webcamSourcePath =
			webcamVideoSourcePath ?? (webcamVideoPath ? fromFileUrl(webcamVideoPath) : null);
		return {
			screenVideoPath,
			...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
			...(recordingCursorCaptureMode ? { cursorCaptureMode: recordingCursorCaptureMode } : {}),
		};
	}, [
		videoPath,
		videoSourcePath,
		webcamVideoPath,
		webcamVideoSourcePath,
		recordingCursorCaptureMode,
	]);

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
			if (!validateProjectData(candidate)) {
				return false;
			}

			const project = candidate;
			const projectMedia = resolveProjectMedia(project);
			if (!projectMedia) {
				return false;
			}
			const sourcePath = projectMedia.screenVideoPath;
			const webcamSourcePath = projectMedia.webcamVideoPath ?? null;
			const projectCursorCaptureMode = projectMedia.cursorCaptureMode ?? null;
			const normalizedEditor = normalizeProjectEditor(project.editor);
			const inferredDurationMs = Math.max(
				0,
				...normalizedEditor.zoomRegions.map((region) => region.endMs),
				...normalizedEditor.trimRegions.map((region) => region.endMs),
				...normalizedEditor.speedRegions.map((region) => region.endMs),
				...normalizedEditor.annotationRegions.map((region) => region.endMs),
			);

			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(inferredDurationMs > 0 ? inferredDurationMs / 1000 : 0);

			setError(null);
			setVideoSourcePath(sourcePath);
			setVideoPath(toFileUrl(sourcePath));
			setWebcamVideoSourcePath(webcamSourcePath);
			setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
			setRecordingCursorCaptureMode(projectCursorCaptureMode);
			setCurrentProjectPath(path ?? null);

			// A loaded project keeps its zooms exactly as saved, so never auto-suggest
			// over it (even if it has zero zooms because the user deleted them all).
			autoProcessedSourceRef.current = sourcePath;

			pushState({
				wallpaper: normalizedEditor.wallpaper,
				shadowIntensity: normalizedEditor.shadowIntensity,
				showBlur: normalizedEditor.showBlur,
				showTrimWaveform: normalizedEditor.showTrimWaveform,
				motionBlurAmount: normalizedEditor.motionBlurAmount,
				borderRadius: normalizedEditor.borderRadius,
				padding: normalizedEditor.padding,
				cropRegion: normalizedEditor.cropRegion,
				zoomRegions: normalizedEditor.zoomRegions,
				autoZoomEnabled: normalizedEditor.autoZoomEnabled,
				autoFocusAll: normalizedEditor.autoFocusAll,
				trimRegions: normalizedEditor.trimRegions,
				speedRegions: normalizedEditor.speedRegions,
				annotationRegions: normalizedEditor.annotationRegions,
				aspectRatio: normalizedEditor.aspectRatio,
				webcamLayoutPreset: normalizedEditor.webcamLayoutPreset,
				webcamMaskShape: normalizedEditor.webcamMaskShape,
				webcamMirrored: normalizedEditor.webcamMirrored,
				webcamReactiveZoom: normalizedEditor.webcamReactiveZoom,
				webcamSizePreset: normalizedEditor.webcamSizePreset,
				webcamPosition: normalizedEditor.webcamPosition,
				videoClips: normalizedEditor.videoClips,
				introClip: normalizedEditor.introClip,
			});
			setExportQuality(normalizedEditor.exportQuality);
			setExportFormat(normalizedEditor.exportFormat);
			if (normalizedEditor.encodingMode) {
				setEncodingMode(normalizedEditor.encodingMode);
			}
			if (normalizedEditor.pipelineModel) {
				setPipelineModel(normalizedEditor.pipelineModel);
			}
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);
			setGifVideoOnly(normalizedEditor.gifVideoOnly ?? DEFAULT_GIF_SETTINGS.videoOnly);
			setCursorTheme(normalizedEditor.cursorTheme);

			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				normalizedEditor.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				normalizedEditor.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				normalizedEditor.speedRegions.map((region) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				normalizedEditor.annotationRegions.map((region) => region.id),
			);
			nextAnnotationZIndexRef.current =
				normalizedEditor.annotationRegions.reduce(
					(max, region) => Math.max(max, region.zIndex),
					0,
				) + 1;

			setLastSavedSnapshot(
				createProjectSnapshot(
					{
						screenVideoPath: sourcePath,
						...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
						...(projectCursorCaptureMode ? { cursorCaptureMode: projectCursorCaptureMode } : {}),
					},
					normalizedEditor,
				),
			);
			return true;
		},
		[pushState],
	);

	const currentProjectSnapshot = useMemo(() => {
		if (!currentProjectMedia) {
			return null;
		}
		return createProjectSnapshot(currentProjectMedia, {
			wallpaper,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			trimRegions,
			speedRegions,
			annotationRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			encodingMode,
			pipelineModel,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			gifVideoOnly,
			cursorTheme,
			videoClips: editorState.videoClips,
			introClip: editorState.introClip,
		});
	}, [
		currentProjectMedia,
		cursorTheme,
		wallpaper,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		cropRegion,
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		trimRegions,
		speedRegions,
		annotationRegions,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
		exportQuality,
		exportFormat,
		encodingMode,
		pipelineModel,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		gifVideoOnly,
		editorState.videoClips,
		editorState.introClip,
	]);

	const hasUnsavedChanges = hasProjectUnsavedChanges(currentProjectSnapshot, lastSavedSnapshot);

	useEffect(() => {
		async function loadInitialData() {
			try {
				const currentProjectResult = await nativeBridgeClient.project.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const currentSessionResult = await window.electronAPI.getCurrentRecordingSession();
				if (currentSessionResult.success && currentSessionResult.session) {
					const session = currentSessionResult.session;
					const sourcePath = fromFileUrl(session.screenVideoPath);
					const webcamSourcePath = session.webcamVideoPath
						? fromFileUrl(session.webcamVideoPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setWebcamVideoSourcePath(webcamSourcePath);
					setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
					setRecordingCursorCaptureMode(session.cursorCaptureMode ?? null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot(
							{
								screenVideoPath: sourcePath,
								...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
								...(session.cursorCaptureMode
									? { cursorCaptureMode: session.cursorCaptureMode }
									: {}),
							},
							INITIAL_EDITOR_STATE,
						),
					);
					return;
				}

				const result = await nativeBridgeClient.project.getCurrentVideoPath();
				if (result.success && result.path) {
					setVideoSourcePath(result.path);
					setVideoPath(toFileUrl(result.path));
					setRecordingCursorCaptureMode(null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot({ screenVideoPath: result.path }, INITIAL_EDITOR_STATE),
					);
				}
				// No video/project/session, so leave videoPath null and let the
				// EditorEmptyState dashboard render instead of an error screen.
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	// Avoid overwriting saved prefs with defaults before they've loaded.
	const [prefsHydrated, setPrefsHydrated] = useState(false);

	// Load persisted user preferences on mount (intentionally runs once)
	useEffect(() => {
		const prefs = loadUserPreferences();
		updateState({
			padding: prefs.padding,
			aspectRatio: prefs.aspectRatio,
		});
		setExportQuality(prefs.exportQuality);
		setExportFormat(prefs.exportFormat);
		setPrefsHydrated(true);
	}, [updateState]);

	// Auto-save user preferences when settings change
	useEffect(() => {
		if (!prefsHydrated) return;
		saveUserPreferences({ padding, aspectRatio, exportQuality, exportFormat });
	}, [prefsHydrated, padding, aspectRatio, exportQuality, exportFormat]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return false;
			}

			if (!currentProjectMedia) {
				toast.error(t("errors.unableToDetermineSourcePath"));
				return false;
			}

			const editorStateForSave = {
				wallpaper,
				shadowIntensity,
				showBlur,
				showTrimWaveform,
				motionBlurAmount,
				borderRadius,
				padding,
				cropRegion,
				zoomRegions,
				autoZoomEnabled,
				autoFocusAll,
				trimRegions,
				speedRegions,
				annotationRegions,
				aspectRatio,
				webcamLayoutPreset,
				webcamMaskShape,
				webcamMirrored,
				webcamReactiveZoom,
				webcamSizePreset,
				webcamPosition,
				exportQuality,
				exportFormat,
				encodingMode,
				pipelineModel,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
				gifVideoOnly,
				cursorTheme,
				videoClips: editorState.videoClips,
				introClip: editorState.introClip,
			};
			const projectData = createProjectData(
				currentProjectMedia,
				normalizeProjectEditor(editorStateForSave),
			);

			const fileNameBase =
				currentProjectMedia.screenVideoPath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			// Normalize the same way as currentProjectSnapshot so the post-save
			// baseline compares equal and hasUnsavedChanges clears.
			const projectSnapshot = createProjectSnapshot(currentProjectMedia, editorState);
			const result = await nativeBridgeClient.project.saveProjectFile(
				projectData,
				fileNameBase,
				forceSaveAs ? undefined : (currentProjectPath ?? undefined),
			);

			if (result.canceled) {
				toast.info(t("project.saveCanceled"));
				return false;
			}

			if (!result.success) {
				toast.error(result.message || t("project.failedToSave"));
				return false;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}
			setLastSavedSnapshot(projectSnapshot);

			toast.success(t("project.savedTo", { path: result.path ?? "" }));
			return true;
		},
		[
			currentProjectMedia,
			currentProjectPath,
			wallpaper,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			trimRegions,
			speedRegions,
			annotationRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			encodingMode,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			gifVideoOnly,
			cursorTheme,
			videoPath,
			t,
			editorState.introClip,
			editorState,
			pipelineModel,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
			return saveProject(false);
		});
		return () => cleanup();
	}, [saveProject]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestCloseConfirm(() => {
			setShowCloseConfirmDialog(true);
		});
		return () => cleanup();
	}, []);

	const handleCloseConfirmSave = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("save");
	}, []);

	const handleCloseConfirmDiscard = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("discard");
	}, []);

	const handleCloseConfirmCancel = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("cancel");
	}, []);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleNewRecordingConfirm = useCallback(async () => {
		const result = await window.electronAPI.startNewRecording();
		if (result.success) {
			setShowNewRecordingDialog(false);
		} else {
			console.error("Failed to start new recording:", result.error);
			setError("Failed to start new recording: " + (result.error || "Unknown error"));
		}
	}, []);

	const doLoadProject = useCallback(async () => {
		const result = await nativeBridgeClient.project.loadProjectFile(getProjectFolder());

		if (result.canceled) {
			return;
		}

		if (!result.success) {
			toast.error(result.message || t("project.failedToLoad"));
			return;
		}

		const restored = await applyLoadedProject(result.project, result.path ?? null);
		if (!restored) {
			toast.error(t("project.invalidFormat"));
			return;
		}

		if (result.path) {
			const folder = parentDirectoryOf(result.path);
			if (folder) {
				saveUserPreferences({ projectFolder: folder });
			}
		}

		toast.success(t("project.loadedFrom", { path: result.path ?? "" }));
	}, [applyLoadedProject, t]);

	// Video import via file picker: shared by the Welcome screen and the AI
	// chat's importVideo tool (same flow as EditorEmptyState's import button).
	const importVideoFromPicker = useCallback(async (): Promise<{
		success: boolean;
		path?: string;
		error?: string;
	}> => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled || !result.success || !result.path) {
			return { success: false };
		}

		const setResult = await nativeBridgeClient.project.setCurrentVideoPath(result.path);
		if (!setResult.success) {
			return { success: false, error: "Failed to set current video path" };
		}

		setVideoPath(toFileUrl(result.path));
		setVideoSourcePath(result.path);
		setWebcamVideoPath(null);
		setWebcamVideoSourcePath(null);
		return { success: true, path: result.path };
	}, []);

	const handleWelcomeOpenVideo = useCallback(async () => {
		await importVideoFromPicker();
	}, [importVideoFromPicker]);

	const handleLoadProject = useCallback(async () => {
		if (hasUnsavedChanges) {
			setConfirmDialogVariant("loadProject");
			return;
		}
		await doLoadProject();
	}, [hasUnsavedChanges, doLoadProject]);

	const handleLoadProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doLoadProject();
		}
	}, [saveProject, doLoadProject]);

	const handleLoadProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doLoadProject();
	}, [doLoadProject]);

	// New Project: clear all media/project/editor state back to the empty
	// Studio dashboard. Prompts to save first when there are unsaved changes.
	const doNewProject = useCallback(async () => {
		setWelcomeDismissed(true);
		await nativeBridgeClient.project.clearCurrentVideoPath();
		setVideoPath(null);
		setVideoSourcePath(null);
		setWebcamVideoPath(null);
		setWebcamVideoSourcePath(null);
		setCurrentProjectPath(null);
		setLastSavedSnapshot(null);
		// Reset undoable editor state + undo/redo history to a clean slate.
		resetState();
		// Reset non-undoable selection state.
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedSpeedId(null);
		setSelectedAnnotationId(null);
		setSelectedBlurId(null);
		// Reset playback.
		setCurrentTime(0);
		setIsPlaying(false);
		// Reset cursor preferences to defaults.
		setShowCursor(DEFAULT_CURSOR_SETTINGS.show);
		setCursorSize(DEFAULT_CURSOR_SETTINGS.size);
		setCursorSmoothing(DEFAULT_CURSOR_SETTINGS.smoothing);
		setCursorMotionBlur(DEFAULT_CURSOR_SETTINGS.motionBlur);
		setCursorClickBounce(DEFAULT_CURSOR_SETTINGS.clickBounce);
		setCursorClipToBounds(DEFAULT_CURSOR_SETTINGS.clipToBounds);
		setCursorTheme(DEFAULT_CURSOR_SETTINGS.theme);
		// Reset region ID counters.
		nextZoomIdRef.current = 1;
		nextTrimIdRef.current = 1;
		nextSpeedIdRef.current = 1;
		nextAnnotationIdRef.current = 1;
		nextAnnotationZIndexRef.current = 1;
	}, [resetState]);

	const handleNewProject = useCallback(async () => {
		if (hasUnsavedChanges) {
			setConfirmDialogVariant("newProject");
			return;
		}
		await doNewProject();
	}, [hasUnsavedChanges, doNewProject]);

	const handleNewProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doNewProject();
		}
	}, [saveProject, doNewProject]);

	const handleNewProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doNewProject();
	}, [doNewProject]);

	useEffect(() => {
		const removeNewProjectListener = window.electronAPI.onMenuNewProject(handleNewProject);
		const removeLoadListener = window.electronAPI.onMenuLoadProject(handleLoadProject);
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeNewProjectListener?.();
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleNewProject, handleLoadProject, handleSaveProject, handleSaveProjectAs]);

	useEffect(() => {
		let canceled = false;
		nativeBridgeClient.system
			.getPlatform()
			.then((platform) => {
				if (!canceled) {
					setNativePlatform(platform);
				}
			})
			.catch((error) => {
				console.warn("Unable to resolve native platform for cursor settings:", error);
				if (!canceled) {
					setNativePlatform(null);
				}
			});

		return () => {
			canceled = true;
		};
	}, []);

	useEffect(() => {
		if (cursorTelemetryError) {
			console.warn("Unable to load cursor telemetry:", cursorTelemetryError);
		}
	}, [cursorTelemetryError]);

	useEffect(() => {
		if (cursorRecordingDataError) {
			console.warn("Unable to load cursor recording data:", cursorRecordingDataError);
		}
	}, [cursorRecordingDataError]);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		const introDur = introDurationMs / 1000;

		if (isPlaying) {
			// Pause whichever is active
			if (introClip && currentTime < introDur && playback.introVideo) {
				playback.introVideo.pause();
			}
			playback.pause();
		} else {
			if (introClip && currentTime < introDur && playback.introVideo) {
				// Start intro playback
				const introVideo = playback.introVideo;
				introVideo.currentTime = currentTime;

				const onIntroTimeUpdate = () => {
					const totalTime = introVideo.currentTime;
					setCurrentTime(totalTime);
					if (totalTime >= introDur) {
						// Transition to main video
						introVideo.pause();
						introVideo.removeEventListener("timeupdate", onIntroTimeUpdate);
						introVideo.removeEventListener("ended", onIntroEnded);
						video.currentTime = 0;
						playback.play().catch((err) => console.error("Video play failed:", err));
					}
				};
				const onIntroEnded = () => {
					introVideo.removeEventListener("timeupdate", onIntroTimeUpdate);
					introVideo.removeEventListener("ended", onIntroEnded);
					setCurrentTime(introDur);
					video.currentTime = 0;
					playback.play().catch((err) => console.error("Video play failed:", err));
				};

				introVideo.addEventListener("timeupdate", onIntroTimeUpdate);
				introVideo.addEventListener("ended", onIntroEnded);
				introVideo.play().catch((err) => console.error("Intro play failed:", err));
				setIsPlaying(true);
				return;
			}
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((prev) => !prev);
	}, []);

	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsFullscreen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	function handleSeek(time: number) {
		const introDur = introDurationMs / 1000;

		if (introClip && time < introDur) {
			// Seeking into intro zone — position intro video
			const introVideo = videoPlaybackRef.current?.introVideo;
			if (introVideo) {
				introVideo.currentTime = time;
			}
			setCurrentTime(time);
			return;
		}

		// Seeking into main content zone — adjust time to main-video-relative
		const mainTime = time - introDur;
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		if (editorState.videoClips.length > 0) {
			setCurrentTime(time);
		} else {
			video.currentTime = mainTime;
			setCurrentTime(time);
		}
	}

	const handleSelectZoom = useCallback((id: string | null) => {
		setSelectedZoomId(id);
		if (id) {
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedClipId(null);
		}
	}, []);

	const handleSelectTrim = useCallback((id: string | null) => {
		setSelectedTrimId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedClipId(null);
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
			setSelectedClipId(null);
		}
	}, []);

	const handleSelectBlur = useCallback((id: string | null) => {
		setSelectedBlurId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedSpeedId(null);
			setSelectedClipId(null);
		}
	}, []);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: { cx: 0.5, cy: 0.5 },
				// Auto-Focus on means new zooms follow the cursor too.
				focusMode: autoFocusAll ? "auto" : undefined,
				source: "manual",
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			setSelectedZoomId(id);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState, autoFocusAll],
	);

	// Builds fresh "auto" zoom regions from cursor telemetry without overlapping
	// existing ones. Used by both the on-load auto-suggest pass and the wand toggle.
	const buildAutoZoomRegions = useCallback(
		(existingRegions: ZoomRegion[]): ZoomRegion[] => {
			const totalMs = Math.round(duration * 1000);
			// Telemetry (and therefore each suggestion) is in the primary
			// recording's own time. With clips on the timeline the recording may
			// sit at an offset and be trimmed, so suggestions are projected onto
			// the master timeline through the primary clip and clamped to it.
			const primaryClip = editorState.videoClips.find((clip) => clip.sourceType === "recording");
			const shiftMs = primaryClip ? primaryClip.offsetMs - primaryClip.startMs : 0;
			const clampStartMs = primaryClip ? primaryClip.offsetMs : 0;
			const clampEndMs = primaryClip ? primaryClip.offsetMs + primaryClip.durationMs : totalMs;
			const suggestions = buildAutoZoomSuggestions({
				cursorTelemetry,
				totalMs,
				// Existing regions live on the master timeline — compare them in
				// recording time, where the suggestions are computed.
				existingRegions: shiftMs
					? existingRegions.map((region) => ({
							...region,
							startMs: region.startMs - shiftMs,
							endMs: region.endMs - shiftMs,
						}))
					: existingRegions,
				defaultDurationMs: Math.max(1000, Math.round(totalMs * 0.05)),
			});
			return suggestions
				.map((suggestion) => ({
					id: `zoom-${nextZoomIdRef.current++}`,
					startMs: Math.max(clampStartMs, Math.round(suggestion.span.start + shiftMs)),
					endMs: Math.min(clampEndMs, Math.round(suggestion.span.end + shiftMs)),
					depth: DEFAULT_ZOOM_DEPTH,
					customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
					focus: clampFocusToDepth(suggestion.focus, DEFAULT_ZOOM_DEPTH),
					focusMode: autoFocusAll ? ("auto" as const) : undefined,
					source: "auto" as const,
				}))
				.filter((region) => region.endMs - region.startMs >= 500);
		},
		[cursorTelemetry, duration, autoFocusAll, editorState.videoClips],
	);

	// Auto-suggest zooms once per fresh recording (no existing zooms, telemetry
	// available, wand enabled). Loaded projects are marked processed elsewhere so
	// they're never touched. The ref guard runs this once per source and survives undo.
	const autoProcessedSourceRef = useRef<string | null>(null);
	useEffect(() => {
		if (!autoZoomEnabled || !cursorTelemetrySourcePath) return;
		if (autoProcessedSourceRef.current === cursorTelemetrySourcePath) return;
		if (cursorTelemetry.length < 2 || duration <= 0) return;
		// Only auto-suggest for a fresh recording; don't disturb existing zooms.
		if (zoomRegions.length > 0) {
			autoProcessedSourceRef.current = cursorTelemetrySourcePath;
			return;
		}
		const newRegions = buildAutoZoomRegions([]);
		autoProcessedSourceRef.current = cursorTelemetrySourcePath;
		if (newRegions.length === 0) return;
		pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, ...newRegions] }));
	}, [
		autoZoomEnabled,
		cursorTelemetrySourcePath,
		cursorTelemetry,
		duration,
		zoomRegions,
		buildAutoZoomRegions,
		pushState,
	]);

	// Wand toggle: ON regenerates suggestions around existing zooms; OFF removes
	// only untouched auto zooms (manual and edited-to-manual survive).
	const handleToggleAutoZoom = useCallback(
		(enabled: boolean) => {
			if (enabled) {
				autoProcessedSourceRef.current = cursorTelemetrySourcePath;
				pushState((prev) => ({
					autoZoomEnabled: true,
					zoomRegions: [...prev.zoomRegions, ...buildAutoZoomRegions(prev.zoomRegions)],
				}));
			} else {
				pushState((prev) => ({
					autoZoomEnabled: false,
					zoomRegions: prev.zoomRegions.filter((region) => region.source !== "auto"),
				}));
			}
		},
		[pushState, buildAutoZoomRegions, cursorTelemetrySourcePath],
	);

	// Flip every zoom between auto (cursor-follow) and manual at once.
	const handleToggleAutoFocusAll = useCallback(
		(on: boolean) => {
			pushState((prev) => ({
				autoFocusAll: on,
				zoomRegions: prev.zoomRegions.map((region) => ({
					...region,
					focusMode: on ? "auto" : "manual",
				})),
			}));
		},
		[pushState],
	);

	const handleTrimAdded = useCallback(
		(span: Span) => {
			const id = `trim-${nextTrimIdRef.current++}`;
			const newRegion: TrimRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
			};
			pushState((prev) => ({ trimRegions: [...prev.trimRegions, newRegion] }));
			setSelectedTrimId(id);
			setSelectedZoomId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleZoomSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
								source: "manual",
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleTrimSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	// Focus drag: updateState for live preview, commitState on pointer-up.
	const handleZoomFocusChange = useCallback(
		(id: string, focus: ZoomFocus) => {
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? { ...region, focus: clampFocusToDepth(focus, region.depth), source: "manual" }
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? {
								...region,
								depth,
								customScale: ZOOM_DEPTH_SCALES[depth],
								focus: clampFocusToDepth(region.focus, depth),
								source: "manual",
							}
						: region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomCustomScaleChange = useCallback(
		(scale: number) => {
			if (!selectedZoomId) return;
			const rounded = Math.round(scale * 100) / 100;
			if (!Number.isFinite(rounded)) return;
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? { ...region, customScale: rounded, source: "manual" }
						: region,
				),
			}));
		},
		[selectedZoomId, updateState],
	);

	const handleZoomCustomScaleCommit = useCallback(() => {
		commitState();
	}, [commitState]);

	const handleZoomFocusModeChange = useCallback(
		(focusMode: ZoomFocusMode) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId ? { ...region, focusMode, source: "manual" } : region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.filter((r) => r.id !== id),
			}));
			if (selectedZoomId === id) {
				setSelectedZoomId(null);
			}
		},
		[selectedZoomId, pushState],
	);

	const handleZoomRotationPresetChange = useCallback(
		(preset: Rotation3DPreset | null) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) => {
					if (region.id !== selectedZoomId) return region;
					if (preset === null) {
						const { rotationPreset: _p, ...rest } = region;
						return { ...rest, source: "manual" };
					}
					return { ...region, rotationPreset: preset, source: "manual" };
				}),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.filter((r) => r.id !== id),
			}));
			if (selectedTrimId === id) {
				setSelectedTrimId(null);
			}
		},
		[selectedTrimId, pushState],
	);

	const handleSelectSpeed = useCallback((id: string | null) => {
		setSelectedSpeedId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedClipId(null);
		}
	}, []);

	const handleSpeedAdded = useCallback(
		(span: Span) => {
			const id = `speed-${nextSpeedIdRef.current++}`;
			const newRegion: SpeedRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				speed: DEFAULT_PLAYBACK_SPEED,
			};
			pushState((prev) => ({
				speedRegions: [...prev.speedRegions, newRegion],
			}));
			setSelectedSpeedId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleSpeedSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.filter((region) => region.id !== id),
			}));
			if (selectedSpeedId === id) {
				setSelectedSpeedId(null);
			}
		},
		[selectedSpeedId, pushState],
	);

	// ── Multi-clip handlers ──

	const handleAddVideoClip = useCallback(async () => {
		try {
			const result = await window.electronAPI.openVideoFilePicker?.();
			if (!result?.success || !result.path) return;

			// Probe video duration via temporary video element
			const clipUrl = toFileUrl(result.path);
			const probeDurationMs = await new Promise<number>((resolve) => {
				const tempVideo = document.createElement("video");
				tempVideo.preload = "metadata";
				tempVideo.onloadedmetadata = () => {
					const dur = tempVideo.duration;
					tempVideo.remove();
					resolve(Number.isFinite(dur) ? dur * 1000 : 10000);
				};
				tempVideo.onerror = () => {
					tempVideo.remove();
					resolve(10000);
				};
				tempVideo.src = clipUrl;
			});

			let clips = [...editorState.videoClips];
			const primaryDurationMs = duration * 1000;

			// When adding the first clip, also insert the primary recording as clip #1
			// so both appear side-by-side on the timeline (like CapCut)
			const primaryPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
			if (clips.length === 0 && primaryPath) {
				clips.push({
					id: "primary-recording",
					sourceVideoPath: primaryPath,
					startMs: 0,
					endMs: primaryDurationMs,
					offsetMs: 0,
					durationMs: primaryDurationMs,
					label: primaryPath.split(/[\\/]/).pop() || "Recording",
					sourceType: "recording",
				});
			}

			const masterEnd =
				clips.length > 0
					? Math.max(primaryDurationMs, ...clips.map((c) => c.offsetMs + c.durationMs))
					: primaryDurationMs;

			const newClip: VideoClip = {
				id: `clip-${Date.now()}`,
				sourceVideoPath: result.path,
				startMs: 0,
				endMs: probeDurationMs,
				offsetMs: masterEnd,
				durationMs: probeDurationMs,
				label: result.path.split(/[\\/]/).pop() || "Untitled Clip",
				sourceType: "imported",
			};

			pushState({ videoClips: [...clips, newClip] });
			toast.success("Video clip added to timeline");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to add video clip");
		}
	}, [editorState.videoClips, duration, videoSourcePath, videoPath, pushState]);

	const handleClipSpanChange = useCallback(
		(id: string, span: { start: number; end: number }) => {
			pushState((prev) => ({
				videoClips: prev.videoClips.map((clip) => {
					if (clip.id !== id) return clip;

					const newOffsetMs = Math.max(0, span.start);
					const newTimelineDuration = span.end - span.start;

					// If duration unchanged, this is a pure drag (reposition)
					if (Math.abs(newTimelineDuration - clip.durationMs) < 1) {
						return { ...clip, offsetMs: newOffsetMs };
					}

					// Duration changed = user is resizing/trimming the clip
					const leftDelta = newOffsetMs - clip.offsetMs;
					const oldEndOnTimeline = clip.offsetMs + clip.durationMs;
					const rightDelta = span.end - oldEndOnTimeline;

					let newStartMs = clip.startMs;
					let newEndMs = clip.endMs;

					// Left edge moved = trim the start of source video
					if (Math.abs(leftDelta) > 0.5) {
						newStartMs = Math.max(0, clip.startMs + leftDelta);
					}

					// Right edge moved = trim the end of source video
					if (Math.abs(rightDelta) > 0.5) {
						newEndMs = clip.endMs + rightDelta;
					}

					// Ensure valid range
					if (newStartMs >= newEndMs) {
						newEndMs = newStartMs + 1;
					}

					return {
						...clip,
						offsetMs: newOffsetMs,
						durationMs: Math.max(1, newEndMs - newStartMs),
						startMs: newStartMs,
						endMs: newEndMs,
					};
				}),
			}));
		},
		[pushState],
	);

	const handleClipDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				videoClips: prev.videoClips.filter((clip) => clip.id !== id),
			}));
			if (selectedClipId === id) {
				setSelectedClipId(null);
			}
		},
		[selectedClipId, pushState],
	);

	const handleSelectClip = useCallback((id: string | null) => {
		setSelectedClipId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	// Master timeline duration: max of primary video and furthest clip end
	const masterDuration = useMemo(() => {
		const clips = editorState.videoClips;
		if (clips.length === 0) return duration;
		const furthestClipEndSec = Math.max(...clips.map((c) => (c.offsetMs + c.durationMs) / 1000));
		return Math.max(duration, furthestClipEndSec);
	}, [duration, editorState.videoClips]);

	// Intro clip is isolated from main timeline
	const introClip = editorState.introClip;
	const introDurationMs = introClip ? introClip.durationMs : 0;

	// Total duration includes intro prefix + main content
	const totalDuration = useMemo(() => {
		return masterDuration + introDurationMs / 1000;
	}, [masterDuration, introDurationMs]);

	const isInIntroPhase = introClip != null && currentTime < introDurationMs / 1000;

	const handleInsertIntroClip = useCallback(
		(clip: VideoClip) => {
			pushState({ introClip: { ...clip, offsetMs: 0 } });
			toast.success(editorState.introClip ? "Intro replaced" : "Intro added to project");
		},
		[editorState.introClip, pushState],
	);

	const handleDeleteIntroClip = useCallback(() => {
		pushState({ introClip: null });
		toast.success("Intro removed");
	}, [pushState]);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === selectedSpeedId ? { ...region, speed } : region,
				),
			}));
		},
		[selectedSpeedId, pushState],
	);

	const handleAnnotationAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "text",
				content: "Enter text...",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			setSelectedAnnotationId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleBlurAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "blur",
				content: "",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
				blurData: { ...DEFAULT_BLUR_DATA },
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			setSelectedBlurId(id);
			setSelectedAnnotationId(null);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
		},
		[pushState],
	);

	const handleAnnotationSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => {
				const editedAutoCaption =
					prev.annotationRegions.find((region) => region.id === id)?.annotationSource ===
					"auto-caption";
				const next = prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				);
				return {
					annotationRegions: editedAutoCaption ? reconcileAutoCaptionTimelineGaps(next) : next,
				};
			});
		},
		[pushState],
	);

	const handleAnnotationDuplicate = useCallback(
		(id: string) => {
			const duplicateId = `annotation-${nextAnnotationIdRef.current++}`;
			const duplicateZIndex = nextAnnotationZIndexRef.current++;
			pushState((prev) => {
				const source = prev.annotationRegions.find((region) => region.id === id);
				if (!source) return {};

				const { annotationSource: _stripCaptionLink, ...sourceWithoutCaptionLink } = source;

				const duplicate: AnnotationRegion = {
					...sourceWithoutCaptionLink,
					id: duplicateId,
					zIndex: duplicateZIndex,
					position: { x: source.position.x + 4, y: source.position.y + 4 },
					size: { ...source.size },
					style: { ...source.style },
					figureData: source.figureData ? { ...source.figureData } : undefined,
				};

				return { annotationRegions: [...prev.annotationRegions, duplicate] };
			});
			setSelectedAnnotationId(duplicateId);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.filter((r) => r.id !== id),
			}));
			if (selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
			}
			if (selectedBlurId === id) {
				setSelectedBlurId(null);
			}
		},
		[selectedAnnotationId, selectedBlurId, pushState],
	);

	const handleAnnotationContentChange = useCallback(
		(id: string, content: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					if (region.type === "text") {
						return { ...region, content, textContent: content };
					} else if (region.type === "image") {
						return { ...region, content, imageContent: content };
					}
					return { ...region, content };
				}),
			}));
		},
		[pushState],
	);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					const updatedRegion = { ...region, type };
					if (type === "text") {
						updatedRegion.content = region.textContent || "Enter text...";
					} else if (type === "image") {
						updatedRegion.content = region.imageContent || "";
					} else if (type === "figure") {
						updatedRegion.content = "";
						if (!region.figureData) {
							updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
						}
					} else if (type === "blur") {
						updatedRegion.content = "";
						if (!region.blurData) {
							updatedRegion.blurData = { ...DEFAULT_BLUR_DATA };
						}
					}
					return updatedRegion;
				}),
			}));

			if (type === "blur" && selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
				setSelectedBlurId(id);
				setSelectedSpeedId(null);
			} else if (type !== "blur" && selectedBlurId === id) {
				setSelectedBlurId(null);
				setSelectedAnnotationId(id);
			}
		},
		[pushState, selectedAnnotationId, selectedBlurId],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			pushState((prev) => {
				const touched = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = touched?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, style: { ...region.style, ...style } };
						}
						return region.id === id ? { ...region, style: { ...region.style, ...style } } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationFigureDataChange = useCallback(
		(id: string, figureData: FigureData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, figureData } : region,
				),
			}));
		},
		[pushState],
	);

	const handleBlurDataPreviewChange = useCallback(
		(id: string, blurData: BlurData) => {
			updateState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								// Freehand drawing area is the full video surface.
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleBlurDataPanelChange = useCallback(
		(id: string, blurData: BlurData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			pushState((prev) => {
				const moved = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = moved?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, position };
						}
						return region.id === id ? { ...region, position } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			pushState((prev) => {
				const resized = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = resized?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, size };
						}
						return region.id === id ? { ...region, size } : region;
					}),
				};
			});
		},
		[pushState],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();

			if (mod && key === "z" && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				undo();
				return;
			}
			if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
				e.preventDefault();
				e.stopPropagation();
				redo();
				return;
			}

			// Frame-step navigation (arrow keys, no modifiers)
			if (
				(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.shiftKey &&
				!e.altKey
			) {
				const target = e.target;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement ||
					(target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest('[role="separator"], [role="slider"], [role="spinbutton"]')))
				) {
					return;
				}
				e.preventDefault();
				const video = videoPlaybackRef.current?.video;
				if (!video) {
					return;
				}
				const direction = e.key === "ArrowLeft" ? "backward" : "forward";
				const newTime = computeFrameStepTime(
					video.currentTime,
					Number.isFinite(video.duration) ? video.duration : durationRef.current,
					direction,
				);
				video.currentTime = newTime;
				return;
			}

			const isInput =
				e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

			if (e.key === "Tab" && !isInput) {
				e.preventDefault();
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				// Let space pass through inside inputs/textareas.
				if (isInput) {
					return;
				}
				e.preventDefault();
				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					playback.video.paused ? playback.play().catch(console.error) : playback.pause();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [undo, redo, shortcuts, isMac]);

	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
			setSelectedZoomId(null);
		}
	}, [selectedZoomId, zoomRegions]);

	useEffect(() => {
		if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
			setSelectedTrimId(null);
		}
	}, [selectedTrimId, trimRegions]);

	useEffect(() => {
		if (
			selectedAnnotationId &&
			!annotationOnlyRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
		if (selectedBlurId && !blurRegions.some((region) => region.id === selectedBlurId)) {
			setSelectedBlurId(null);
		}
	}, [selectedAnnotationId, selectedBlurId, annotationOnlyRegions, blurRegions]);

	useEffect(() => {
		if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
			setSelectedSpeedId(null);
		}
	}, [selectedSpeedId, speedRegions]);

	const handleShowExportedFile = useCallback(async (filePath: string) => {
		try {
			const result = await window.electronAPI.revealInFolder(filePath);
			if (!result.success) {
				const errorMessage = result.error || result.message || "Failed to reveal item in folder.";
				console.error("Failed to reveal in folder:", errorMessage);
				toast.error(errorMessage);
			}
		} catch (error) {
			const errorMessage = String(error);
			console.error("Error calling revealInFolder IPC:", errorMessage);
			toast.error(`Error revealing in folder: ${errorMessage}`);
		}
	}, []);

	// AI narration and the music bed play in the preview from audio files;
	// exports must carry them too. Maps master-timeline positions onto the
	// exported timeline (trims compress time) and lays the audio over the
	// finished file via FFmpeg — narration on top, music looped at its set
	// volume and ducked while narration speaks. Video stream copied.
	const muxNarrationIntoExport = useCallback(
		async (filePath: string): Promise<void> => {
			if (!window.electronAPI?.muxNarrationAudio) return;
			const segments = editorState.narrationTrack?.segments ?? [];
			// Only local files can be muxed (blob:/http URLs come from web preview).
			const isLocal = (p: string) => !/^(https?|blob|data):/.test(p);
			const muxable = segments.filter((s) => s.audioPath && isLocal(s.audioPath));

			const trims = [...editorState.trimRegions].sort((a, b) => a.startMs - b.startMs);
			const toExportTime = (masterMs: number): number => {
				let removed = 0;
				for (const trim of trims) {
					if (masterMs >= trim.endMs) {
						removed += trim.endMs - trim.startMs;
					} else if (masterMs > trim.startMs) {
						// Inside a cut — surface at the cut point.
						return trim.startMs - removed;
					}
				}
				return masterMs - removed;
			};

			const muxSegments = muxable
				.filter((s) => s.audioPath)
				.map((s) => ({ audioPath: s.audioPath as string, offsetMs: toExportTime(s.startMs) }));

			const musicPath = editorState.backgroundMusic;
			const music =
				musicPath && musicPath !== "none" && isLocal(musicPath)
					? {
							audioPath: musicPath,
							volume: (editorState.backgroundMusicVolume ?? 18) / 100,
							duckWindows: muxSegments.map((s, i) => ({
								startMs: s.offsetMs,
								endMs: toExportTime(muxable[i].endMs),
							})),
						}
					: null;
			const muteOriginal = editorState.muteOriginalAudio;
			if (muxSegments.length === 0 && !music && !muteOriginal) return;

			const result = await window.electronAPI.muxNarrationAudio(
				filePath,
				muxSegments,
				music,
				muteOriginal,
			);
			if (!result.success) {
				// The video itself is fine — the AI audio just isn't in it.
				toast.warning("Exported without narration/music audio", {
					description: result.error || "Audio mux failed",
				});
			}
		},
		[
			editorState.narrationTrack,
			editorState.trimRegions,
			editorState.backgroundMusic,
			editorState.backgroundMusicVolume,
			editorState.muteOriginalAudio,
		],
	);

	const handleExportSaved = useCallback(
		(formatLabel: "GIF" | "Video", filePath: string) => {
			setExportedFilePath(filePath);
			const folder = parentDirectoryOf(filePath);
			if (folder) {
				saveUserPreferences({ exportFolder: folder });
			}
			const announce = () =>
				toast.success(
					t("export.exportedSuccessfully", {
						format: formatLabel,
					}),
					{
						description: filePath,
						action: {
							label: rawT("common.actions.showInFolder"),
							onClick: () => {
								void handleShowExportedFile(filePath);
							},
						},
					},
				);
			if (formatLabel === "Video") {
				void muxNarrationIntoExport(filePath).finally(announce);
			} else {
				announce();
			}
		},
		[handleShowExportedFile, t, rawT, muxNarrationIntoExport],
	);

	const handleSaveUnsavedExport = useCallback(async () => {
		if (!unsavedExport) return;
		try {
			const pickResult = await window.electronAPI.pickExportSavePath(
				unsavedExport.fileName,
				getExportFolder(),
			);
			if (pickResult.canceled || !pickResult.success || !pickResult.path) {
				toast.info("Export canceled");
				return;
			}
			const saveResult = await window.electronAPI.writeExportToPath(
				unsavedExport.arrayBuffer,
				pickResult.path,
			);
			if (saveResult.success && saveResult.path) {
				setUnsavedExport(null);
				if (unsavedExport.format === "gif" && window.electronAPI.optimizeGif) {
					await window.electronAPI
						.optimizeGif(saveResult.path, gifLoop, gifSizePreset)
						.catch((err) => {
							console.warn("[VideoEditor] GIF optimization skipped:", err);
						});
				}
				handleExportSaved(unsavedExport.format === "gif" ? "GIF" : "Video", saveResult.path);
			} else {
				toast.error(
					buildSaveDiagnosticMessage(
						unsavedExport.format === "gif" ? "GIF" : "Video",
						saveResult.message || "Failed to save export",
					),
				);
			}
		} catch (error) {
			console.error("Error saving unsaved export:", error);
			toast.error(
				buildSaveDiagnosticMessage(
					unsavedExport.format === "gif" ? "GIF" : "Video",
					error instanceof Error ? error.message : "Failed to save exported video",
				),
			);
		}
	}, [unsavedExport, handleExportSaved, gifLoop, gifSizePreset]);

	// Video export is a paid feature: free accounts get AI chat only, no video.
	// Requires sign-in + an active plan (Starter or above). AI usage inside the
	// editor is metered separately by the backend (per-plan / credits).
	const ensurePublishAllowed = useCallback((): boolean => {
		if (!isBackendAuthed) {
			toast.info("Sign in to export video.");
			showLogin();
			return false;
		}
		if (!hasActivePlan) {
			// Free tier — offer upgrade.
			setShowPublishGate(true);
			return false;
		}
		return true;
	}, [isBackendAuthed, hasActivePlan, showLogin]);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return;
			}

			// Pick the save path before exporting, otherwise the save dialog can end up
			// hidden behind other windows after a long-running export.
			const isGifFormat = settings.format === "gif";

			// Video export is a paid feature (GIFs are exempt).
			if (!isGifFormat && !ensurePublishAllowed()) {
				setShowExportDialog(false);
				return;
			}

			const targetFileName = `export-${Date.now()}.${isGifFormat ? "gif" : "mp4"}`;
			const pickResult = await window.electronAPI.pickExportSavePath(
				targetFileName,
				getExportFolder(),
			);
			if (pickResult.canceled || !pickResult.success || !pickResult.path) {
				setShowExportDialog(false);
				return;
			}
			const targetPath = pickResult.path;

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);

			let flattenedTempPath: string | null = null;

			try {
				const wasPlaying = isPlaying;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				// ── Multi-clip: flatten the timeline into one intermediate video ──
				// The exporters decode a single source file, so a multi-clip timeline
				// is cut+concatenated with FFmpeg first, and all master-time effect
				// data is remapped onto the flattened timeline.
				let exportVideoUrl = videoPath;
				let exportSourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
				let exportZoomRegions = zoomRegions;
				let exportTrimRegions = trimRegions;
				let exportSpeedRegions = speedRegions;
				let exportAnnotationRegions = annotationRegions;
				let exportCursorTelemetry = cursorTelemetry ?? cursorRecordingData?.samples;
				let exportDurationMs = duration * 1000;

				let fullClipPlan: ClipFlattenPlan | null = null;
				if (editorState.videoClips.length > 0) {
					if (!window.electronAPI.flattenVideoClips) {
						throw new Error("Multi-clip export is not supported in this build");
					}
					const plan = buildClipFlattenPlan(editorState.videoClips);
					if (plan.segments.length > 0) {
						fullClipPlan = plan;
						// Remap master-time data onto the flattened timeline (pure math);
						// the actual FFmpeg flatten is deferred until a consumer needs the
						// combined file — the smart-render path cuts from the original
						// sources instead and skips it entirely.
						exportZoomRegions = remapSpanRegions(zoomRegions, plan);
						exportTrimRegions = remapSpanRegions(trimRegions, plan);
						exportSpeedRegions = remapSpanRegions(speedRegions, plan);
						exportAnnotationRegions = remapSpanRegions(annotationRegions, plan);
						if (exportCursorTelemetry) {
							const primarySourcePath =
								videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
							exportCursorTelemetry = primarySourcePath
								? remapPrimaryCursorTelemetry(exportCursorTelemetry, primarySourcePath, plan)
								: [];
						}
						exportDurationMs = plan.flattenedDurationMs;
					}
				}

				const ensureFlattenedSource = async () => {
					if (!fullClipPlan || flattenedTempPath) return;
					setExportProgress({
						currentFrame: 0,
						totalFrames: 1,
						percentage: 2,
						estimatedTimeRemaining: 0,
					});
					const flattenResult = await window.electronAPI.flattenVideoClips(
						toFlattenIpcSegments(fullClipPlan),
					);
					if (!flattenResult.success || !flattenResult.tempPath) {
						throw new Error(flattenResult.error || "Failed to combine timeline clips for export");
					}
					flattenedTempPath = flattenResult.tempPath;
					exportVideoUrl = toFileUrl(flattenResult.tempPath);
					exportSourcePath = flattenResult.tempPath;
				};

				const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
				const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
					sourceWidth,
					sourceHeight,
					cropRegion,
				);
				// Preview container dimensions, used for scaling.
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const previewHeight = containerElement?.clientHeight || DEFAULT_SOURCE_DIMENSIONS.height;

				if (settings.format === "gif" && settings.gifConfig) {
					await ensureFlattenedSource();

					// Video-only fast path: convert the raw recording straight to GIF
					// with FFmpeg, skipping the wallpaper/zoom/cursor compositor.
					// Trim regions and crop still apply. Produces much smaller files
					// because only the recording's own pixels change frame to frame.
					if (settings.gifConfig.videoOnly) {
						const localSourcePath = exportSourcePath;
						if (localSourcePath && window.electronAPI?.convertVideoToGif) {
							console.log("[VideoEditor] Using direct FFmpeg GIF conversion (video only)");
							setExportProgress({
								currentFrame: 0,
								totalFrames: 1,
								percentage: 10,
								estimatedTimeRemaining: 0,
							});

							// Compute kept segments from trim regions
							const totalDurationMs = exportDurationMs;
							const sortedTrims = [...exportTrimRegions].sort((a, b) => a.startMs - b.startMs);
							const keptSegments: Array<{ startMs: number; endMs: number }> = [];
							let trimCursor = 0;
							for (const trim of sortedTrims) {
								if (trimCursor < trim.startMs) {
									keptSegments.push({ startMs: trimCursor, endMs: trim.startMs });
								}
								trimCursor = Math.max(trimCursor, trim.endMs);
							}
							if (trimCursor < totalDurationMs) {
								keptSegments.push({ startMs: trimCursor, endMs: totalDurationMs });
							}

							const convertResult = await window.electronAPI.convertVideoToGif(
								localSourcePath,
								targetPath,
								{
									fps: settings.gifConfig.frameRate,
									width: settings.gifConfig.width,
									height: settings.gifConfig.height,
									loop: settings.gifConfig.loop,
									sizePreset: settings.gifConfig.sizePreset,
									segments: exportTrimRegions.length > 0 ? keptSegments : undefined,
									crop: cropRegion,
								},
							);

							if (convertResult.success) {
								setExportProgress({
									currentFrame: 1,
									totalFrames: 1,
									percentage: 100,
									estimatedTimeRemaining: 0,
								});
								handleExportSaved("GIF", targetPath);
								return;
							}
							console.warn(
								"[VideoEditor] Direct GIF conversion failed, falling back to standard export:",
								convertResult.error,
							);
							toast.warning(
								"Direct GIF conversion failed — exporting with the standard renderer instead",
							);
							// Fall through to the standard GIF pipeline below
						}
					}

					// GIF Export
					const gifExporter = new GifExporter({
						videoUrl: exportVideoUrl,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						wallpaper,
						zoomRegions: exportZoomRegions,
						trimRegions: exportTrimRegions,
						speedRegions: exportSpeedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						backgroundBlur: showBlur ? 1 : 0,
						borderRadius,
						padding,
						videoPadding: padding,
						cropRegion,
						cursorTelemetry: exportCursorTelemetry,
						showCursor: effectiveShowCursor,
						cursorSize: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						annotationRegions: exportAnnotationRegions,
						previewWidth,
						previewHeight,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.writeExportToPath(arrayBuffer, targetPath);

						if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							// Post-compress with FFmpeg (inter-frame diff optimization
							// gif.js can't do). Best-effort: the saved GIF is already
							// valid, so a failure here is not an export failure.
							if (window.electronAPI.optimizeGif) {
								const optimizeResult = await window.electronAPI
									.optimizeGif(
										saveResult.path,
										settings.gifConfig.loop,
										settings.gifConfig.sizePreset,
									)
									.catch((err) => ({ success: false as const, error: String(err) }));
								if (!optimizeResult.success) {
									console.warn("[VideoEditor] GIF optimization skipped:", optimizeResult.error);
									toast.warning(
										"GIF compression pass failed — the file was saved but may be larger than expected",
									);
								}
							}
							handleExportSaved("GIF", saveResult.path);
						} else {
							setUnsavedExport({ arrayBuffer, fileName: targetFileName, format: "gif" });
							const message = buildSaveDiagnosticMessage(
								"GIF",
								saveResult.message || "Failed to save GIF",
							);
							setExportError(message);
							toast.error(message);
						}
					} else {
						const message = buildExportDiagnosticMessage({
							formatLabel: "GIF",
							reason: result.error || "GIF export failed",
							sourcePath: videoSourcePath ?? videoPath,
							width: settings.gifConfig.width,
							height: settings.gifConfig.height,
							frameRate: settings.gifConfig.frameRate,
						});
						setExportError(message);
						toast.error(message);
					}
				} else {
					// MP4 Export

					// Fast paths: when the export has no visual effects, skip the full
					// WebCodecs decode+render+encode pipeline entirely.
					// - No edits at all → FFmpeg remux (stream copy, near-instant)
					// - Trims only → FFmpeg cut + hardware re-encode
					const isDefaultCrop =
						cropRegion.x === 0 &&
						cropRegion.y === 0 &&
						cropRegion.width === 1 &&
						cropRegion.height === 1;

					const quality = settings.quality || exportQuality;
					const exportFps = settings.mp4FrameRate || mp4FrameRate;
					const {
						width: exportWidth,
						height: exportHeight,
						bitrate,
					} = calculateMp4ExportSettings({
						quality,
						sourceWidth: effectiveSourceDimensions.width,
						sourceHeight: effectiveSourceDimensions.height,
						frameRate: exportFps,
						encodingMode,
					});

					// ── Smart render ──
					// When no setting touches every frame (cursor, padding, shadow,
					// radius, crop, webcam, intro), frames outside effect regions are
					// identical to the source. Only effect spans go through the heavy
					// renderer; the rest is cut straight from the source(s) with FFmpeg
					// and joined. Any failure falls back to the full render below.
					const smartEligible =
						Boolean(window.electronAPI?.assembleSmartExport) &&
						!effectiveShowCursor &&
						!webcamVideoPath &&
						!editorState.introClip?.introConfig?.config &&
						isDefaultCrop &&
						shadowIntensity === 0 &&
						borderRadius === 0 &&
						(padding === 0 || padding === undefined) &&
						exportSpeedRegions.length === 0 &&
						(exportZoomRegions.length > 0 || exportAnnotationRegions.length > 0) &&
						(fullClipPlan !== null || exportSourcePath !== null);

					const smartPlan = smartEligible
						? buildSmartRenderPlan({
								durationMs: exportDurationMs,
								effectSpans: buildEffectSpans({
									durationMs: exportDurationMs,
									zoomRegions: exportZoomRegions,
									annotationRegions: exportAnnotationRegions,
								}),
								trimRegions: exportTrimRegions,
							})
						: null;

					if (smartPlan) {
						let miniFlattenTempPath: string | null = null;
						try {
							console.log(
								`[VideoEditor] Smart render: ${Math.round(smartPlan.renderCoverage * 100)}% of the timeline rendered, the rest copied from source`,
							);
							const renderSpans = smartPlan.segments.filter((segment) => segment.kind === "render");

							// Frame-aligned boundaries shared by the renderer (forced
							// keyframes) and the assembler (stream-copy cut points).
							const frameDurationUs = 1_000_000 / exportFps;
							const alignToFrameUs = (ms: number) =>
								Math.ceil((ms * 1000) / frameDurationUs - 1e-6) * frameDurationUs;
							const renderedCuts = smartPlan.renderOutputSpans.map((span) => ({
								kind: "rendered" as const,
								startMs: alignToFrameUs(span.startMs) / 1000,
								endMs: alignToFrameUs(span.endMs) / 1000,
							}));

							// What the render pass consumes: for a single source, the source
							// itself with everything but the render spans trimmed away; for
							// multi-clip, a mini-flatten containing only the render spans.
							let renderVideoUrl = exportVideoUrl;
							let renderTrimRegions: TrimRegion[] = smartPlan.renderTrimRegions.map(
								(span, index) => ({ id: `smart-trim-${index}`, ...span }),
							);
							let renderZoomRegions = exportZoomRegions;
							let renderAnnotationRegions = exportAnnotationRegions;
							if (fullClipPlan) {
								const miniPlan = sliceFlattenPlanFlat(fullClipPlan, renderSpans);
								const miniResult = await window.electronAPI.flattenVideoClips(
									toFlattenIpcSegments(miniPlan),
								);
								if (!miniResult.success || !miniResult.tempPath) {
									throw new Error(miniResult.error || "Failed to prepare effect spans");
								}
								miniFlattenTempPath = miniResult.tempPath;
								renderVideoUrl = toFileUrl(miniResult.tempPath);
								renderTrimRegions = [];
								renderZoomRegions = remapSpanRegions(exportZoomRegions, miniPlan);
								renderAnnotationRegions = remapSpanRegions(exportAnnotationRegions, miniPlan);
							}

							const smartExporter = new VideoExporter({
								videoUrl: renderVideoUrl,
								width: exportWidth,
								height: exportHeight,
								frameRate: exportFps,
								bitrate,
								codec: "avc1.640033",
								encodingMode,
								wallpaper,
								zoomRegions: renderZoomRegions,
								trimRegions: renderTrimRegions,
								speedRegions: [],
								showShadow: false,
								shadowIntensity: 0,
								backgroundBlur: 0,
								borderRadius: 0,
								padding: 0,
								cropRegion,
								showCursor: false,
								cursorSize: 0,
								annotationRegions: renderAnnotationRegions,
								previewWidth,
								previewHeight,
								forceKeyframeTimestampsUs: smartPlan.renderOutputSpans.map((span) =>
									alignToFrameUs(span.startMs),
								),
								onProgress: (progress: ExportProgress) => {
									setExportProgress(progress);
								},
							});

							exporterRef.current = smartExporter;
							const renderResult = await smartExporter.export();
							if (!renderResult.success) {
								throw new Error(renderResult.error || "Smart render pass failed");
							}

							// Stage the rendered spans on disk for the assembler.
							let renderedPath: string;
							if (renderResult.tempFilePath) {
								renderedPath = renderResult.tempFilePath;
							} else if (renderResult.blob) {
								const arrayBuffer = await renderResult.blob.arrayBuffer();
								const stagePath = `${targetPath}.rendered.tmp.mp4`;
								const stageResult = await window.electronAPI.writeExportToPath(
									arrayBuffer,
									stagePath,
								);
								if (!stageResult.success || !stageResult.path) {
									throw new Error(stageResult.message || "Failed to stage rendered spans");
								}
								renderedPath = stagePath;
							} else {
								throw new Error("Smart render pass produced no output");
							}

							let renderedCutIndex = 0;
							const assembleSegments: Array<
								| { kind: "copy"; sourcePath: string; startMs: number; endMs: number }
								| { kind: "rendered"; startMs: number; endMs: number }
							> = [];
							for (const segment of smartPlan.segments) {
								if (segment.kind === "render") {
									assembleSegments.push(renderedCuts[renderedCutIndex++]);
									continue;
								}
								if (fullClipPlan) {
									for (const slice of sliceFlattenPlanFlat(fullClipPlan, [segment]).segments) {
										assembleSegments.push({
											kind: "copy",
											sourcePath: slice.sourcePath,
											startMs: slice.sourceStartMs,
											endMs: slice.sourceEndMs,
										});
									}
								} else {
									assembleSegments.push({
										kind: "copy",
										sourcePath: exportSourcePath as string,
										startMs: segment.startMs,
										endMs: segment.endMs,
									});
								}
							}

							setExportProgress({
								currentFrame: 1,
								totalFrames: 1,
								percentage: 97,
								estimatedTimeRemaining: 0,
							});
							const assembleResult = await window.electronAPI.assembleSmartExport({
								outputPath: targetPath,
								renderedPath,
								cleanupRenderedFile: true,
								width: exportWidth,
								height: exportHeight,
								fps: exportFps,
								bitrate,
								segments: assembleSegments,
							});
							if (!assembleResult.success) {
								throw new Error(assembleResult.error || "Smart export assembly failed");
							}

							setExportProgress({
								currentFrame: 1,
								totalFrames: 1,
								percentage: 100,
								estimatedTimeRemaining: 0,
							});
							handleExportSaved("Video", targetPath);
							return;
						} catch (smartError) {
							if (smartError instanceof Error && /cancelled/i.test(smartError.message)) {
								throw smartError;
							}
							console.warn(
								"[VideoEditor] Smart render failed, falling back to full render:",
								smartError,
							);
						} finally {
							exporterRef.current = null;
							if (miniFlattenTempPath) {
								void window.electronAPI.deleteTempFile(miniFlattenTempPath).catch(() => {
									/* best-effort temp cleanup */
								});
							}
						}
					}

					await ensureFlattenedSource();
					// The flattened multi-clip intermediate is itself a clean H.264 MP4,
					// so the FFmpeg fast paths below stay valid when clips are present —
					// they just run on the flattened file instead of the raw recording.
					const hasNoVisualEffects =
						exportZoomRegions.length === 0 &&
						exportAnnotationRegions.length === 0 &&
						exportSpeedRegions.length === 0 &&
						!effectiveShowCursor &&
						!webcamVideoPath &&
						!editorState.introClip?.introConfig?.config &&
						isDefaultCrop &&
						shadowIntensity === 0 &&
						borderRadius === 0 &&
						(padding === 0 || padding === undefined);
					const localSourcePath = exportSourcePath;

					const canRemux =
						hasNoVisualEffects &&
						exportTrimRegions.length === 0 &&
						localSourcePath &&
						window.electronAPI?.remuxExport;

					if (canRemux) {
						console.log("[VideoEditor] Using remux fast path (no edits, FFmpeg stream copy)");
						setExportProgress({
							currentFrame: 0,
							totalFrames: 1,
							percentage: 10,
							estimatedTimeRemaining: 0,
						});

						const remuxResult = await window.electronAPI.remuxExport(localSourcePath, targetPath);
						if (remuxResult.success) {
							setExportProgress({
								currentFrame: 1,
								totalFrames: 1,
								percentage: 100,
								estimatedTimeRemaining: 0,
							});
							handleExportSaved("Video", targetPath);
							return;
						}
						console.warn(
							"[VideoEditor] Remux failed, falling back to full export:",
							remuxResult.error,
						);
						// Fall through to full export below
					}

					const canQuickTrim =
						hasNoVisualEffects &&
						exportTrimRegions.length > 0 &&
						localSourcePath &&
						window.electronAPI?.quickTrimExport;

					if (canQuickTrim) {
						console.log("[VideoEditor] Using quick-trim fast path (FFmpeg stream copy)");
						setExportProgress({
							currentFrame: 0,
							totalFrames: 1,
							percentage: 10,
							estimatedTimeRemaining: 0,
						});

						// Compute kept segments from trim regions
						const totalDurationMs = exportDurationMs;
						const sorted = [...exportTrimRegions].sort((a, b) => a.startMs - b.startMs);
						const keptSegments: Array<{ startMs: number; endMs: number }> = [];
						let segCursor = 0;
						for (const trim of sorted) {
							if (segCursor < trim.startMs) {
								keptSegments.push({ startMs: segCursor, endMs: trim.startMs });
							}
							segCursor = Math.max(segCursor, trim.endMs);
						}
						if (segCursor < totalDurationMs) {
							keptSegments.push({ startMs: segCursor, endMs: totalDurationMs });
						}

						const quickResult = await window.electronAPI.quickTrimExport(
							localSourcePath,
							targetPath,
							keptSegments,
						);

						if (quickResult.success) {
							// Set progress to 100% so ExportDialog shows success state
							setExportProgress({
								currentFrame: 1,
								totalFrames: 1,
								percentage: 100,
								estimatedTimeRemaining: 0,
							});
							handleExportSaved("Video", targetPath);
							return;
						}
						console.warn(
							"[VideoEditor] Quick-trim failed, falling back to full export:",
							quickResult.error,
						);
						// Fall through to full export below
					}

					const exporter = new VideoExporter({
						videoUrl: exportVideoUrl,
						width: exportWidth,
						height: exportHeight,
						frameRate: exportFps,
						bitrate,
						codec: "avc1.640033",
						encodingMode,
						wallpaper,
						zoomRegions: exportZoomRegions,
						trimRegions: exportTrimRegions,
						speedRegions: exportSpeedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						backgroundBlur: showBlur ? 1 : 0,
						borderRadius,
						padding,
						cropRegion,
						cursorTelemetry: exportCursorTelemetry,
						showCursor: effectiveShowCursor,
						cursorSize: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						annotationRegions: exportAnnotationRegions,
						previewWidth,
						previewHeight,
						introConfig: editorState.introClip?.introConfig?.config,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = exporter;
					const result = await exporter.export();

					if (!result.success) {
						const message = buildExportDiagnosticMessage({
							formatLabel: "Video",
							reason: result.error || "Export failed",
							sourcePath: videoSourcePath ?? videoPath,
							width: exportWidth,
							height: exportHeight,
							frameRate: 60,
							codec: "avc1.640033",
							bitrate,
						});
						setExportError(message);
						toast.error(message);
					} else {
						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						// Intro frames (if any) are already baked into the export by the
						// VideoExporter — no post-export FFmpeg concatenation needed.
						if (result.blob) {
							const arrayBuffer = await result.blob.arrayBuffer();
							const saveResult = await window.electronAPI.writeExportToPath(
								arrayBuffer,
								targetPath,
							);
							if (saveResult.success && saveResult.path) {
								setUnsavedExport(null);
								handleExportSaved("Video", saveResult.path);
							} else {
								setUnsavedExport({ arrayBuffer, fileName: targetFileName, format: "mp4" });
								const message = buildSaveDiagnosticMessage(
									"Video",
									saveResult.message || "Failed to save video",
								);
								setExportError(message);
								toast.error(message);
							}
						} else if (result.tempFilePath) {
							// Stream mode — file already on disk, copy to target
							const moveResult = await window.electronAPI.concatVideos(
								[result.tempFilePath],
								targetPath,
							);
							await window.electronAPI.deleteTempFile(result.tempFilePath).catch(() => {
								/* best-effort temp cleanup */
							});
							if (moveResult.success) {
								setUnsavedExport(null);
								handleExportSaved("Video", targetPath);
							} else {
								setExportError("Failed to save exported video");
								toast.error("Failed to save exported video");
							}
						} else {
							setExportError("Export produced no output");
							toast.error("Export produced no output");
						}
					}
				}

				if (wasPlaying) {
					videoPlaybackRef.current?.play();
				}
			} catch (error) {
				console.error("Export error:", error);
				if (error instanceof BackgroundLoadError) {
					const message = t("errors.exportBackgroundLoadFailed", { url: error.displayUrl });
					setExportError(message);
					toast.error(message);
				} else {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					const message = buildExportDiagnosticMessage({
						formatLabel: settings.format === "gif" ? "GIF" : "Video",
						reason: errorMessage,
						sourcePath: videoSourcePath ?? videoPath,
					});
					setExportError(message);
					toast.error(t("errors.exportFailedWithError", { error: message }));
				}
			} finally {
				if (flattenedTempPath) {
					void window.electronAPI.deleteTempFile(flattenedTempPath).catch(() => {
						/* best-effort temp cleanup */
					});
				}
				exporterRef.current = null;
				setIsExporting(false);
				// Don't clear exportProgress here — the ExportDialog needs to
				// see progress.percentage >= 100 with isExporting=false to
				// trigger the success state. The dialog clears it on close.
			}
		},
		[
			videoPath,
			videoSourcePath,
			webcamVideoPath,
			wallpaper,
			zoomRegions,
			trimRegions,
			speedRegions,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			cursorRecordingData,
			annotationRegions,
			isPlaying,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			mp4FrameRate,
			encodingMode,
			pipelineModel,
			handleExportSaved,
			cursorTelemetry,
			cursorClickTimestamps,
			effectiveShowCursor,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClipToBounds,
			cursorTheme,
			t,
			editorState.introClip,
			editorState.videoClips,
			duration,
			ensurePublishAllowed,
		],
	);

	const handleOpenExportDialog = useCallback(() => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		const video = videoPlaybackRef.current?.video;
		if (!video) {
			toast.error("Video not ready");
			return;
		}

		// Build export settings from current state
		const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
		const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
		const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
			sourceWidth,
			sourceHeight,
			cropRegion,
		);
		const gifDimensions = calculateOutputDimensions(
			effectiveSourceDimensions.width,
			effectiveSourceDimensions.height,
			gifSizePreset,
			GIF_SIZE_PRESETS,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig:
				exportFormat === "gif"
					? {
							frameRate: gifFrameRate,
							loop: gifLoop,
							sizePreset: gifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
							videoOnly: gifVideoOnly,
						}
					: undefined,
		};

		setShowExportDialog(true);
		setExportError(null);
		setExportedFilePath(null);

		// Start export immediately
		handleExport(settings);
	}, [
		videoPath,
		exportFormat,
		exportQuality,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		gifVideoOnly,
		aspectRatio,
		cropRegion,
		handleExport,
	]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			setShowExportDialog(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);
		}
	}, []);

	const generateAutoCaptions = useCallback(
		async (minWords: number, maxWords: number) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return;
			}
			if (isAutoCaptioningRef.current) {
				toast.error(t("autoCaptions.busy"));
				return;
			}
			const minW = Math.max(1, Math.min(minWords, maxWords));
			const maxW = Math.max(minW, maxWords);

			isAutoCaptioningRef.current = true;
			setIsAutoCaptioning(true);
			toast.loading(t("autoCaptions.generating"), { id: AUTO_CAPTION_PROGRESS_TOAST_ID });
			try {
				const transcribeOptions = {
					onStatus: (phase: "model" | "transcribe") => {
						if (phase === "model") {
							toast.loading(t("autoCaptions.loadingModel"), {
								id: AUTO_CAPTION_PROGRESS_TOAST_ID,
							});
						} else {
							toast.loading(t("autoCaptions.transcribing"), {
								id: AUTO_CAPTION_PROGRESS_TOAST_ID,
							});
						}
					},
				};

				let allRegions: AnnotationRegion[] = [];
				let runningNumericId = nextAnnotationIdRef.current;
				let runningZIndex = nextAnnotationZIndexRef.current;
				let anyTruncated = false;

				// --- Process primary video (offset = 0) ---
				const { samples, truncated, durationSec } = await extractMono16kFromVideoUrl(videoPath);
				if (Number.isFinite(durationSec) && durationSec > 0 && samples.length >= 800) {
					if (truncated) anyTruncated = true;

					const { samples: speechSamples, trimSec } = trimLeadingSilenceMono16k(samples);
					if (speechSamples.length >= 800) {
						const trimMs = Math.round(trimSec * 1000);
						const trimRegionsForTranscribe = shiftTrimRegionsMsForCaptionBuffer(
							trimRegions,
							trimMs,
						);

						let { segments: segmentsRaw, granularity } = await transcribeMono16kToSegments(
							speechSamples,
							{
								trimRegions: trimRegionsForTranscribe,
								...transcribeOptions,
							},
						);
						let transcribedFromTrimmedBuffer = true;

						if (segmentsRaw.length === 0 && trimSec > 0) {
							({ segments: segmentsRaw, granularity } = await transcribeMono16kToSegments(samples, {
								trimRegions,
								...transcribeOptions,
							}));
							transcribedFromTrimmedBuffer = false;
						}

						const segments =
							transcribedFromTrimmedBuffer && trimSec > 0
								? segmentsRaw.map((s) => ({
										...s,
										startSec: s.startSec + trimSec,
										endSec: s.endSec + trimSec,
									}))
								: segmentsRaw;

						let { regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
							segments,
							runningNumericId,
							runningZIndex,
							{
								minWordsPerCaption: minW,
								maxWordsPerCaption: maxW,
								timestampGranularity: granularity,
							},
						);

						if (regions.length === 0 && segments.length > 0) {
							({ regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
								segments,
								runningNumericId,
								runningZIndex,
								{
									minWordsPerCaption: 1,
									maxWordsPerCaption: Number.MAX_SAFE_INTEGER,
									timestampGranularity: granularity,
								},
							));
						}

						allRegions.push(...regions);
						runningNumericId = nextNumericId;
						runningZIndex = nextZIndex;
					}
				}

				// --- Process additional video clips ---
				const clips = editorState.videoClips;
				for (const clip of clips) {
					try {
						const clipResult = await extractMono16kFromVideoUrl(clip.sourceVideoPath);
						if (
							!Number.isFinite(clipResult.durationSec) ||
							clipResult.durationSec <= 0 ||
							clipResult.samples.length < 800
						) {
							continue;
						}
						if (clipResult.truncated) anyTruncated = true;

						toast.loading(t("autoCaptions.transcribing"), {
							id: AUTO_CAPTION_PROGRESS_TOAST_ID,
						});

						const { segments: clipSegmentsRaw, granularity: clipGranularity } =
							await transcribeMono16kToSegments(clipResult.samples, transcribeOptions);

						if (clipSegmentsRaw.length === 0) continue;

						// Offset segments by the clip's position on the master timeline
						const offsetSec = clip.offsetMs / 1000;
						const offsetSegments = clipSegmentsRaw.map((s) => ({
							...s,
							startSec: s.startSec + offsetSec,
							endSec: s.endSec + offsetSec,
						}));

						let {
							regions: clipRegions,
							nextNumericId: clipNextId,
							nextZIndex: clipNextZ,
						} = captionSegmentsToAnnotationRegions(
							offsetSegments,
							runningNumericId,
							runningZIndex,
							{
								minWordsPerCaption: minW,
								maxWordsPerCaption: maxW,
								timestampGranularity: clipGranularity,
							},
						);

						if (clipRegions.length === 0 && offsetSegments.length > 0) {
							({
								regions: clipRegions,
								nextNumericId: clipNextId,
								nextZIndex: clipNextZ,
							} = captionSegmentsToAnnotationRegions(
								offsetSegments,
								runningNumericId,
								runningZIndex,
								{
									minWordsPerCaption: 1,
									maxWordsPerCaption: Number.MAX_SAFE_INTEGER,
									timestampGranularity: clipGranularity,
								},
							));
						}

						allRegions.push(...clipRegions);
						runningNumericId = clipNextId;
						runningZIndex = clipNextZ;
					} catch (clipErr) {
						console.warn(`Caption extraction failed for clip ${clip.id}:`, clipErr);
					}
				}

				if (allRegions.length === 0) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.info(t("autoCaptions.noneHeard"));
					return;
				}

				pushState((prev) => ({ annotationRegions: [...prev.annotationRegions, ...allRegions] }));
				nextAnnotationIdRef.current = runningNumericId;
				nextAnnotationZIndexRef.current = runningZIndex;

				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const minutesTrunc = String(Math.round(MAX_CAPTION_AUDIO_SEC / 60));
				if (anyTruncated) {
					toast.success(t("autoCaptions.done", { count: String(allRegions.length) }), {
						description: t("autoCaptions.truncated", { minutes: minutesTrunc }),
					});
				} else {
					toast.success(t("autoCaptions.done", { count: String(allRegions.length) }));
				}
			} catch (e) {
				console.error(e);
				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const detail = e instanceof Error ? e.message : String(e);
				toast.error(t("autoCaptions.failed"), { description: detail });
			} finally {
				isAutoCaptioningRef.current = false;
				setIsAutoCaptioning(false);
			}
		},
		[videoPath, trimRegions, pushState, t, editorState.videoClips],
	);

	// ── AI Feature handlers ──

	// Legacy synchronous "Magic Polish" (visual-only preview dialog). Kept for
	// reference; the ToolRail now runs the full async Auto-Polish below.
	// Render a resolved intro config to a video file and package it as a clip.
	const buildIntroClip = useCallback(async (config: IntroConfig): Promise<VideoClip | null> => {
		const blob = await renderIntroToBlob(config);
		const arrayBuffer = await blob.arrayBuffer();
		const result = await window.electronAPI.saveIntroVideo(arrayBuffer);
		if (!result.success || !result.path) return null;
		return {
			id: `intro-${config.durationMs}-${config.title.length}`,
			sourceVideoPath: result.path,
			startMs: 0,
			endMs: config.durationMs,
			offsetMs: 0,
			durationMs: config.durationMs,
			label: config.title || "Intro",
			sourceType: "intro",
			introConfig: { config: { ...config } },
		};
	}, []);

	// ── Auto-Polish: runs once with the user's selected options ──
	const handleAutoPolish = useCallback(async () => {
		if (isAutoPolishing) return;
		if (cursorTelemetry.length === 0 || duration <= 0) {
			toast.error("Record a screen with cursor activity first.");
			return;
		}
		// Only the AI stages need the account; framing/cursor/intro are local.
		const needsBackend = polishOptions.narration || polishOptions.music;
		if (needsBackend && !isBackendAuthed) {
			toast.info("Sign in to your account to use narration and music.");
			showLogin();
			return;
		}

		setShowPolishSetup(false);
		setIsAutoPolishing(true);
		const toastId = toast.loading("Polish: starting…");
		try {
			const { templates } = await fetchPolishTemplates();
			const template = templates[0];
			if (!template) throw new Error("No polish template available.");

			const result = await runAutoPolish({
				cursorTelemetry,
				videoDurationMs: duration * 1000,
				currentState: editorState,
				projectTitle: deriveProjectTitle(currentProjectPath),
				captionTrack: editorState.captionTrack ?? null,
				template,
				options: polishOptions,
				introClipFactory: buildIntroClip,
				onProgress: (_stage, message) => toast.loading(message, { id: toastId }),
			});

			pushState(result.edits);
			// Cursor smoothing renders from local component state, not EditorState.
			if (result.cursorSmoothing !== null) setCursorSmoothing(result.cursorSmoothing);

			const s = result.summary;
			const parts = [
				s.zoomCount ? `${s.zoomCount} zooms` : null,
				s.trimCount ? `${s.trimCount} trims` : null,
				s.narrationLineCount ? `${s.narrationLineCount} narration lines` : null,
				s.musicAdded ? "music" : null,
				s.introAdded ? "intro" : null,
			].filter(Boolean);
			toast.success(`Polish applied${parts.length ? `: ${parts.join(", ")}` : ""}`, {
				id: toastId,
			});
			if (result.warnings.length > 0) toast.warning(result.warnings[0]);
		} catch (err) {
			if (err instanceof AutoPolishAuthError) {
				toast.dismiss(toastId);
				toast.info("Sign in to your account to use narration and music.");
				showLogin();
			} else if (err instanceof DOMException && err.name === "AbortError") {
				toast.dismiss(toastId);
			} else {
				toast.error(err instanceof Error ? err.message : "Polish failed", { id: toastId });
			}
		} finally {
			setIsAutoPolishing(false);
		}
	}, [
		isAutoPolishing,
		cursorTelemetry,
		duration,
		polishOptions,
		isBackendAuthed,
		showLogin,
		editorState,
		currentProjectPath,
		buildIntroClip,
		pushState,
	]);

	const handleAIApplyEdits = useCallback(
		(edits: Partial<EditorState>) => {
			pushState(edits);
		},
		[pushState],
	);

	const handleAcceptTrimSuggestions = useCallback(
		(trims: { id: string; startMs: number; endMs: number }[]) => {
			pushState((prev) => ({
				trimRegions: [...prev.trimRegions, ...trims],
			}));
		},
		[pushState],
	);

	const handleScreenshot = useCallback(async () => {
		const container = videoPlaybackRef.current?.containerRef?.current ?? playerContainerRef.current;
		if (!container) {
			toast.error("No content available for screenshot");
			return;
		}

		const rect = container.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.round(rect.width * dpr);
		const h = Math.round(rect.height * dpr);
		const offscreen = document.createElement("canvas");
		offscreen.width = w;
		offscreen.height = h;
		const ctx = offscreen.getContext("2d");
		if (!ctx) {
			toast.error("Failed to create canvas");
			return;
		}
		ctx.scale(dpr, dpr);

		const elements = container.querySelectorAll("canvas, video");
		for (const el of elements) {
			const elRect = el.getBoundingClientRect();
			const x = elRect.left - rect.left;
			const y = elRect.top - rect.top;
			try {
				if (el instanceof HTMLCanvasElement) {
					ctx.drawImage(el, x, y, elRect.width, elRect.height);
				} else if (el instanceof HTMLVideoElement) {
					ctx.drawImage(el, x, y, elRect.width, elRect.height);
				}
			} catch {
				// Cross-origin or tainted canvas -- skip
			}
		}

		const blob = await new Promise<Blob | null>((resolve) => {
			offscreen.toBlob(resolve, "image/png");
		});
		if (!blob) {
			toast.error("Failed to capture screenshot");
			return;
		}

		try {
			const buffer = await blob.arrayBuffer();
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const fileName = `guide-studio-screenshot-${timestamp}.png`;
			// Use the existing export path API to save the screenshot
			const saveResult = await window.electronAPI.writeExportToPath(buffer, fileName);
			if (saveResult.success && saveResult.path) {
				toast.success("Screenshot saved", { description: saveResult.path });
			} else {
				toast.error("Failed to save screenshot");
			}
		} catch (err) {
			console.error("Screenshot save error:", err);
			toast.error("Failed to save screenshot");
		}
	}, []);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">{t("loadingVideo")}</div>
			</div>
		);
	}

	// Fresh launch with nothing to edit: show the Welcome dashboard until the
	// user picks an entry point. Recording is summoned in the HUD; media and
	// projects load into this window.
	if (!videoPath && !welcomeDismissed && !error) {
		return (
			<WelcomeScreen
				onNewRecording={() => {
					void window.electronAPI.startNewRecording();
				}}
				onOpenVideo={handleWelcomeOpenVideo}
				onOpenProject={doLoadProject}
			/>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-[#6E6BFF] text-white text-sm hover:bg-[#6E6BFF]/90"
					>
						{ts("project.load")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#1C1917] text-slate-200 overflow-hidden selection:bg-[#6E6BFF]/30">
			<Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
				<DialogContent
					className="sm:max-w-[425px]"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("newRecording.title")}</DialogTitle>
						<DialogDescription>{t("newRecording.description")}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<button
							type="button"
							onClick={() => setShowNewRecordingDialog(false)}
							className="px-4 py-2 rounded-md bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
						>
							{t("newRecording.cancel")}
						</button>
						<button
							type="button"
							onClick={handleNewRecordingConfirm}
							className="px-4 py-2 rounded-md bg-[#6E6BFF] text-white hover:bg-[#6E6BFF]/90 text-sm font-medium transition-colors"
						>
							{t("newRecording.confirm")}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={showAutoCaptionsDialog} onOpenChange={setShowAutoCaptionsDialog}>
				<DialogContent
					className="sm:max-w-md"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("autoCaptions.dialogTitle")}</DialogTitle>
						<DialogDescription>{t("autoCaptions.dialogDescription")}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label htmlFor="caption-min-words">{t("autoCaptions.minWords")}</Label>
							<Select
								value={String(captionWordsMin)}
								onValueChange={(v) => {
									const n = Number.parseInt(v, 10);
									setCaptionWordsMin(n);
									if (n > captionWordsMax) setCaptionWordsMax(n);
								}}
							>
								<SelectTrigger id="caption-min-words" className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_WORD_CHOICES.map((n) => (
										<SelectItem key={`min-${n}`} value={String(n)}>
											{t("autoCaptions.wordsCount", { count: String(n) })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="caption-max-words">{t("autoCaptions.maxWords")}</Label>
							<Select
								value={String(captionWordsMax)}
								onValueChange={(v) => {
									const n = Number.parseInt(v, 10);
									setCaptionWordsMax(n);
									if (n < captionWordsMin) setCaptionWordsMin(n);
								}}
							>
								<SelectTrigger id="caption-max-words" className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_WORD_CHOICES.map((n) => (
										<SelectItem key={`max-${n}`} value={String(n)}>
											{t("autoCaptions.wordsCount", { count: String(n) })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button
							type="button"
							variant="outline"
							onClick={() => setShowAutoCaptionsDialog(false)}
							className="border-white/20 bg-transparent text-white hover:bg-white/10"
						>
							{t("autoCaptions.dialogCancel")}
						</Button>
						<Button
							type="button"
							disabled={isAutoCaptioning}
							onClick={() => {
								setShowAutoCaptionsDialog(false);
								void generateAutoCaptions(captionWordsMin, captionWordsMax);
							}}
							className="bg-[#6E6BFF] text-white hover:bg-[#6E6BFF]/90"
						>
							{t("autoCaptions.generate")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div
				className="h-12 flex-shrink-0 bg-[#1C1917]/98 backdrop-blur-2xl border-b border-white/[0.06] flex items-center px-4 z-50 relative"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				{/* Gradient accent line */}
				<div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-[#6E6BFF]/0 via-[#6E6BFF]/25 to-[#22D3EE]/0" />

				{/* Left: Export + Screenshot */}
				<div
					className={`flex items-center gap-1.5 ${isMac ? "ml-16" : "ml-0"}`}
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					{videoPath && (
						<>
							<button
								type="button"
								data-testid={getTestId("export-panel-button")}
								onClick={() => {
									setShowAIPanel(false);
									setInspectorOpen(true);
									setSettingsPanel("export");
								}}
								className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6E6BFF]/10 hover:bg-[#6E6BFF]/20 border border-[#6E6BFF]/25 transition-all duration-150"
								title="Export"
							>
								<Download size={14} className="text-[#8B89FF] transition-colors" />
								<span className="text-[11px] font-semibold text-[#8B89FF]">Export</span>
							</button>
							<div className="w-px h-4 bg-white/[0.08] mx-0.5" />
							<button
								type="button"
								onClick={handleScreenshot}
								className="group p-1.5 rounded-lg hover:bg-white/[0.06] transition-all duration-150"
								title="Screenshot"
							>
								<Camera
									size={14}
									className="text-white/50 group-hover:text-white/80 transition-colors"
								/>
							</button>
						</>
					)}
				</div>

				{/* Center: Logo + Brand */}
				<div
					className="flex-1 flex justify-center"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<div className="flex items-center gap-2">
						<img src={guideLogo} alt="Guide" className="w-6 h-6" />
						<span className="text-[11px] font-bold tracking-wider uppercase bg-gradient-to-r from-[#6E6BFF] to-[#22D3EE] bg-clip-text text-transparent">
							Guide
						</span>
					</div>
				</div>

				{/* Right: File operations + Language */}
				<div
					className="flex items-center gap-0.5"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<button
						type="button"
						onClick={handleAddVideoClip}
						className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] transition-all duration-150"
						title="Add Video Clip"
					>
						<FilePlus2
							size={14}
							className="text-white/50 group-hover:text-[#14b8a6] transition-colors"
						/>
						<span className="text-[11px] font-medium text-white/50 group-hover:text-white/80">
							Add Video
						</span>
					</button>
					<div className="w-px h-4 bg-white/[0.08] mx-1" />
					<button
						type="button"
						onClick={() => setShowNewRecordingDialog(true)}
						className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] transition-all duration-150"
						title="New Recording"
					>
						<Video
							size={14}
							className="text-white/50 group-hover:text-[#6E6BFF] transition-colors"
						/>
						<span className="text-[11px] font-medium text-white/50 group-hover:text-white/80">
							{t("newRecording.title")}
						</span>
					</button>
					<button
						type="button"
						onClick={handleLoadProject}
						className="group p-1.5 rounded-lg hover:bg-white/[0.06] transition-all duration-150"
						title="Load Project"
					>
						<FolderOpen
							size={14}
							className="text-white/50 group-hover:text-white/80 transition-colors"
						/>
					</button>
					<button
						type="button"
						onClick={handleSaveProject}
						className="group p-1.5 rounded-lg hover:bg-white/[0.06] transition-all duration-150"
						title="Save Project"
					>
						<Save size={14} className="text-white/50 group-hover:text-white/80 transition-colors" />
					</button>
					<div className="w-px h-4 bg-white/[0.08] mx-1" />
					{/* Language selector */}
					<div className="relative group">
						<div className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] transition-all duration-150">
							<Languages size={13} className="text-white/40" />
							<select
								value={locale}
								onChange={(e) => setLocale(e.target.value as Locale)}
								className="bg-transparent text-[10px] font-medium outline-none cursor-pointer appearance-none text-white/50 hover:text-white/70 w-7"
							>
								{availableLocales.map((loc) => (
									<option key={loc} value={loc} className="bg-[#1C1917] text-white">
										{getLocaleName(loc)}
									</option>
								))}
							</select>
						</div>
					</div>
				</div>
			</div>

			{/* Empty state shown when no video is loaded */}
			{!videoPath && (
				<div className="flex-1 min-h-0 relative">
					<EditorEmptyState
						onVideoImported={(path) => {
							setVideoPath(toFileUrl(path));
							setVideoSourcePath(path);
							setWebcamVideoPath(null);
							setWebcamVideoSourcePath(null);
						}}
						onProjectOpened={async (project, path) => {
							const restored = await applyLoadedProject(project, path);
							if (!restored) {
								toast.error(t("project.invalidFormat"));
							}
						}}
					/>
				</div>
			)}

			{videoPath && (
				<div className="editor-workspace flex-1 min-h-0 relative flex">
					<ToolRail
						activeTool={
							!inspectorOpen
								? null
								: showAIPanel
									? aiPanelMode === "tools"
										? "ai"
										: "chat"
									: (settingsPanel ?? "background")
						}
						onToolClick={(tool: ToolRailTool) => {
							if (tool === "polish") {
								if (cursorTelemetry.length === 0 || duration <= 0) {
									toast.error("Record a screen with cursor activity first.");
									return;
								}
								setShowPolishSetup(true);
								return;
							}
							if (tool === "crop") {
								setShowAIPanel(false);
								setInspectorOpen(true);
								setShowCropDialog(true);
								return;
							}
							if (tool === "ai" || tool === "chat") {
								const mode = tool === "ai" ? "tools" : "chat";
								if (showAIPanel && aiPanelMode === mode && inspectorOpen) {
									setInspectorOpen(false);
									return;
								}
								setShowAIPanel(true);
								setAIPanelMode(mode);
								setInspectorOpen(true);
								return;
							}
							if (!showAIPanel && inspectorOpen && (settingsPanel ?? "background") === tool) {
								setInspectorOpen(false);
								return;
							}
							setShowAIPanel(false);
							setSettingsPanel(tool as SettingsPanelMode);
							setInspectorOpen(true);
						}}
						hasWebcam={Boolean(webcamVideoPath)}
						showCursorTool={
							showCursorSettings &&
							(cursorTelemetry.length > 0 || hasNativeCursorRecordingData(cursorRecordingData))
						}
						polishDisabled={cursorTelemetry.length === 0 || isAutoPolishing}
					/>
					<div className="min-w-0 min-h-0 flex-1">
						<PanelGroup direction="vertical" className="min-h-0">
							{/* Top section: preview and contextual inspector */}
							<Panel defaultSize={60} maxSize={76} minSize={44} className="min-h-[280px]">
								<div className="editor-main-deck h-full min-h-0 flex">
									{inspectorOpen && (
										<div className="editor-inspector-rail order-2 w-[324px] flex-shrink-0 h-full flex flex-col">
											{/* Settings or AI panel content */}
											{showAIPanel ? (
												<div className="flex-1 min-h-0">
													{aiPanelMode === "chat" ? (
														<div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
															<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#6E6BFF]/10 border border-[#6E6BFF]/30">
																<Bot size={22} className="text-[#6E6BFF]" />
															</div>
															<div className="text-sm font-medium text-white/90">
																AI editing — coming soon
															</div>
															<p className="max-w-[240px] text-xs leading-relaxed text-white/50">
																Editing your video by chatting with AI is on the way. For now, use
																the AI tools tab for captions, zoom, and polish.
															</p>
														</div>
													) : (
														<AIPanelSidebar
															editorState={editorState}
															cursorTelemetry={cursorTelemetry}
															videoDurationMs={duration * 1000}
															onApplyEdits={handleAIApplyEdits}
															onAcceptTrimSuggestions={handleAcceptTrimSuggestions}
															onSeek={(timeMs) => handleSeek(timeMs / 1000)}
															onInsertIntroClip={handleInsertIntroClip}
															autoZoomEnabled={autoZoomEnabled}
															onToggleAutoZoom={handleToggleAutoZoom}
															autoFocusAll={autoFocusAll}
															onToggleAutoFocusAll={handleToggleAutoFocusAll}
															onGenerateCaptions={() => {
																if (!videoPath) {
																	toast.error(t("errors.noVideoLoaded"));
																	return;
																}
																if (isAutoCaptioningRef.current) {
																	toast.error(t("autoCaptions.busy"));
																	return;
																}
																setShowAutoCaptionsDialog(true);
															}}
															isGeneratingCaptions={isAutoCaptioning}
															captionTrack={editorState.captionTrack ?? null}
															videoPath={videoPath}
														/>
													)}
												</div>
											) : (
												<SettingsPanel
													hideModeRail
													cropDialogOpen={showCropDialog}
													onCropDialogOpenChange={setShowCropDialog}
													selected={wallpaper}
													onWallpaperChange={(w) => pushState({ wallpaper: w })}
													selectedZoomDepth={
														selectedZoomId
															? zoomRegions.find((z) => z.id === selectedZoomId)?.depth
															: null
													}
													onZoomDepthChange={(depth) =>
														selectedZoomId && handleZoomDepthChange(depth)
													}
													selectedZoomCustomScale={
														selectedZoomId
															? (zoomRegions.find((z) => z.id === selectedZoomId)?.customScale ??
																null)
															: null
													}
													onZoomCustomScaleChange={handleZoomCustomScaleChange}
													onZoomCustomScaleCommit={handleZoomCustomScaleCommit}
													onZoomPreviewStart={() => setIsPreviewingZoom(true)}
													onZoomPreviewEnd={() => setIsPreviewingZoom(false)}
													selectedZoomFocusMode={
														selectedZoomId
															? (zoomRegions.find((z) => z.id === selectedZoomId)?.focusMode ??
																"manual")
															: null
													}
													onZoomFocusModeChange={(mode) =>
														selectedZoomId && handleZoomFocusModeChange(mode)
													}
													focusModeLocked={autoFocusAll}
													selectedZoomFocus={
														selectedZoomId
															? (zoomRegions.find((z) => z.id === selectedZoomId)?.focus ?? null)
															: null
													}
													onZoomFocusCoordinateChange={(focus) =>
														selectedZoomId && handleZoomFocusChange(selectedZoomId, focus)
													}
													onZoomFocusCoordinateCommit={commitState}
													hasCursorTelemetry={cursorTelemetry.length > 0}
													selectedZoomId={selectedZoomId}
													onZoomDelete={handleZoomDelete}
													selectedZoomRotationPreset={
														selectedZoomId
															? (zoomRegions.find((z) => z.id === selectedZoomId)?.rotationPreset ??
																null)
															: null
													}
													onZoomRotationPresetChange={handleZoomRotationPresetChange}
													selectedTrimId={selectedTrimId}
													onTrimDelete={handleTrimDelete}
													shadowIntensity={shadowIntensity}
													onShadowChange={(v) => updateState({ shadowIntensity: v })}
													onShadowCommit={commitState}
													showBlur={showBlur}
													onBlurChange={(v) => pushState({ showBlur: v })}
													showTrimWaveform={showTrimWaveform}
													onTrimWaveformChange={(v) => pushState({ showTrimWaveform: v })}
													motionBlurAmount={motionBlurAmount}
													onMotionBlurChange={(v) => updateState({ motionBlurAmount: v })}
													onMotionBlurCommit={commitState}
													borderRadius={borderRadius}
													onBorderRadiusChange={(v) => updateState({ borderRadius: v })}
													onBorderRadiusCommit={commitState}
													padding={padding}
													onPaddingChange={(v) => updateState({ padding: v })}
													onPaddingCommit={commitState}
													cropRegion={cropRegion}
													onCropChange={(r) => pushState({ cropRegion: r })}
													aspectRatio={aspectRatio}
													hasWebcam={Boolean(webcamVideoPath)}
													webcamLayoutPreset={webcamLayoutPreset}
													onWebcamLayoutPresetChange={(preset) =>
														pushState({
															webcamLayoutPreset: preset,
															webcamPosition:
																preset === "picture-in-picture" ? webcamPosition : null,
														})
													}
													webcamMaskShape={webcamMaskShape}
													onWebcamMaskShapeChange={(shape) => pushState({ webcamMaskShape: shape })}
													webcamMirrored={webcamMirrored}
													webcamReactiveZoom={webcamReactiveZoom}
													onWebcamMirroredChange={(mirrored) =>
														pushState({ webcamMirrored: mirrored })
													}
													onWebcamReactiveZoomChange={(reactive) =>
														pushState({ webcamReactiveZoom: reactive })
													}
													webcamSizePreset={webcamSizePreset}
													onWebcamSizePresetChange={(v) => updateState({ webcamSizePreset: v })}
													onWebcamSizePresetCommit={commitState}
													videoElement={videoPlaybackRef.current?.video || null}
													effectiveDurationSec={Math.max(
														0,
														duration -
															trimRegions.reduce(
																(totalSec, region) =>
																	totalSec + Math.max(0, region.endMs - region.startMs) / 1000,
																0,
															),
													)}
													exportQuality={exportQuality}
													onExportQualityChange={setExportQuality}
													exportFormat={exportFormat}
													onExportFormatChange={setExportFormat}
													mp4FrameRate={mp4FrameRate}
													onMp4FrameRateChange={setMp4FrameRate}
													encodingMode={encodingMode}
													onEncodingModeChange={setEncodingMode}
													pipelineModel={pipelineModel}
													onPipelineModelChange={setPipelineModel}
													gifFrameRate={gifFrameRate}
													onGifFrameRateChange={setGifFrameRate}
													gifLoop={gifLoop}
													onGifLoopChange={setGifLoop}
													gifSizePreset={gifSizePreset}
													onGifSizePresetChange={setGifSizePreset}
													gifVideoOnly={gifVideoOnly}
													onGifVideoOnlyChange={setGifVideoOnly}
													gifOutputDimensions={calculateOutputDimensions(
														calculateEffectiveSourceDimensions(
															videoPlaybackRef.current?.video?.videoWidth ||
																DEFAULT_SOURCE_DIMENSIONS.width,
															videoPlaybackRef.current?.video?.videoHeight ||
																DEFAULT_SOURCE_DIMENSIONS.height,
															cropRegion,
														).width,
														calculateEffectiveSourceDimensions(
															videoPlaybackRef.current?.video?.videoWidth ||
																DEFAULT_SOURCE_DIMENSIONS.width,
															videoPlaybackRef.current?.video?.videoHeight ||
																DEFAULT_SOURCE_DIMENSIONS.height,
															cropRegion,
														).height,
														gifSizePreset,
														GIF_SIZE_PRESETS,
													)}
													onExport={handleOpenExportDialog}
													activePanel={settingsPanel}
													onActivePanelChange={(panel) => {
														setSettingsPanel(panel);
														if (panel === "export") {
															setSelectedZoomId(null);
															setSelectedTrimId(null);
															setSelectedSpeedId(null);
															setSelectedClipId(null);
														}
													}}
													selectedAnnotationId={selectedAnnotationId}
													annotationRegions={annotationOnlyRegions}
													onAnnotationContentChange={handleAnnotationContentChange}
													onAnnotationTypeChange={handleAnnotationTypeChange}
													onAnnotationStyleChange={handleAnnotationStyleChange}
													onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
													onAnnotationDuplicate={handleAnnotationDuplicate}
													onAnnotationDelete={handleAnnotationDelete}
													selectedBlurId={selectedBlurId}
													blurRegions={blurRegions}
													onBlurDataChange={handleBlurDataPanelChange}
													onBlurDataCommit={commitState}
													onBlurDelete={handleAnnotationDelete}
													selectedSpeedId={selectedSpeedId}
													selectedSpeedValue={
														selectedSpeedId
															? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
															: null
													}
													onSpeedChange={handleSpeedChange}
													onSpeedDelete={handleSpeedDelete}
													selectedClipId={selectedClipId}
													selectedClip={
														selectedClipId
															? (editorState.videoClips.find((c) => c.id === selectedClipId) ??
																null)
															: null
													}
													onClipDelete={handleClipDelete}
													unsavedExport={unsavedExport}
													onSaveUnsavedExport={handleSaveUnsavedExport}
													showCursor={showCursor}
													onShowCursorChange={setShowCursor}
													cursorSize={cursorSize}
													onCursorSizeChange={setCursorSize}
													cursorSmoothing={cursorSmoothing}
													onCursorSmoothingChange={setCursorSmoothing}
													cursorMotionBlur={cursorMotionBlur}
													onCursorMotionBlurChange={setCursorMotionBlur}
													cursorClickBounce={cursorClickBounce}
													onCursorClickBounceChange={setCursorClickBounce}
													cursorClipToBounds={cursorClipToBounds}
													onCursorClipToBoundsChange={setCursorClipToBounds}
													cursorTheme={cursorTheme}
													onCursorThemeChange={setCursorTheme}
													hasCursorData={
														cursorTelemetry.length > 0 ||
														hasNativeCursorRecordingData(cursorRecordingData)
													}
													showCursorSettings={showCursorSettings}
													// Caption/animated bg props
													captionTrack={editorState.captionTrack ?? null}
													captionStyle={editorState.captionStyle}
													onCaptionStyleChange={(style) =>
														pushState({
															captionStyle: { ...editorState.captionStyle, ...style },
														} as Partial<EditorState>)
													}
													onCaptionTrackChange={(track) =>
														pushState({ captionTrack: track } as Partial<EditorState>)
													}
													videoPath={videoPath}
													onWallpaperHover={setPreviewWallpaper}
													onWallpaperHoverEnd={() => setPreviewWallpaper(null)}
												/>
											)}
										</div>
									)}

									<div className="editor-preview-zone order-1 min-w-0 h-full flex-1">
										<div
											ref={playerContainerRef}
											className={
												isFullscreen
													? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#0B0C10]"
													: "editor-preview-panel w-full h-full flex flex-col items-center justify-center overflow-hidden relative"
											}
										>
											{/* Video preview */}
											<div className="w-full min-h-0 flex justify-center items-center flex-auto px-3 pt-3">
												<div
													className="relative flex justify-center items-center w-auto h-full max-w-full box-border"
													style={{
														aspectRatio:
															aspectRatio === "native"
																? getNativeAspectRatioValue(
																		videoPlaybackRef.current?.video?.videoWidth ||
																			DEFAULT_SOURCE_DIMENSIONS.width,
																		videoPlaybackRef.current?.video?.videoHeight ||
																			DEFAULT_SOURCE_DIMENSIONS.height,
																		cropRegion,
																	)
																: getAspectRatioValue(aspectRatio),
													}}
												>
													<VideoPlayback
														key={`${videoPath || "no-video"}:${webcamVideoPath || "no-webcam"}`}
														aspectRatio={aspectRatio}
														ref={videoPlaybackRef}
														videoPath={videoPath || ""}
														webcamVideoPath={webcamVideoPath || undefined}
														introClip={introClip}
														introDurationMs={introDurationMs}
														isInIntroPhase={isInIntroPhase}
														narrationTrack={editorState.narrationTrack ?? null}
														backgroundMusic={editorState.backgroundMusic}
														backgroundMusicVolume={editorState.backgroundMusicVolume}
														muteOriginalAudio={editorState.muteOriginalAudio}
														webcamLayoutPreset={webcamLayoutPreset}
														webcamMaskShape={webcamMaskShape}
														webcamMirrored={webcamMirrored}
														webcamReactiveZoom={webcamReactiveZoom}
														webcamSizePreset={webcamSizePreset}
														webcamPosition={webcamPosition}
														onWebcamPositionChange={(pos) => updateState({ webcamPosition: pos })}
														onWebcamPositionDragEnd={commitState}
														onDurationChange={setDuration}
														onTimeUpdate={(t) => setCurrentTime(t + introDurationMs / 1000)}
														currentTime={Math.max(0, currentTime - introDurationMs / 1000)}
														onPlayStateChange={setIsPlaying}
														onError={setError}
														wallpaper={previewWallpaper ?? wallpaper}
														zoomRegions={zoomRegions}
														selectedZoomId={selectedZoomId}
														onSelectZoom={handleSelectZoom}
														onZoomFocusChange={handleZoomFocusChange}
														onZoomFocusDragEnd={commitState}
														isPlaying={isPlaying}
														showShadow={shadowIntensity > 0}
														shadowIntensity={shadowIntensity}
														showBlur={showBlur}
														motionBlurAmount={motionBlurAmount}
														borderRadius={borderRadius}
														padding={padding}
														cropRegion={cropRegion}
														cursorRecordingData={cursorRecordingData}
														trimRegions={trimRegions}
														speedRegions={speedRegions}
														annotationRegions={annotationOnlyRegions}
														selectedAnnotationId={selectedAnnotationId}
														onSelectAnnotation={handleSelectAnnotation}
														onAnnotationPositionChange={handleAnnotationPositionChange}
														onAnnotationSizeChange={handleAnnotationSizeChange}
														blurRegions={blurRegions}
														selectedBlurId={selectedBlurId}
														onSelectBlur={handleSelectBlur}
														onBlurPositionChange={handleAnnotationPositionChange}
														onBlurSizeChange={handleAnnotationSizeChange}
														onBlurDataChange={handleBlurDataPreviewChange}
														onBlurDataCommit={commitState}
														cursorTelemetry={cursorTelemetry}
														cursorClickTimestamps={cursorClickTimestamps}
														showCursor={effectiveShowCursor}
														cursorSize={cursorSize}
														cursorSmoothing={cursorSmoothing}
														cursorMotionBlur={cursorMotionBlur}
														cursorClickBounce={cursorClickBounce}
														cursorClipToBounds={cursorClipToBounds}
														cursorTheme={cursorTheme}
														showClickRings={editorState.showClickRings}
														isPreviewingZoom={isPreviewingZoom}
														captionTrack={editorState.captionTrack ?? null}
														captionStyle={editorState.captionStyle}
														videoClips={editorState.videoClips}
													/>
												</div>
											</div>
											{/* Fullscreen-only playback controls (docked in timeline header otherwise) */}
											{isFullscreen && (
												<div className="w-full flex justify-center items-center h-12 flex-shrink-0 px-3 py-1.5">
													<div className="w-full max-w-[760px]">
														<PlaybackControls
															isPlaying={isPlaying}
															currentTime={currentTime}
															duration={masterDuration}
															isFullscreen={isFullscreen}
															onToggleFullscreen={toggleFullscreen}
															onTogglePlayPause={togglePlayPause}
															onSeek={handleSeek}
														/>
													</div>
												</div>
											)}
										</div>
									</div>
								</div>
							</Panel>

							<PanelResizeHandle className="editor-resize-handle group">
								<div className="w-full h-px transition-colors group-hover:bg-[#6E6BFF]/60"></div>
							</PanelResizeHandle>

							{/* Full-width timeline */}
							<Panel defaultSize={40} maxSize={56} minSize={26} className="min-h-[220px]">
								<div className="editor-timeline-panel h-full overflow-hidden flex flex-col">
									<div className="editor-timeline-header flex items-center h-11 flex-shrink-0 gap-2 px-3 border-b border-white/[0.06]">
										<PlaybackControls
											variant="docked"
											isPlaying={isPlaying}
											currentTime={currentTime}
											duration={masterDuration}
											isFullscreen={isFullscreen}
											onToggleFullscreen={toggleFullscreen}
											onTogglePlayPause={togglePlayPause}
											onSeek={handleSeek}
										/>
									</div>
									<TimelineEditor
										videoDuration={totalDuration}
										currentTime={currentTime}
										introClip={introClip}
										introDurationMs={introDurationMs}
										onIntroDelete={handleDeleteIntroClip}
										onSeek={handleSeek}
										zoomRegions={zoomRegions}
										onZoomAdded={handleZoomAdded}
										autoZoomEnabled={autoZoomEnabled}
										onToggleAutoZoom={handleToggleAutoZoom}
										autoFocusAll={autoFocusAll}
										onToggleAutoFocusAll={handleToggleAutoFocusAll}
										onZoomSpanChange={handleZoomSpanChange}
										onZoomDelete={handleZoomDelete}
										selectedZoomId={selectedZoomId}
										onSelectZoom={handleSelectZoom}
										trimRegions={trimRegions}
										onTrimAdded={handleTrimAdded}
										onTrimSpanChange={handleTrimSpanChange}
										onTrimDelete={handleTrimDelete}
										selectedTrimId={selectedTrimId}
										onSelectTrim={handleSelectTrim}
										speedRegions={speedRegions}
										onSpeedAdded={handleSpeedAdded}
										onSpeedSpanChange={handleSpeedSpanChange}
										onSpeedDelete={handleSpeedDelete}
										selectedSpeedId={selectedSpeedId}
										onSelectSpeed={handleSelectSpeed}
										annotationRegions={annotationOnlyRegions}
										onAnnotationAdded={handleAnnotationAdded}
										onAnnotationSpanChange={handleAnnotationSpanChange}
										onAnnotationDelete={handleAnnotationDelete}
										selectedAnnotationId={selectedAnnotationId}
										onSelectAnnotation={handleSelectAnnotation}
										blurRegions={blurRegions}
										onBlurAdded={handleBlurAdded}
										onBlurSpanChange={handleAnnotationSpanChange}
										onBlurDelete={handleAnnotationDelete}
										selectedBlurId={selectedBlurId}
										onSelectBlur={handleSelectBlur}
										aspectRatio={aspectRatio}
										onAspectRatioChange={(ar) =>
											pushState({
												aspectRatio: ar,
												webcamLayoutPreset:
													(isPortraitAspectRatio(ar) && webcamLayoutPreset === "dual-frame") ||
													(!isPortraitAspectRatio(ar) && webcamLayoutPreset === "vertical-stack")
														? "picture-in-picture"
														: webcamLayoutPreset,
											})
										}
										videoClips={editorState.videoClips}
										onClipSpanChange={handleClipSpanChange}
										onClipDelete={handleClipDelete}
										selectedClipId={selectedClipId}
										onSelectClip={handleSelectClip}
										videoUrl={videoPath ?? undefined}
										showTrimWaveform={showTrimWaveform}
										captionsLabel={t("autoCaptions.button")}
										isGeneratingCaptions={isAutoCaptioning}
										onGenerateCaptions={() => {
											if (!videoPath) {
												toast.error(t("errors.noVideoLoaded"));
												return;
											}
											if (isAutoCaptioningRef.current) {
												toast.error(t("autoCaptions.busy"));
												return;
											}
											setShowAutoCaptionsDialog(true);
										}}
									/>
								</div>
							</Panel>
						</PanelGroup>
					</div>
				</div>
			)}

			<PolishSetupDialog
				open={showPolishSetup}
				onOpenChange={setShowPolishSetup}
				options={polishOptions}
				onOptionsChange={updatePolishOptions}
				onRun={handleAutoPolish}
				isRunning={isAutoPolishing}
				isAuthenticated={isBackendAuthed}
			/>

			<ProGateDialog
				open={showPublishGate}
				onOpenChange={setShowPublishGate}
				feature="unlimited-publishing"
			/>

			<ExportDialog
				isOpen={showExportDialog}
				onClose={() => {
					setShowExportDialog(false);
					setExportProgress(null);
					setExportError(null);
				}}
				progress={exportProgress}
				isExporting={isExporting}
				error={exportError}
				onCancel={handleCancelExport}
				exportFormat={exportFormat}
				exportedFilePath={exportedFilePath || undefined}
				onShowInFolder={
					exportedFilePath ? () => void handleShowExportedFile(exportedFilePath) : undefined
				}
			/>

			<UnsavedChangesDialog
				isOpen={showCloseConfirmDialog}
				onSaveAndClose={handleCloseConfirmSave}
				onDiscardAndClose={handleCloseConfirmDiscard}
				onCancel={handleCloseConfirmCancel}
			/>

			<UnsavedChangesDialog
				isOpen={confirmDialogVariant !== null}
				variant={confirmDialogVariant ?? "newProject"}
				onSaveAndClose={
					confirmDialogVariant === "loadProject"
						? handleLoadProjectConfirmSave
						: handleNewProjectConfirmSave
				}
				onDiscardAndClose={
					confirmDialogVariant === "loadProject"
						? handleLoadProjectConfirmDiscard
						: handleNewProjectConfirmDiscard
				}
				onCancel={() => setConfirmDialogVariant(null)}
			/>
		</div>
	);
}
