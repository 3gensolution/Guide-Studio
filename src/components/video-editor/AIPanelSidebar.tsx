/**
 * AIPanelSidebar — collapsible sidebar panel for AI features.
 * Contains: Video Guide, Smart Trim, Magic Polish, Auto-Narrate, Extract Clips,
 * Publish Kit, AI Settings.
 */
import {
	Captions,
	Check,
	ChevronDown,
	ChevronRight,
	Clapperboard,
	Film,
	LogIn,
	LogOut,
	Megaphone,
	Mic,
	MonitorPlay,
	Music2,
	ScanEye,
	Scissors,
	Settings2,
	Sparkles,
	TextCursorInput,
	Wand2,
	WandSparkles,
	X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useBackend } from "@/contexts/BackendContext";
import { useAIPreflight } from "@/hooks/useAIPreflight";
import { useAIService } from "@/hooks/useAIService";
import type { EditorState } from "@/hooks/useEditorHistory";
import { extractClips } from "@/lib/ai/clipExtractor";
import { generatePolishEdits } from "@/lib/ai/oneClickPolish";
import { analyzeRecording } from "@/lib/ai/recordingAnalyzer";
import type { CaptionTrack, ExtractedClip, GuideStep, PolishPreview } from "@/lib/ai/types";
import { createVideoGuide, VideoGuideAuthError, type VideoGuideOptions } from "@/lib/ai/videoGuide";
import { MusicSection, NarrationSection } from "./AudioAISections";
import { GuideDocSection } from "./GuideDocSection";
import { IntroBuilderSection } from "./IntroBuilderSection";
import { PublishKitSection } from "./PublishKitSection";
import { SmartTrimSuggestions } from "./SmartTrimSuggestions";
import { TranscriptEditSection } from "./TranscriptEditSection";
import type { CursorTelemetryPoint, TrimRegion, VideoClip } from "./types";

// ── Section collapse component ──

function Section({
	title,
	icon: Icon,
	defaultOpen = false,
	children,
}: {
	title: string;
	icon: React.ComponentType<{ size?: string | number }>;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div className="border-b border-white/5 last:border-b-0">
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-white/80 hover:text-white hover:bg-white/5 transition-colors"
			>
				<Icon size={14} />
				<span className="flex-1 text-left">{title}</span>
				{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
			</button>
			{open && <div className="px-3 pb-3">{children}</div>}
		</div>
	);
}

// ── Main component ──

interface AIPanelSidebarProps {
	cursorTelemetry: CursorTelemetryPoint[];
	videoDurationMs: number;
	editorState: EditorState;
	onApplyEdits: (edits: Partial<EditorState>) => void;
	onAcceptTrimSuggestions: (trims: TrimRegion[]) => void;
	onSeek?: (timeMs: number) => void;
	onInsertIntroClip?: (clip: VideoClip) => void;
	autoZoomEnabled?: boolean;
	onToggleAutoZoom?: (enabled: boolean) => void;
	autoFocusAll?: boolean;
	onToggleAutoFocusAll?: (on: boolean) => void;
	onGenerateCaptions?: () => void;
	isGeneratingCaptions?: boolean;
	captionTrack?: CaptionTrack | null;
	videoPath?: string | null;
}

export function AIPanelSidebar({
	cursorTelemetry,
	videoDurationMs,
	editorState,
	onApplyEdits,
	onAcceptTrimSuggestions,
	onSeek,
	onInsertIntroClip,
	autoZoomEnabled = true,
	onToggleAutoZoom,
	autoFocusAll = false,
	onToggleAutoFocusAll,
	onGenerateCaptions,
	isGeneratingCaptions = false,
	captionTrack = null,
	videoPath = null,
}: AIPanelSidebarProps) {
	// ── Backend + AI service ──
	const { isBackendAvailable, isAuthenticated, user, showLogin, logout } = useBackend();
	const { analyze } = useAIService();

	// ── AI preflight (backend auth check) ──
	const { requireChatProvider } = useAIPreflight();

	// ── Video Guide — apply detected steps to the timeline as a produced guide ──
	const handleCreateVideoGuide = useCallback(
		async (steps: GuideStep[], guideTitle: string, options: VideoGuideOptions) => {
			// Voiceover is the only stage that needs the account
			if (options.voiceover && !(isBackendAvailable && isAuthenticated)) {
				toast.info("Sign in to add a voiceover, or turn the Voiceover option off.");
				showLogin();
				return;
			}

			const toastId = toast.loading("Creating video guide…");
			try {
				const { edits, summary, warnings } = await createVideoGuide({
					steps,
					guideTitle,
					timelineDurationMs: videoDurationMs,
					currentState: editorState,
					captionTrack,
					options,
					onProgress: (message) => toast.loading(message, { id: toastId }),
				});
				if (summary.stepCount === 0) {
					toast.error("No steps land inside the recording clip on the timeline", { id: toastId });
					return;
				}
				onApplyEdits(edits);
				const parts = [
					summary.highlightCount ? `${summary.highlightCount} click highlights` : null,
					summary.narrationLineCount ? `${summary.narrationLineCount} narration lines` : null,
					summary.trimCount
						? `${summary.trimCount} idle trims (−${Math.round(summary.trimmedMs / 1000)}s)`
						: null,
					summary.zoomCount ? `${summary.zoomCount} zooms` : null,
				].filter(Boolean);
				toast.success(
					`Video guide created: ${summary.stepCount} clicks${parts.length ? ` — ${parts.join(", ")}` : ""}`,
					{ id: toastId, description: "Undo (⌘Z) reverts the whole pass." },
				);
				if (warnings.length > 0) toast.warning(warnings[0]);
			} catch (err) {
				if (err instanceof VideoGuideAuthError) {
					toast.dismiss(toastId);
					toast.info("Sign in to add a voiceover, or turn the Voiceover option off.");
					showLogin();
				} else {
					toast.error(err instanceof Error ? err.message : "Failed to create video guide", {
						id: toastId,
					});
				}
			}
		},
		[
			videoDurationMs,
			editorState,
			captionTrack,
			onApplyEdits,
			isBackendAvailable,
			isAuthenticated,
			showLogin,
		],
	);

	// ── Magic Polish ──
	const [polishPreview, setPolishPreview] = useState<PolishPreview | null>(null);
	const [polishEdits, setPolishEdits] = useState<Partial<EditorState> | null>(null);
	const [isPolishing, setIsPolishing] = useState(false);

	const handleRunPolish = useCallback(() => {
		if (cursorTelemetry.length === 0 || videoDurationMs <= 0) return;
		setIsPolishing(true);

		requestAnimationFrame(() => {
			const result = generatePolishEdits({
				cursorTelemetry,
				videoDurationMs,
				currentState: editorState,
			});
			setPolishPreview(result.preview);
			setPolishEdits(result.edits);
			setIsPolishing(false);
		});
	}, [cursorTelemetry, videoDurationMs, editorState]);

	const handleApplyPolish = useCallback(() => {
		if (!polishEdits) return;
		onApplyEdits(polishEdits);
		setPolishPreview(null);
		setPolishEdits(null);
	}, [polishEdits, onApplyEdits]);

	const handleCancelPolish = useCallback(() => {
		setPolishPreview(null);
		setPolishEdits(null);
	}, []);

	// ── Extract Clips ──
	const [clips, setClips] = useState<ExtractedClip[]>([]);
	const [isExtractingClips, setIsExtractingClips] = useState(false);

	const handleExtractClips = useCallback(async () => {
		if (cursorTelemetry.length === 0 || videoDurationMs <= 0) return;
		if (!(await requireChatProvider("Extract Clips"))) return;
		setIsExtractingClips(true);

		try {
			const profile = analyzeRecording(cursorTelemetry, videoDurationMs);
			const heuristicClips = extractClips(profile, videoDurationMs, 3);

			if (heuristicClips.length > 0) {
				const clipDescriptions = heuristicClips
					.map(
						(c) =>
							`Clip at ${Math.round(c.startMs / 1000)}s-${Math.round(c.endMs / 1000)}s (score: ${Math.round(c.score * 100)}%)`,
					)
					.join("\n");

				try {
					const aiText = await analyze(
						"For each clip timestamp below from a screen recording, suggest a short descriptive title (3-6 words). " +
							"Return one title per line, matching the order of clips.\n\n" +
							clipDescriptions,
					);

					if (aiText) {
						const titles = aiText.split("\n").filter((l: string) => l.trim());
						for (let i = 0; i < Math.min(titles.length, heuristicClips.length); i++) {
							heuristicClips[i].title = titles[i].replace(/^\d+[.)]\s*/, "").trim();
						}
					}
				} catch (titleErr) {
					toast.error(
						`Couldn't generate clip titles: ${titleErr instanceof Error ? titleErr.message : String(titleErr)}`,
					);
				}
			}

			setClips(heuristicClips);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to extract clips");
		} finally {
			setIsExtractingClips(false);
		}
	}, [cursorTelemetry, videoDurationMs, requireChatProvider, analyze]);

	function formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, "0")}`;
	}

	const hasTelemetry = cursorTelemetry.length > 0 && videoDurationMs > 0;

	return (
		<div className="h-full flex flex-col bg-[#1C1917] rounded-2xl border border-white/5 shadow-lg overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
				<Sparkles size={14} className="text-[#2563eb]" />
				<span className="text-xs font-semibold text-white/90">AI Features</span>
				<span
					className={`ml-auto text-[9px] px-1.5 py-0.5 rounded ${
						isBackendAvailable && isAuthenticated
							? "bg-[#2563eb]/20 text-[#2563eb]"
							: "bg-white/10 text-white/40"
					}`}
				>
					{isBackendAvailable && isAuthenticated ? "Connected" : "Offline"}
				</span>
			</div>

			{/* Scrollable sections */}
			<div className="flex-1 overflow-y-auto">
				{/* Video Guide — temporarily disabled (remove the wrapper div to restore) */}
				<Section title="Video Guide" icon={MonitorPlay} defaultOpen>
					<div className="pointer-events-none opacity-50" aria-disabled="true">
						<GuideDocSection
							cursorTelemetry={cursorTelemetry}
							videoDurationMs={videoDurationMs}
							captionTrack={captionTrack}
							videoPath={videoPath}
							onSeek={onSeek}
							onCreateVideoGuide={handleCreateVideoGuide}
						/>
					</div>
				</Section>

				{/* Auto-Zoom */}
				<Section title="Auto-Zoom" icon={WandSparkles} defaultOpen>
					<div className="flex flex-col gap-2">
						<button
							type="button"
							onClick={() => onToggleAutoZoom?.(!autoZoomEnabled)}
							className={`flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all ${
								autoZoomEnabled
									? "bg-[#6E6BFF]/20 text-[#6E6BFF] hover:bg-[#6E6BFF]/30"
									: "bg-white/10 text-white/80 hover:bg-white/15"
							}`}
						>
							<WandSparkles size={14} />
							{autoZoomEnabled ? "Auto-Zoom On" : "Auto-Zoom Off"}
						</button>
					</div>
				</Section>

				{/* Auto-Focus */}
				<Section title="Auto-Focus" icon={ScanEye}>
					<div className="flex flex-col gap-2">
						<button
							type="button"
							onClick={() => onToggleAutoFocusAll?.(!autoFocusAll)}
							className={`flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all ${
								autoFocusAll
									? "bg-[#6E6BFF]/20 text-[#6E6BFF] hover:bg-[#6E6BFF]/30"
									: "bg-white/10 text-white/80 hover:bg-white/15"
							}`}
						>
							<ScanEye size={14} />
							{autoFocusAll ? "Auto-Focus On" : "Auto-Focus Off"}
						</button>
					</div>
				</Section>

				{/* Captions */}
				{onGenerateCaptions && (
					<Section title="Captions" icon={Captions}>
						<div className="flex flex-col gap-2">
							<button
								type="button"
								onClick={onGenerateCaptions}
								disabled={isGeneratingCaptions}
								className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#a78bfa]/20 to-purple-500/20 hover:from-[#a78bfa]/30 hover:to-purple-500/30 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
							>
								<Captions size={14} />
								{isGeneratingCaptions ? "Generating..." : "Generate Captions"}
							</button>
						</div>
					</Section>
				)}

				{/* Transcript Edit — cut the video by cutting words */}
				<Section title="Transcript Edit" icon={TextCursorInput}>
					<TranscriptEditSection
						captionTrack={captionTrack}
						videoDurationMs={videoDurationMs}
						onAcceptTrimSuggestions={onAcceptTrimSuggestions}
						onSeek={onSeek}
					/>
				</Section>

				{/* Smart Trim */}
				<Section title="Smart Trim" icon={Scissors} defaultOpen>
					<SmartTrimSuggestions
						cursorTelemetry={cursorTelemetry}
						videoDurationMs={videoDurationMs}
						onAcceptSuggestions={onAcceptTrimSuggestions}
					/>
				</Section>

				{/* AI Narration — standalone explainer voiceover with editable lines */}
				<Section title="AI Narration" icon={Mic}>
					<NarrationSection
						editorState={editorState}
						onApplyEdits={onApplyEdits}
						isBackendReady={isBackendAvailable && isAuthenticated}
						cursorTelemetry={cursorTelemetry}
						videoDurationMs={videoDurationMs}
						captionTrack={captionTrack}
						videoPath={videoPath}
					/>
				</Section>

				{/* Background Music */}
				<Section title="Background Music" icon={Music2}>
					<MusicSection
						editorState={editorState}
						onApplyEdits={onApplyEdits}
						isBackendReady={isBackendAvailable && isAuthenticated}
					/>
				</Section>

				{/* Magic Polish */}
				<Section title="Magic Polish" icon={Wand2}>
					<div className="flex flex-col gap-2">
						{!polishPreview ? (
							<button
								type="button"
								onClick={handleRunPolish}
								disabled={isPolishing || !hasTelemetry}
								className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#2563eb]/20 to-purple-500/20 hover:from-[#2563eb]/30 hover:to-purple-500/30 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
							>
								<Wand2 size={14} />
								{isPolishing ? "Analyzing..." : "Run Magic Polish"}
							</button>
						) : (
							<>
								<div className="text-[10px] text-white/60 space-y-1">
									{polishPreview.zoomCount > 0 && (
										<div>+ {polishPreview.zoomCount} auto-zoom regions</div>
									)}
									{polishPreview.trimCount > 0 && <div>+ {polishPreview.trimCount} auto-trims</div>}
									{polishPreview.speedRampCount > 0 && (
										<div>+ {polishPreview.speedRampCount} speed ramps</div>
									)}
									{polishPreview.wallpaperChanged && <div>+ Set wallpaper</div>}
									{polishPreview.borderRadiusChanged && <div>+ Border radius: 12px</div>}
									{polishPreview.paddingChanged && <div>+ Padding: 8px</div>}
								</div>
								<div className="flex gap-1">
									<button
										type="button"
										onClick={handleApplyPolish}
										className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-[#2563eb]/20 hover:bg-[#2563eb]/30 text-[#2563eb] transition-colors"
									>
										<Check size={10} />
										Apply
									</button>
									<button
										type="button"
										onClick={handleCancelPolish}
										className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/60 transition-colors"
									>
										<X size={10} />
									</button>
								</div>
							</>
						)}
					</div>
				</Section>

				{/* Extract Clips */}
				<Section title="Extract Clips" icon={Film}>
					<div className="flex flex-col gap-2">
						<button
							type="button"
							onClick={handleExtractClips}
							disabled={isExtractingClips || !hasTelemetry}
							className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
						>
							<Film size={14} />
							{isExtractingClips ? "Extracting..." : "Find Best Clips"}
						</button>

						{clips.length > 0 && (
							<div className="flex flex-col gap-1">
								{clips.map((clip) => (
									<button
										type="button"
										key={clip.id}
										className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#2563eb]/30 transition-colors cursor-pointer text-left w-full"
										onClick={() => onSeek?.(clip.startMs)}
										title="Click to jump to this clip"
									>
										<div className="flex-1 min-w-0">
											<div className="text-[10px] text-white/80 font-medium truncate">
												{clip.title}
											</div>
											<div className="text-[9px] text-white/40">
												{formatDuration(clip.startMs)} - {formatDuration(clip.endMs)} | Score:{" "}
												{Math.round(clip.score * 100)}%
											</div>
										</div>
									</button>
								))}
							</div>
						)}
					</div>
				</Section>

				{/* Publish Kit — chapters + YouTube metadata */}
				<Section title="Publish Kit" icon={Megaphone}>
					<PublishKitSection
						cursorTelemetry={cursorTelemetry}
						videoDurationMs={videoDurationMs}
						captionTrack={captionTrack}
					/>
				</Section>

				{/* Intro Builder */}
				<Section title="Intro Builder" icon={Clapperboard}>
					<IntroBuilderSection
						onInsertIntro={onInsertIntroClip}
						videoPath={videoPath}
						videoDurationMs={videoDurationMs}
					/>
				</Section>

				{/* Account */}
				<Section title="Account" icon={Settings2}>
					<div className="flex flex-col gap-2">
						{/* Backend auth status */}
						{isBackendAvailable && isAuthenticated && user && (
							<div className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#2563eb]/10 border border-[#2563eb]/20">
								<div className="w-5 h-5 rounded-full bg-[#2563eb]/30 flex items-center justify-center text-[9px] text-[#2563eb] font-bold">
									{user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
								</div>
								<div className="flex-1 min-w-0">
									<div className="text-[10px] text-white/80 truncate">{user.email}</div>
									<div className="text-[9px] text-[#2563eb]">Connected</div>
								</div>
								<button
									type="button"
									onClick={logout}
									className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
									title="Logout"
								>
									<LogOut size={12} />
								</button>
							</div>
						)}

						{isBackendAvailable && !isAuthenticated && (
							<button
								type="button"
								onClick={showLogin}
								className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#2563eb]/20 to-purple-500/20 hover:from-[#2563eb]/30 hover:to-purple-500/30 text-white/80 transition-all"
							>
								<LogIn size={14} />
								Sign in to use AI
							</button>
						)}

						{!isBackendAvailable && (
							<div className="text-[10px] text-white/40">
								Backend not available. Start the Docker backend to use AI features.
							</div>
						)}
					</div>
				</Section>
			</div>
		</div>
	);
}
