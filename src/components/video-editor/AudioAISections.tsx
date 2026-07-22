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
import {
	Download,
	Loader2,
	Mic,
	Music2,
	RefreshCw,
	Search,
	Square,
	Trash2,
	Upload,
	Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

// A track returned by the free-music (Openverse) search — mirrors the shape the
// main process returns from `freeMusicSearch`.
interface FreeMusicResult {
	id: string;
	title: string;
	creator: string;
	audioUrl: string;
	license: string;
	licenseUrl: string;
	durationMs: number;
	sourceUrl: string;
}

export function MusicSection({ editorState, onApplyEdits, isBackendReady }: MusicSectionProps) {
	const [styleId, setStyleId] = useState(MUSIC_STYLES[0].id);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const hasMusic = Boolean(editorState.backgroundMusic && editorState.backgroundMusic !== "none");

	// ── Free-music library search (Openverse, direct from the app) ──
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<FreeMusicResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [addingId, setAddingId] = useState<string | null>(null);
	const [previewId, setPreviewId] = useState<string | null>(null);
	const previewAudioRef = useRef<HTMLAudioElement | null>(null);

	const handleSearchMusic = useCallback(async () => {
		if (!window.electronAPI?.freeMusicSearch) {
			toast.error("Music search is unavailable in this environment.");
			return;
		}
		setIsSearching(true);
		try {
			const res = await window.electronAPI.freeMusicSearch(
				searchQuery.trim() || "background music",
			);
			if (res.error && res.results.length === 0) throw new Error(res.error);
			setSearchResults(res.results);
			if (res.results.length === 0) toast.info("No tracks found — try a different search.");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Music search failed");
		} finally {
			setIsSearching(false);
		}
	}, [searchQuery]);

	const togglePreview = useCallback(
		(result: FreeMusicResult) => {
			const el = previewAudioRef.current;
			if (!el) return;
			if (previewId === result.id) {
				el.pause();
				setPreviewId(null);
				return;
			}
			el.src = result.audioUrl;
			el.currentTime = 0;
			el.play().catch(() => toast.error("Couldn't preview this track."));
			setPreviewId(result.id);
		},
		[previewId],
	);

	const handleUseTrack = useCallback(
		async (result: FreeMusicResult) => {
			if (!window.electronAPI?.freeMusicDownload) return;
			setAddingId(result.id);
			const toastId = toast.loading("Adding track…");
			try {
				const dl = await window.electronAPI.freeMusicDownload(result.audioUrl, result.title);
				if (!dl.success || !dl.filePath)
					throw new Error(dl.error || "Could not download that track.");
				previewAudioRef.current?.pause();
				setPreviewId(null);
				onApplyEdits({
					backgroundMusic: dl.filePath,
					backgroundMusicVolume: editorState.backgroundMusicVolume || 18,
				});
				toast.success("Background music added", {
					id: toastId,
					description: `"${result.title}" by ${result.creator} — loops under your video.`,
				});
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Could not add that track", {
					id: toastId,
				});
			} finally {
				setAddingId(null);
			}
		},
		[editorState.backgroundMusicVolume, onApplyEdits],
	);

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

	// Import the user's own audio file as the background music bed. This is fully
	// local — it copies the file into the app's storage and needs no backend, so
	// it works even when signed out.
	const handleUpload = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			// Reset the input so picking the same file again re-triggers onChange.
			e.target.value = "";
			if (!file) return;

			setIsUploading(true);
			const toastId = toast.loading("Adding your track…");
			try {
				if (!window.electronAPI?.saveNarrationAudio) {
					throw new Error("Audio import is unavailable in this environment.");
				}
				const data = await file.arrayBuffer();
				if (data.byteLength === 0) throw new Error("That file appears to be empty.");
				const saved = await window.electronAPI.saveNarrationAudio(data);
				if (!saved.success || !saved.path) {
					throw new Error(saved.error || "Could not save the track to disk.");
				}
				onApplyEdits({
					backgroundMusic: saved.path,
					backgroundMusicVolume: editorState.backgroundMusicVolume || 18,
				});
				toast.success("Background music added", {
					id: toastId,
					description: "Plays under the video, ducked while narration speaks.",
				});
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Could not add that track", {
					id: toastId,
				});
			} finally {
				setIsUploading(false);
			}
		},
		[editorState.backgroundMusicVolume, onApplyEdits],
	);

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

			{/* Upload your own track — fully local, works without signing in. */}
			<input
				ref={fileInputRef}
				type="file"
				accept="audio/*"
				className="hidden"
				onChange={handleUpload}
			/>
			<button
				type="button"
				onClick={() => fileInputRef.current?.click()}
				disabled={isUploading || isGenerating}
				title="Use your own audio file as the background music"
				className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-white/70 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
			>
				{isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
				{isUploading ? "Uploading…" : "Upload track"}
			</button>

			{!isBackendReady && (
				<div className="text-[10px] text-white/40">
					Sign in to generate music, or search / upload your own track above.
				</div>
			)}

			{/* ── Search free music library (Openverse) — no account needed ── */}
			<div className="mt-1 border-t border-white/10 pt-2">
				<div className="text-[9px] text-white/30 uppercase tracking-wide mb-1.5">
					Search free music
				</div>
				<div className="flex gap-1">
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleSearchMusic();
						}}
						placeholder="e.g. calm piano, upbeat…"
						className="flex-1 min-w-0 px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/30 focus:outline-none focus:border-[#6E6BFF]/50"
					/>
					<button
						type="button"
						onClick={handleSearchMusic}
						disabled={isSearching}
						title="Search openly-licensed music"
						className="flex items-center justify-center px-2.5 rounded bg-white/[0.06] border border-white/10 hover:bg-white/[0.12] text-white/70 disabled:opacity-40 transition-colors"
					>
						{isSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
					</button>
				</div>

				{/* Hidden element used to preview a track before adding it. */}
				{/* biome-ignore lint/a11y/useMediaCaption: instrumental music preview */}
				<audio ref={previewAudioRef} onEnded={() => setPreviewId(null)} className="hidden" />

				{searchResults.length > 0 && (
					<div className="mt-2 flex flex-col gap-1 max-h-56 overflow-y-auto">
						{searchResults.map((r) => {
							const secs = r.durationMs > 0 ? Math.round(r.durationMs / 1000) : null;
							return (
								<div
									key={r.id}
									className="flex items-center gap-1.5 p-1.5 rounded bg-white/[0.03] border border-white/[0.06]"
								>
									<button
										type="button"
										onClick={() => togglePreview(r)}
										title="Preview"
										className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
									>
										{previewId === r.id ? <span className="text-[9px]">■</span> : "▶"}
									</button>
									<div className="min-w-0 flex-1">
										<div className="text-[11px] text-white/80 truncate">{r.title}</div>
										<div className="text-[9px] text-white/40 truncate">
											{r.creator}
											{secs ? ` · ${secs}s` : ""}
											{r.license ? ` · ${r.license.toUpperCase()}` : ""}
										</div>
									</div>
									<button
										type="button"
										onClick={() => handleUseTrack(r)}
										disabled={addingId === r.id}
										className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[#6E6BFF]/20 hover:bg-[#6E6BFF]/30 text-[#8B89FF] disabled:opacity-40 transition-colors"
									>
										{addingId === r.id ? (
											<Loader2 size={10} className="animate-spin" />
										) : (
											<Download size={10} />
										)}
										Use
									</button>
								</div>
							);
						})}
					</div>
				)}
			</div>

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

// mm:ss elapsed timer for the mic recorder button.
function formatRecTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

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
	const [isUploadingVoice, setIsUploadingVoice] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [recSeconds, setRecSeconds] = useState(0);
	const [revoicingId, setRevoicingId] = useState<string | null>(null);
	const voiceFileInputRef = useRef<HTMLInputElement>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const recChunksRef = useRef<BlobPart[]>([]);
	const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	// Local drafts so typing doesn't spam undo history; applied on re-voice.
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	const segments = editorState.narrationTrack?.segments ?? [];

	// Cap a mic recording at the video's length — there's nothing to lay a
	// voiceover over past the end of the clip. 0 means "unknown" → no cap.
	const recCapSeconds = videoDurationMs > 0 ? Math.ceil(videoDurationMs / 1000) : 0;

	// Add a single voiceover clip that plays once from the start over the whole
	// video (not looped). Fully local — no account needed. It rides the existing
	// narration plumbing (preview playback + export mux), so the "Mute original
	// audio" toggle below controls whether it replaces or layers over the
	// recording's own sound. Shared by both the file upload and the mic recorder;
	// FFmpeg and the preview <audio> both sniff by content, so a recorded
	// webm/opus blob works through the same path as an uploaded mp3.
	const commitVoiceover = useCallback(
		async (source: Blob, label: string, toastId: string | number) => {
			if (!window.electronAPI?.saveNarrationAudio) {
				throw new Error("Audio import is unavailable in this environment.");
			}
			const data = await source.arrayBuffer();
			if (data.byteLength === 0) throw new Error("That clip appears to be empty.");

			// Read the clip's real duration so the segment window matches the audio.
			const durationMs = await new Promise<number>((resolve) => {
				const probe = new Audio();
				probe.preload = "metadata";
				probe.onloadedmetadata = () => {
					const secs = Number.isFinite(probe.duration) ? probe.duration : 0;
					URL.revokeObjectURL(probe.src);
					resolve(secs > 0 ? Math.round(secs * 1000) : videoDurationMs || 0);
				};
				probe.onerror = () => resolve(videoDurationMs || 0);
				probe.src = URL.createObjectURL(source);
			});

			const saved = await window.electronAPI.saveNarrationAudio(data);
			if (!saved.success || !saved.path) {
				throw new Error(saved.error || "Could not save the voiceover to disk.");
			}

			onApplyEdits({
				narrationTrack: {
					segments: [
						{
							id: `voiceover-${durationMs}`,
							text: label,
							startMs: 0,
							endMs: durationMs > 0 ? durationMs : videoDurationMs || 1,
							audioPath: saved.path,
						},
					],
					language: "en",
				},
			});
			toast.success("Voiceover added", {
				id: toastId,
				description: "Plays from the start over your video. Use the toggle to mute the original.",
			});
		},
		[onApplyEdits, videoDurationMs],
	);

	// Upload your own voiceover from an audio file.
	const handleUploadVoiceover = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			e.target.value = ""; // let the same file re-trigger onChange
			if (!file) return;

			setIsUploadingVoice(true);
			const toastId = toast.loading("Adding your voiceover…");
			try {
				await commitVoiceover(file, "Uploaded voiceover", toastId);
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Could not add that voiceover", {
					id: toastId,
				});
			} finally {
				setIsUploadingVoice(false);
			}
		},
		[commitVoiceover],
	);

	// Record a voiceover straight from the mic — for when there's no file to
	// upload. Starts capturing on click; a second click stops and commits the
	// recording through the same path as an upload.
	const stopRecTimer = useCallback(() => {
		if (recTimerRef.current) {
			clearInterval(recTimerRef.current);
			recTimerRef.current = null;
		}
	}, []);

	const handleToggleRecording = useCallback(async () => {
		// Stop an in-progress recording — the recorder's onstop handler commits it.
		if (isRecording) {
			recorderRef.current?.stop();
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
				? "audio/webm;codecs=opus"
				: MediaRecorder.isTypeSupported("audio/webm")
					? "audio/webm"
					: "";
			const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
			recorderRef.current = recorder;
			recChunksRef.current = [];

			recorder.ondataavailable = (ev) => {
				if (ev.data.size > 0) recChunksRef.current.push(ev.data);
			};
			recorder.onstop = async () => {
				stopRecTimer();
				setIsRecording(false);
				for (const track of stream.getTracks()) track.stop();
				const blob = new Blob(recChunksRef.current, {
					type: recorder.mimeType || "audio/webm",
				});
				recChunksRef.current = [];
				recorderRef.current = null;
				if (blob.size === 0) {
					toast.error("Nothing was recorded — check your microphone.");
					return;
				}
				const toastId = toast.loading("Saving your recording…");
				try {
					await commitVoiceover(blob, "Recorded voiceover", toastId);
				} catch (err) {
					toast.error(err instanceof Error ? err.message : "Could not save that recording", {
						id: toastId,
					});
				}
			};

			recorder.start();
			setRecSeconds(0);
			setIsRecording(true);
			recTimerRef.current = setInterval(() => {
				setRecSeconds((prev) => {
					const next = prev + 1;
					// Auto-stop once the take reaches the video's length; onstop commits it.
					if (recCapSeconds > 0 && next >= recCapSeconds && recorder.state !== "inactive") {
						recorder.stop();
						return recCapSeconds;
					}
					return next;
				});
			}, 1000);
		} catch (err) {
			const denied = err instanceof DOMException && err.name === "NotAllowedError";
			toast.error(
				denied
					? "Microphone access was denied. Allow it to record a voiceover."
					: "Couldn't start recording — no microphone found.",
			);
		}
	}, [isRecording, commitVoiceover, stopRecTimer, recCapSeconds]);

	// Drop a narration line — or the whole uploaded/recorded voiceover — clearing
	// the track entirely when the last segment goes.
	const handleRemoveSegment = useCallback(
		(segment: NarrationSegment) => {
			const track = editorState.narrationTrack;
			if (!track) return;
			const remaining = track.segments.filter((s) => s !== segment);
			onApplyEdits({
				narrationTrack: remaining.length > 0 ? { ...track, segments: remaining } : null,
			});
		},
		[editorState.narrationTrack, onApplyEdits],
	);

	useEffect(() => {
		setDrafts({});
	}, []);

	// Tear down the mic/timer if the panel unmounts mid-recording.
	useEffect(() => {
		return () => {
			stopRecTimer();
			if (recorderRef.current && recorderRef.current.state !== "inactive") {
				for (const track of recorderRef.current.stream.getTracks()) track.stop();
				recorderRef.current.stop();
			}
		};
	}, [stopRecTimer]);

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

			{/* Your own voiceover — record from the mic, or upload a file. Fully
			    local, works without signing in. */}
			<input
				ref={voiceFileInputRef}
				type="file"
				accept="audio/*"
				className="hidden"
				onChange={handleUploadVoiceover}
			/>
			<div className="flex gap-1.5">
				<button
					type="button"
					onClick={handleToggleRecording}
					disabled={isUploadingVoice}
					title={isRecording ? "Stop recording" : "Record a voiceover with your microphone"}
					className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border disabled:opacity-40 disabled:cursor-not-allowed transition-all ${
						isRecording
							? "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30"
							: "bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08]"
					}`}
				>
					{isRecording ? (
						<>
							<Square size={11} className="fill-current" />
							Stop {formatRecTime(recSeconds)}
							{recCapSeconds > 0 ? ` / ${formatRecTime(recCapSeconds)}` : ""}
						</>
					) : (
						<>
							<Mic size={12} />
							Record
						</>
					)}
				</button>
				<button
					type="button"
					onClick={() => voiceFileInputRef.current?.click()}
					disabled={isUploadingVoice || isRecording}
					title="Use your own voice recording as the video's audio"
					className="flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-white/70 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
				>
					{isUploadingVoice ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
					{isUploadingVoice ? "Adding…" : "Upload"}
				</button>
			</div>

			{segments.length > 0 && (
				<>
					<label className="flex items-center gap-2 px-1 text-[10px] text-white/60 cursor-pointer">
						<input
							type="checkbox"
							checked={editorState.muteOriginalAudio}
							onChange={(e) => onApplyEdits({ muteOriginalAudio: e.target.checked })}
							className="accent-[#6E6BFF]"
						/>
						Mute original audio (your voice carries the video)
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
										<div className="flex items-center gap-1">
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
											<button
												type="button"
												onClick={() => handleRemoveSegment(segment)}
												title="Remove this voiceover"
												className="flex items-center justify-center p-1 rounded text-white/40 hover:text-red-300 hover:bg-red-500/15 transition-colors"
											>
												<Trash2 size={10} />
											</button>
										</div>
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
