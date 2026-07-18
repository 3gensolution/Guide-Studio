/**
 * Standalone AI audio tools for the AI panel:
 *
 * - MusicSection — generate a background music bed on its own (pick a style,
 *   set the volume, generate/remove). Same engine Magic Polish uses; this
 *   just makes it a first-class feature.
 * - NarrationSection — generate an AI voiceover on its own, in a chosen
 *   mode (explainer or casual), edit each line's text, re-voice edited
 *   lines, and optionally mute the recording's original audio so the AI
 *   voice carries the video.
 *
 * Both apply through onApplyEdits so a single undo reverts each action.
 */
import { Loader2, Mic, Music2, RefreshCw, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { EditorState } from "@/hooks/useEditorHistory";
import { localizeAudioUrl } from "@/lib/ai/autoPolish";
import { captureStepScreenshots, downscaleDataUrl } from "@/lib/ai/frameCapture";
import {
	applyStepTitles,
	buildStepTitleVisionMessages,
	detectGuideSteps,
} from "@/lib/ai/guideSteps";
import { MUSIC_STYLES, musicPromptForStyle, VOICE_OPTIONS } from "@/lib/ai/polishTemplates";
import type { CaptionTrack, NarrationSegment } from "@/lib/ai/types";
import { createVideoGuide, type VideoGuideStyle } from "@/lib/ai/videoGuide";
import { aiService } from "@/lib/api/ai";
import type { CursorTelemetryPoint } from "./types";

// ── Background Music ─────────────────────────────────────────────────────

interface MusicSectionProps {
	editorState: EditorState;
	onApplyEdits: (edits: Partial<EditorState>) => void;
	isBackendReady: boolean;
}

export function MusicSection({ editorState, onApplyEdits, isBackendReady }: MusicSectionProps) {
	const [styleId, setStyleId] = useState(MUSIC_STYLES[0].id);
	const [isGenerating, setIsGenerating] = useState(false);
	const hasMusic = Boolean(editorState.backgroundMusic && editorState.backgroundMusic !== "none");

	const handleGenerate = useCallback(async () => {
		setIsGenerating(true);
		try {
			const result = await aiService.generateMusic({
				prompt: musicPromptForStyle(styleId),
				duration: 30,
			});
			if (!result.success) throw new Error(result.error);
			const localPath = (await localizeAudioUrl(result.data.audioUrl)) ?? result.data.audioUrl;
			onApplyEdits({
				backgroundMusic: localPath,
				backgroundMusicVolume: editorState.backgroundMusicVolume || 18,
			});
			toast.success("Background music added", {
				description: "Plays under the video, ducked while narration speaks.",
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Music generation failed");
		} finally {
			setIsGenerating(false);
		}
	}, [styleId, editorState.backgroundMusicVolume, onApplyEdits]);

	return (
		<div className="flex flex-col gap-2">
			<Select value={styleId} onValueChange={setStyleId}>
				<SelectTrigger className="h-8 text-xs">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{MUSIC_STYLES.map((style) => (
						<SelectItem key={style.id} value={style.id} className="text-xs">
							{style.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			<button
				type="button"
				onClick={handleGenerate}
				disabled={isGenerating || !isBackendReady}
				className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#6E6BFF]/20 to-[#2563eb]/20 hover:from-[#6E6BFF]/30 hover:to-[#2563eb]/30 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
			>
				{isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Music2 size={14} />}
				{isGenerating ? "Composing…" : hasMusic ? "Regenerate Music" : "Generate Music"}
			</button>
			{!isBackendReady && (
				<div className="text-[10px] text-white/40">Sign in to generate music.</div>
			)}

			{hasMusic && (
				<>
					<div className="flex items-center gap-2 px-1">
						<Volume2 size={11} className="text-white/40 shrink-0" />
						<Slider
							value={[editorState.backgroundMusicVolume]}
							onValueChange={([v]) => onApplyEdits({ backgroundMusicVolume: v })}
							min={0}
							max={100}
							step={1}
						/>
						<span className="text-[10px] text-white/40 w-7 text-right">
							{editorState.backgroundMusicVolume}%
						</span>
					</div>
					<button
						type="button"
						onClick={() => onApplyEdits({ backgroundMusic: "none" })}
						className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
					>
						<Trash2 size={10} />
						Remove music
					</button>
				</>
			)}
		</div>
	);
}

// ── AI Narration ─────────────────────────────────────────────────────────

const NARRATION_MODES: Array<{ id: VideoGuideStyle; name: string; hint: string }> = [
	{ id: "tutorial", name: "Explainer", hint: "Narrates what's happening on screen" },
	{ id: "loom", name: "Casual", hint: "First-person, like a quick video message" },
];

interface NarrationSectionProps {
	editorState: EditorState;
	onApplyEdits: (edits: Partial<EditorState>) => void;
	isBackendReady: boolean;
	cursorTelemetry: CursorTelemetryPoint[];
	videoDurationMs: number;
	captionTrack: CaptionTrack | null;
	/** Recording path — lets the vision model read the screens it narrates */
	videoPath?: string | null;
}

export function NarrationSection({
	editorState,
	onApplyEdits,
	isBackendReady,
	cursorTelemetry,
	videoDurationMs,
	captionTrack,
	videoPath = null,
}: NarrationSectionProps) {
	const [mode, setMode] = useState<VideoGuideStyle>("tutorial");
	const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);
	const [isGenerating, setIsGenerating] = useState(false);
	const [revoicingId, setRevoicingId] = useState<string | null>(null);
	// Local drafts so typing doesn't spam undo history; applied on re-voice.
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	const segments = editorState.narrationTrack?.segments ?? [];
	useEffect(() => {
		setDrafts({});
	}, []);

	const handleGenerate = useCallback(async () => {
		let steps = detectGuideSteps(cursorTelemetry, videoDurationMs, captionTrack);
		if (steps.length === 0) {
			toast.error("No interactions detected to narrate");
			return;
		}
		setIsGenerating(true);
		const toastId = toast.loading("Reading the recording…");
		try {
			// Ground the narration in what's actually on screen: capture each
			// moment's frame and let the vision model name the real UI before
			// the voiceover writer describes it. Without this the writer only
			// sees click coordinates and invents content.
			if (videoPath) {
				steps = await captureStepScreenshots(videoPath, steps);
				const visionSteps = await Promise.all(
					steps.map(async (step) =>
						step.screenshotDataUrl
							? {
									...step,
									screenshotDataUrl: await downscaleDataUrl(step.screenshotDataUrl, 720),
								}
							: step,
					),
				);
				const messages = buildStepTitleVisionMessages(visionSteps, "");
				if (messages) {
					const titled = await aiService.chatCompletion(
						{ messages, temperature: 0.4 },
						{ timeoutMs: 180_000 },
					);
					if (titled.success) {
						try {
							const start = titled.data.content.indexOf("[");
							const end = titled.data.content.lastIndexOf("]");
							steps = applyStepTitles(steps, JSON.parse(titled.data.content.slice(start, end + 1)));
						} catch {
							// Vision titling is best-effort; narration still runs.
						}
					}
				}
			}
			toast.loading("Writing and voicing narration…", { id: toastId });
			const { edits, warnings } = await createVideoGuide({
				steps,
				guideTitle: "",
				timelineDurationMs: videoDurationMs,
				currentState: editorState,
				captionTrack,
				options: {
					style: mode,
					voiceover: true,
					voiceId,
					highlights: false,
					zooms: false,
					trimIdle: false,
				},
			});
			if (!edits.narrationTrack) {
				throw new Error(warnings[0] || "Narration came back empty");
			}
			// Narration only — leave every visual as it is.
			onApplyEdits({ narrationTrack: edits.narrationTrack });
			setDrafts({});
			toast.success(`Narration added: ${edits.narrationTrack.segments.length} lines`, {
				id: toastId,
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Narration failed", { id: toastId });
		} finally {
			setIsGenerating(false);
		}
	}, [
		cursorTelemetry,
		videoDurationMs,
		captionTrack,
		editorState,
		mode,
		voiceId,
		onApplyEdits,
		videoPath,
	]);

	// Apply an edited line: re-voice the text and swap the segment in place.
	const handleRevoice = useCallback(
		async (segment: NarrationSegment, key: string) => {
			const track = editorState.narrationTrack;
			if (!track) return;
			const text = (drafts[key] ?? segment.text).trim();
			if (!text) return;
			setRevoicingId(key);
			try {
				const tts = await aiService.generateSpeech({
					text,
					voice: track.voiceId || voiceId,
					model: "edge-tts",
				});
				if (!tts.success) throw new Error(tts.error);
				onApplyEdits({
					narrationTrack: {
						...track,
						segments: track.segments.map((s) =>
							s === segment ? { ...s, text, audioPath: tts.data.audioUrl } : s,
						),
					},
				});
				toast.success("Line re-voiced");
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Re-voicing failed");
			} finally {
				setRevoicingId(null);
			}
		},
		[editorState.narrationTrack, drafts, voiceId, onApplyEdits],
	);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-1">
				{NARRATION_MODES.map((m) => (
					<button
						type="button"
						key={m.id}
						onClick={() => setMode(m.id)}
						title={m.hint}
						className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
							mode === m.id
								? "bg-[#6E6BFF]/20 text-[#6E6BFF] border border-[#6E6BFF]/40"
								: "bg-white/5 text-white/40 border border-transparent hover:bg-white/10"
						}`}
					>
						{m.name}
					</button>
				))}
			</div>

			<select
				value={voiceId}
				onChange={(e) => setVoiceId(e.target.value)}
				className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/70 focus:outline-none focus:border-[#6E6BFF]/50"
			>
				{VOICE_OPTIONS.map((voice) => (
					<option key={voice.id} value={voice.id} className="bg-[#1C1917]">
						{voice.name}
					</option>
				))}
			</select>

			<button
				type="button"
				onClick={handleGenerate}
				disabled={isGenerating || !isBackendReady}
				className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#6E6BFF]/20 to-[#2563eb]/20 hover:from-[#6E6BFF]/30 hover:to-[#2563eb]/30 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
			>
				{isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
				{isGenerating
					? "Narrating…"
					: segments.length > 0
						? "Regenerate Narration"
						: "Generate Narration"}
			</button>
			{!isBackendReady && (
				<div className="text-[10px] text-white/40">Sign in to generate narration.</div>
			)}

			{segments.length > 0 && (
				<>
					<label className="flex items-center gap-2 px-1 text-[10px] text-white/60 cursor-pointer">
						<input
							type="checkbox"
							checked={editorState.muteOriginalAudio}
							onChange={(e) => onApplyEdits({ muteOriginalAudio: e.target.checked })}
							className="accent-[#6E6BFF]"
						/>
						Mute original audio (AI voice carries the video)
					</label>

					<div className="text-[9px] text-white/30 uppercase tracking-wide pt-1">
						Edit lines — change the text, then re-voice
					</div>
					<div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
						{segments.map((segment, index) => {
							const key = segment.id ?? `seg-${index}`;
							const draft = drafts[key] ?? segment.text;
							const dirty = draft !== segment.text;
							return (
								<div
									key={key}
									className="flex flex-col gap-1 p-1.5 rounded bg-white/5 border border-white/10"
								>
									<textarea
										value={draft}
										onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
										rows={2}
										className="w-full px-1.5 py-1 rounded bg-black/20 border border-white/10 text-[10px] text-white/80 resize-none focus:outline-none focus:border-[#6E6BFF]/50"
									/>
									<div className="flex items-center justify-between">
										<span className="text-[9px] text-white/35">
											{Math.round(segment.startMs / 1000)}s
											{segment.audioPath ? "" : " — no audio yet"}
										</span>
										<button
											type="button"
											onClick={() => handleRevoice(segment, key)}
											disabled={revoicingId === key || !isBackendReady}
											className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-colors disabled:opacity-40 ${
												dirty
													? "bg-[#6E6BFF]/25 text-[#8B89FF] hover:bg-[#6E6BFF]/35"
													: "bg-white/10 text-white/60 hover:bg-white/20"
											}`}
										>
											{revoicingId === key ? (
												<Loader2 size={9} className="animate-spin" />
											) : (
												<RefreshCw size={9} />
											)}
											{dirty ? "Save & re-voice" : "Re-voice"}
										</button>
									</div>
								</div>
							);
						})}
					</div>
				</>
			)}
		</div>
	);
}
