/**
 * PublishKitSection — one AI call turns the recording into YouTube-ready
 * metadata: title options, a description with chapter timestamps, and tags.
 */
import { Copy, Megaphone } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAIPreflight } from "@/hooks/useAIPreflight";
import { useAIService } from "@/hooks/useAIService";
import { detectGuideSteps } from "@/lib/ai/guideSteps";
import {
	buildPublishKitPrompt,
	deriveChapters,
	flattenTranscript,
	formatChapterTimestamp,
	parsePublishKitResponse,
	renderDescriptionWithChapters,
} from "@/lib/ai/publishKit";
import type { CaptionTrack, PublishKit } from "@/lib/ai/types";
import type { CursorTelemetryPoint } from "./types";

interface PublishKitSectionProps {
	cursorTelemetry: CursorTelemetryPoint[];
	videoDurationMs: number;
	captionTrack: CaptionTrack | null;
}

export function PublishKitSection({
	cursorTelemetry,
	videoDurationMs,
	captionTrack,
}: PublishKitSectionProps) {
	const { generateJSON } = useAIService();
	const { requireChatProvider } = useAIPreflight();

	const [kit, setKit] = useState<PublishKit | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);

	const hasContent = videoDurationMs > 0 && (cursorTelemetry.length > 0 || captionTrack !== null);

	const handleGenerate = useCallback(async () => {
		if (!hasContent) return;
		if (!(await requireChatProvider("Publish Kit"))) return;
		setIsGenerating(true);

		try {
			const steps = detectGuideSteps(cursorTelemetry, videoDurationMs, captionTrack);
			const chapters = deriveChapters(steps, videoDurationMs);
			const transcript = flattenTranscript(captionTrack);
			const prompt = buildPublishKitPrompt(chapters, transcript, videoDurationMs);
			const response = await generateJSON(prompt);
			setKit(parsePublishKitResponse(response, chapters));
			toast.success("Publish kit ready");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to generate publish kit");
		} finally {
			setIsGenerating(false);
		}
	}, [
		hasContent,
		requireChatProvider,
		cursorTelemetry,
		videoDurationMs,
		captionTrack,
		generateJSON,
	]);

	const copyText = useCallback(async (label: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${label} copied`);
		} catch {
			toast.error("Failed to copy to clipboard");
		}
	}, []);

	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				onClick={handleGenerate}
				disabled={isGenerating || !hasContent}
				className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#2563eb]/20 to-purple-500/20 hover:from-[#2563eb]/30 hover:to-purple-500/30 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
			>
				<Megaphone size={14} />
				{isGenerating ? "Generating…" : kit ? "Regenerate Publish Kit" : "Generate Publish Kit"}
			</button>

			{!captionTrack && (
				<div className="text-[10px] text-white/40">
					Tip: generate captions first for much better titles and description.
				</div>
			)}

			{kit && (
				<div className="flex flex-col gap-2">
					{kit.titles.length > 0 && (
						<div className="flex flex-col gap-1">
							<div className="text-[9px] uppercase tracking-wide text-white/40">
								Title options (click to copy)
							</div>
							{kit.titles.map((title) => (
								<button
									type="button"
									key={title}
									onClick={() => copyText("Title", title)}
									className="px-2 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#2563eb]/30 text-[10px] text-white/80 text-left transition-colors"
								>
									{title}
								</button>
							))}
						</div>
					)}

					{kit.chapters.length > 0 && (
						<div className="flex flex-col gap-1">
							<div className="text-[9px] uppercase tracking-wide text-white/40">Chapters</div>
							<div className="px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/60 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
								{kit.chapters
									.map((c) => `${formatChapterTimestamp(c.timeMs)} ${c.title}`)
									.join("\n")}
							</div>
						</div>
					)}

					<div className="flex gap-1">
						<button
							type="button"
							onClick={() => copyText("Description", renderDescriptionWithChapters(kit))}
							className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-[#2563eb]/20 hover:bg-[#2563eb]/30 text-[#2563eb] transition-colors"
						>
							<Copy size={10} />
							Description + chapters
						</button>
						<button
							type="button"
							onClick={() => copyText("Tags", kit.tags.join(", "))}
							disabled={kit.tags.length === 0}
							className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/70 disabled:opacity-40 transition-colors"
						>
							<Copy size={10} />
							Tags
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
