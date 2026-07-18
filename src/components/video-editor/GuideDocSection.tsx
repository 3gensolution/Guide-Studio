/**
 * GuideDocSection — "record once, ship the video guide and the doc."
 * Detects steps from click telemetry, captures a screenshot per step with
 * the click highlighted, and titles steps with AI when available. The steps
 * then drive two outputs: a video guide applied to the timeline — either
 * a Guidde-style tutorial (click highlights, zooms, instructional
 * voiceover) or a Loom-style async message (natural screen, casual
 * first-person voiceover), idle time trimmed in both — and a
 * Scribe-style doc exported as single-file HTML or Markdown.
 */
import { BookOpenText, Clapperboard, Copy, FileCode2, FileText, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAIService } from "@/hooks/useAIService";
import { captureStepScreenshots, downscaleDataUrl } from "@/lib/ai/frameCapture";
import { renderGuideHtml, renderGuideMarkdown } from "@/lib/ai/guideDocExporter";
import {
	applyStepTitles,
	buildStepTitlePrompt,
	buildStepTitleVisionMessages,
	detectGuideSteps,
} from "@/lib/ai/guideSteps";
import { VOICE_OPTIONS } from "@/lib/ai/polishTemplates";
import type { CaptionTrack, GuideDoc, GuideStep } from "@/lib/ai/types";
import {
	DEFAULT_VIDEO_GUIDE_OPTIONS,
	LOOM_VIDEO_GUIDE_OPTIONS,
	type VideoGuideOptions,
	type VideoGuideStyle,
} from "@/lib/ai/videoGuide";
import { aiService } from "@/lib/api/ai";
import type { CursorTelemetryPoint } from "./types";

interface GuideDocSectionProps {
	cursorTelemetry: CursorTelemetryPoint[];
	videoDurationMs: number;
	captionTrack: CaptionTrack | null;
	videoPath?: string | null;
	onSeek?: (timeMs: number) => void;
	/** Apply the steps to the timeline as a Guidde-style video guide */
	onCreateVideoGuide?: (
		steps: GuideStep[],
		guideTitle: string,
		options: VideoGuideOptions,
	) => Promise<void>;
}

function formatTimestamp(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Width of screenshots sent to the vision model — big enough to read UI
 *  labels, small enough to keep a 40-step request tractable. */
const VISION_FRAME_WIDTH = 720;

/** Pull the JSON array out of a chat response (tolerates code fences/prose). */
function parseJsonArray(content: string): unknown {
	const start = content.indexOf("[");
	const end = content.lastIndexOf("]");
	if (start === -1 || end <= start) throw new Error("No JSON array in response");
	return JSON.parse(content.slice(start, end + 1));
}

export function GuideDocSection({
	cursorTelemetry,
	videoDurationMs,
	captionTrack,
	videoPath,
	onSeek,
	onCreateVideoGuide,
}: GuideDocSectionProps) {
	const { generateJSON, isUsingBackend } = useAIService();

	const [steps, setSteps] = useState<GuideStep[]>([]);
	const [guideTitle, setGuideTitle] = useState("Step-by-step Guide");
	const [isGenerating, setIsGenerating] = useState(false);
	const [progressLabel, setProgressLabel] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);
	const [guideOptions, setGuideOptions] = useState<VideoGuideOptions>(DEFAULT_VIDEO_GUIDE_OPTIONS);

	const hasTelemetry = cursorTelemetry.length > 0 && videoDurationMs > 0;

	const handleGenerate = useCallback(async () => {
		if (!hasTelemetry) return;
		setIsGenerating(true);
		setProgressLabel("Detecting steps…");

		try {
			let detected = detectGuideSteps(cursorTelemetry, videoDurationMs, captionTrack);
			if (detected.length === 0) {
				toast.error("No interactions detected in this recording");
				return;
			}

			if (videoPath) {
				setProgressLabel(`Capturing screenshots (0/${detected.length})…`);
				detected = await captureStepScreenshots(videoPath, detected, (done, total) => {
					setProgressLabel(`Capturing screenshots (${done}/${total})…`);
				});
			}

			// AI titling is best-effort — heuristic titles already work offline.
			// Preferred path: the vision model reads each step's screenshot so
			// titles name the real UI; text-only prompt is the fallback.
			setProgressLabel("Writing step titles with AI…");
			try {
				let titled = false;
				if (isUsingBackend) {
					const visionSteps = await Promise.all(
						detected.map(async (step) =>
							step.screenshotDataUrl
								? {
										...step,
										screenshotDataUrl: await downscaleDataUrl(
											step.screenshotDataUrl,
											VISION_FRAME_WIDTH,
										),
									}
								: step,
						),
					);
					const messages = buildStepTitleVisionMessages(visionSteps, guideTitle);
					if (messages) {
						// Vision batches (one screenshot per step) can take well over the
						// client's default 30s — give them a real budget.
						const result = await aiService.chatCompletion(
							{ messages, temperature: 0.4 },
							{ timeoutMs: 180_000 },
						);
						if (result.success) {
							detected = applyStepTitles(detected, parseJsonArray(result.data.content));
							titled = true;
						}
					}
				}
				if (!titled) {
					const prompt = buildStepTitlePrompt(detected, guideTitle);
					if (prompt) {
						detected = applyStepTitles(detected, await generateJSON(prompt));
					}
				}
			} catch {
				toast.info("AI unavailable — using automatic step titles");
			}

			setSteps(detected);
			toast.success(`Guide generated: ${detected.length} steps`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to generate guide");
		} finally {
			setIsGenerating(false);
			setProgressLabel(null);
		}
	}, [
		hasTelemetry,
		cursorTelemetry,
		videoDurationMs,
		captionTrack,
		videoPath,
		guideTitle,
		generateJSON,
		isUsingBackend,
	]);

	const buildDoc = useCallback(
		(): GuideDoc => ({
			title: guideTitle.trim() || "Step-by-step Guide",
			intro: "",
			steps,
			createdAt: Date.now(),
			durationMs: videoDurationMs,
		}),
		[guideTitle, steps, videoDurationMs],
	);

	const handleExport = useCallback(
		async (format: "html" | "md") => {
			if (steps.length === 0) return;
			setIsExporting(true);
			try {
				const doc = buildDoc();
				const content = format === "html" ? renderGuideHtml(doc) : renderGuideMarkdown(doc);
				const result = await window.electronAPI.saveGuideDoc(content, doc.title, format);
				if (result.success && result.path) {
					toast.success("Guide exported", { description: result.path });
				} else if (!result.canceled) {
					toast.error(result.error || "Failed to save guide");
				}
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Failed to export guide");
			} finally {
				setIsExporting(false);
			}
		},
		[steps, buildDoc],
	);

	const [isCreatingVideoGuide, setIsCreatingVideoGuide] = useState(false);

	const handleCreateVideoGuide = useCallback(async () => {
		if (steps.length === 0 || !onCreateVideoGuide) return;
		setIsCreatingVideoGuide(true);
		try {
			await onCreateVideoGuide(steps, guideTitle, guideOptions);
		} finally {
			setIsCreatingVideoGuide(false);
		}
	}, [steps, guideTitle, guideOptions, onCreateVideoGuide]);

	const toggleOption = useCallback((key: "highlights" | "zooms" | "trimIdle" | "voiceover") => {
		setGuideOptions((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	// Picking a style resets the visual toggles to that style's defaults
	// (tutorial = zooms + arrows, loom = natural screen); the voice sticks.
	const selectStyle = useCallback((style: VideoGuideStyle) => {
		setGuideOptions((prev) => ({
			...(style === "loom" ? LOOM_VIDEO_GUIDE_OPTIONS : DEFAULT_VIDEO_GUIDE_OPTIONS),
			voiceId: prev.voiceId,
		}));
	}, []);

	const handleCopyMarkdown = useCallback(async () => {
		if (steps.length === 0) return;
		try {
			await navigator.clipboard.writeText(renderGuideMarkdown(buildDoc()));
			toast.success("Markdown copied — paste into Notion, Confluence, or GitHub");
		} catch {
			toast.error("Failed to copy to clipboard");
		}
	}, [steps, buildDoc]);

	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				onClick={handleGenerate}
				disabled={isGenerating || !hasTelemetry}
				className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#6E6BFF]/20 to-[#2563eb]/20 hover:from-[#6E6BFF]/30 hover:to-[#2563eb]/30 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
			>
				{steps.length > 0 ? <RefreshCw size={14} /> : <BookOpenText size={14} />}
				{isGenerating
					? (progressLabel ?? "Generating…")
					: steps.length > 0
						? "Regenerate Guide"
						: "Generate Step Guide"}
			</button>

			{!hasTelemetry && (
				<div className="text-[10px] text-white/40">Requires a recording with cursor telemetry.</div>
			)}

			{steps.length > 0 && (
				<>
					<input
						type="text"
						value={guideTitle}
						onChange={(e) => setGuideTitle(e.target.value)}
						placeholder="Guide title"
						className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/30 focus:outline-none focus:border-[#6E6BFF]/50"
					/>

					<div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
						{steps.map((step) => (
							<button
								type="button"
								key={step.id}
								onClick={() => onSeek?.(step.timeMs)}
								className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#6E6BFF]/30 transition-colors text-left w-full"
								title="Click to jump to this step"
							>
								{step.screenshotDataUrl && (
									<img
										src={step.screenshotDataUrl}
										alt=""
										className="w-14 h-9 object-cover rounded flex-shrink-0 border border-white/10"
									/>
								)}
								<div className="flex-1 min-w-0">
									<div className="text-[10px] text-white/80 font-medium truncate">{step.title}</div>
									<div className="text-[9px] text-white/40">{formatTimestamp(step.timeMs)}</div>
								</div>
							</button>
						))}
					</div>

					{onCreateVideoGuide && (
						<>
							<button
								type="button"
								onClick={handleCreateVideoGuide}
								disabled
								className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-[#6E6BFF] hover:bg-[#5B58E6] text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
							>
								<Clapperboard size={14} />
								{isCreatingVideoGuide ? "Creating…" : "Create Video Guide"}
							</button>

							<div className="flex gap-1">
								{(
									[
										["tutorial", "Tutorial"],
										["loom", "Loom-style"],
									] as const
								).map(([style, label]) => (
									<button
										type="button"
										key={style}
										onClick={() => selectStyle(style)}
										className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
											guideOptions.style === style
												? "bg-[#6E6BFF]/20 text-[#6E6BFF] border border-[#6E6BFF]/40"
												: "bg-white/5 text-white/40 border border-transparent hover:bg-white/10"
										}`}
									>
										{label}
									</button>
								))}
							</div>
							<div className="text-[9px] text-white/30">
								{guideOptions.style === "loom"
									? "Natural screen with a casual, first-person voiceover — like a quick async video message."
									: "Produced walkthrough with zooms, click arrows, and an instructional voiceover."}
							</div>

							<div className="grid grid-cols-2 gap-1">
								{(
									[
										["highlights", "Highlights"],
										["trimIdle", "Trim idle"],
										["voiceover", "Voiceover"],
										["zooms", "Zooms"],
									] as const
								).map(([key, label]) => (
									<button
										type="button"
										key={key}
										onClick={() => toggleOption(key)}
										className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
											guideOptions[key]
												? "bg-[#6E6BFF]/20 text-[#6E6BFF]"
												: "bg-white/5 text-white/40 hover:bg-white/10"
										}`}
									>
										{label}
									</button>
								))}
							</div>

							{guideOptions.voiceover && (
								<select
									value={guideOptions.voiceId}
									onChange={(e) =>
										setGuideOptions((prev) => ({ ...prev, voiceId: e.target.value }))
									}
									className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/70 focus:outline-none focus:border-[#6E6BFF]/50"
								>
									{VOICE_OPTIONS.map((voice) => (
										<option key={voice.id} value={voice.id} className="bg-[#1C1917]">
											{voice.name}
										</option>
									))}
								</select>
							)}
						</>
					)}

					<div className="text-[9px] text-white/30 uppercase tracking-wide pt-1">Export as doc</div>
					<div className="flex gap-1">
						<button
							type="button"
							onClick={() => handleExport("html")}
							disabled={isExporting}
							className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-[#6E6BFF]/20 hover:bg-[#6E6BFF]/30 text-[#6E6BFF] disabled:opacity-40 transition-colors"
						>
							<FileCode2 size={10} />
							HTML
						</button>
						<button
							type="button"
							onClick={() => handleExport("md")}
							disabled={isExporting}
							className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/70 disabled:opacity-40 transition-colors"
						>
							<FileText size={10} />
							Markdown
						</button>
						<button
							type="button"
							onClick={handleCopyMarkdown}
							className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
							title="Copy Markdown to clipboard"
						>
							<Copy size={10} />
						</button>
					</div>
				</>
			)}
		</div>
	);
}
