/**
 * GuideDocSection — "record once, ship the doc too."
 * Detects steps from click telemetry, captures a screenshot per step with
 * the click highlighted, titles steps with AI when available, and exports
 * a Scribe-style guide as single-file HTML or Markdown.
 */
import { BookOpenText, Copy, FileCode2, FileText, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAIService } from "@/hooks/useAIService";
import { captureStepScreenshots } from "@/lib/ai/frameCapture";
import { renderGuideHtml, renderGuideMarkdown } from "@/lib/ai/guideDocExporter";
import { applyStepTitles, buildStepTitlePrompt, detectGuideSteps } from "@/lib/ai/guideSteps";
import type { CaptionTrack, GuideDoc, GuideStep } from "@/lib/ai/types";
import type { CursorTelemetryPoint } from "./types";

interface GuideDocSectionProps {
	cursorTelemetry: CursorTelemetryPoint[];
	videoDurationMs: number;
	captionTrack: CaptionTrack | null;
	videoPath?: string | null;
	onSeek?: (timeMs: number) => void;
}

function formatTimestamp(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function GuideDocSection({
	cursorTelemetry,
	videoDurationMs,
	captionTrack,
	videoPath,
	onSeek,
}: GuideDocSectionProps) {
	const { generateJSON } = useAIService();

	const [steps, setSteps] = useState<GuideStep[]>([]);
	const [guideTitle, setGuideTitle] = useState("Step-by-step Guide");
	const [isGenerating, setIsGenerating] = useState(false);
	const [progressLabel, setProgressLabel] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);

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

			// AI titling is best-effort — heuristic titles already work offline
			const prompt = buildStepTitlePrompt(detected, guideTitle);
			if (prompt) {
				setProgressLabel("Writing step titles with AI…");
				try {
					const response = await generateJSON(prompt);
					detected = applyStepTitles(detected, response);
				} catch {
					toast.info("AI unavailable — using automatic step titles");
				}
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
