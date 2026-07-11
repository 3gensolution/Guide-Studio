/**
 * TranscriptEditSection — Descript-style text-based editing.
 * Click words to mark them for removal (or auto-select filler words);
 * applying converts the selection into trim regions on the timeline.
 */
import { ListX, Scissors, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	findFillerWordKeys,
	flattenTranscriptWords,
	wordsToTrimRegions,
} from "@/lib/ai/transcriptEditing";
import type { CaptionTrack } from "@/lib/ai/types";
import type { TrimRegion } from "./types";

interface TranscriptEditSectionProps {
	captionTrack: CaptionTrack | null;
	videoDurationMs: number;
	onAcceptTrimSuggestions: (trims: TrimRegion[]) => void;
	onSeek?: (timeMs: number) => void;
}

export function TranscriptEditSection({
	captionTrack,
	videoDurationMs,
	onAcceptTrimSuggestions,
	onSeek,
}: TranscriptEditSectionProps) {
	const words = useMemo(() => flattenTranscriptWords(captionTrack), [captionTrack]);
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

	const toggleWord = useCallback((key: string) => {
		setSelectedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}, []);

	const handleSelectFillers = useCallback(() => {
		const fillers = findFillerWordKeys(words);
		if (fillers.size === 0) {
			toast.info("No filler words (um, uh…) found in the transcript");
			return;
		}
		setSelectedKeys((prev) => new Set([...prev, ...fillers]));
		toast.success(`${fillers.size} filler words selected`);
	}, [words]);

	const handleApplyCuts = useCallback(() => {
		const selected = words.filter((w) => selectedKeys.has(w.key));
		const trims = wordsToTrimRegions(selected, videoDurationMs);
		if (trims.length === 0) return;
		onAcceptTrimSuggestions(trims);
		setSelectedKeys(new Set());
		toast.success(
			`${selected.length} words cut from the video (${trims.length} trim ${trims.length === 1 ? "region" : "regions"})`,
		);
	}, [words, selectedKeys, videoDurationMs, onAcceptTrimSuggestions]);

	if (!captionTrack || words.length === 0) {
		return (
			<div className="text-[10px] text-white/40">
				Generate captions first — then you can edit the video by editing its transcript.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="text-[10px] text-white/40">
				Click words to mark them for removal. Double-click a word to jump there.
			</div>

			<div className="max-h-48 overflow-y-auto px-2 py-1.5 rounded bg-white/5 border border-white/10 leading-relaxed">
				{words.map((word) => {
					const selected = selectedKeys.has(word.key);
					return (
						<button
							type="button"
							key={word.key}
							onClick={() => toggleWord(word.key)}
							onDoubleClick={() => onSeek?.(word.startMs)}
							className={`inline text-[11px] rounded-sm px-px transition-colors ${
								selected
									? "bg-red-500/25 text-red-300 line-through"
									: "text-white/70 hover:bg-white/10"
							}`}
						>
							{word.text}{" "}
						</button>
					);
				})}
			</div>

			<div className="flex gap-1">
				<button
					type="button"
					onClick={handleSelectFillers}
					className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
				>
					<ListX size={10} />
					Select fillers
				</button>
				<button
					type="button"
					onClick={handleApplyCuts}
					disabled={selectedKeys.size === 0}
					className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-[#6E6BFF]/20 hover:bg-[#6E6BFF]/30 text-[#6E6BFF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<Scissors size={10} />
					Cut {selectedKeys.size > 0 ? selectedKeys.size : ""} selected
				</button>
				{selectedKeys.size > 0 && (
					<button
						type="button"
						onClick={() => setSelectedKeys(new Set())}
						className="flex items-center justify-center px-2 py-1.5 rounded text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/60 transition-colors"
						title="Clear selection"
					>
						<X size={10} />
					</button>
				)}
			</div>
		</div>
	);
}
