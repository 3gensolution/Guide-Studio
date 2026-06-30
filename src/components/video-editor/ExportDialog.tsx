import { CheckCircle2, Download, FolderOpen, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExportProgress } from "@/lib/exporter";

interface ExportDialogProps {
	isOpen: boolean;
	onClose: () => void;
	progress: ExportProgress | null;
	isExporting: boolean;
	error: string | null;
	onCancel?: () => void;
	exportFormat?: "mp4" | "gif";
	exportedFilePath?: string;
	onShowInFolder?: () => void;
}

export function ExportDialog({
	isOpen,
	onClose,
	progress,
	isExporting,
	error,
	onCancel,
	exportFormat = "mp4",
	exportedFilePath,
	onShowInFolder,
}: ExportDialogProps) {
	const t = useScopedT("dialogs");
	const [showSuccess, setShowSuccess] = useState(false);

	useEffect(() => {
		if (isExporting) {
			setShowSuccess(false);
		}
	}, [isExporting]);

	useEffect(() => {
		if (isOpen && !isExporting && !progress) {
			setShowSuccess(false);
		}
	}, [isOpen, isExporting, progress]);

	useEffect(() => {
		if (!isExporting && progress && progress.percentage >= 100 && !error) {
			setShowSuccess(true);
			const timer = setTimeout(() => {
				setShowSuccess(false);
				onClose();
			}, 3500);
			return () => clearTimeout(timer);
		}
	}, [isExporting, progress, error, onClose]);

	if (!isOpen) return null;

	const formatLabel = exportFormat === "gif" ? "GIF" : "Video";
	const isCompiling =
		isExporting && progress && progress.percentage >= 100 && exportFormat === "gif";
	const isFinalizing = progress?.phase === "finalizing";
	const renderProgress = progress?.renderProgress;

	const percentage = progress
		? isCompiling || isFinalizing
			? (renderProgress ?? -1)
			: progress.percentage
		: 0;

	const statusText = (() => {
		if (isCompiling || isFinalizing) {
			if (exportFormat === "mp4") return t("export.finalizingVideo");
			if (renderProgress !== undefined && renderProgress > 0)
				return t("export.compilingGifProgress", { progress: String(renderProgress) });
			return t("export.compilingGifWait");
		}
		return t("export.takeMoment");
	})();

	const dialog = (
		<>
			<div
				className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[9998] animate-in fade-in duration-150"
				onClick={isExporting ? undefined : onClose}
			/>

			<div
				className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-[360px] max-w-[90vw] animate-in zoom-in-95 fade-in duration-200"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="bg-[#161616] rounded-[20px] border border-white/[0.06] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.7)]">
					{/* ── Success ── */}
					{showSuccess && (
						<div className="px-8 pt-10 pb-8 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-300">
							<div className="relative mb-5">
								<div className="w-[72px] h-[72px] rounded-full bg-emerald-500/[0.08] flex items-center justify-center">
									<CheckCircle2 className="w-9 h-9 text-emerald-400" strokeWidth={1.5} />
								</div>
								<div className="absolute inset-0 rounded-full ring-1 ring-emerald-400/20" />
							</div>
							<h3 className="text-[17px] font-semibold text-white mb-1">{t("export.complete")}</h3>
							<p className="text-[13px] text-white/40 mb-5">
								{t("export.yourFormatReady", { format: formatLabel.toLowerCase() })}
							</p>
							{exportedFilePath && (
								<div className="w-full space-y-2.5">
									<p className="text-[11px] text-white/25 truncate px-1">
										{exportedFilePath.split("/").pop()}
									</p>
									<Button
										onClick={onShowInFolder}
										className="w-full h-9 bg-white/[0.06] hover:bg-white/[0.10] text-[13px] text-white/70 hover:text-white border-0 rounded-xl transition-colors gap-2"
									>
										<FolderOpen className="w-3.5 h-3.5" />
										{t("export.showInFolder")}
									</Button>
								</div>
							)}
						</div>
					)}

					{/* ── Error ── */}
					{!showSuccess && error && (
						<div className="px-8 pt-10 pb-8 flex flex-col items-center text-center animate-in fade-in duration-200">
							<div className="w-[72px] h-[72px] rounded-full bg-red-500/[0.08] flex items-center justify-center ring-1 ring-red-500/15 mb-5">
								<X className="w-9 h-9 text-red-400" strokeWidth={1.5} />
							</div>
							<h3 className="text-[17px] font-semibold text-white mb-1">{t("export.failed")}</h3>
							<p className="text-[13px] text-red-400/60 leading-relaxed max-h-20 overflow-y-auto mb-6 px-2">
								{error}
							</p>
							<Button
								onClick={onClose}
								className="w-full h-9 bg-white/[0.06] hover:bg-white/[0.10] text-[13px] text-white/70 hover:text-white border-0 rounded-xl transition-colors"
							>
								Close
							</Button>
						</div>
					)}

					{/* ── Exporting ── */}
					{!showSuccess && !error && (
						<div className="px-8 pt-10 pb-8 flex flex-col items-center text-center">
							{/* Animated icon */}
							<div className="relative mb-6">
								{isExporting ? (
									<>
										<div className="w-[72px] h-[72px] rounded-full bg-[#F59E0B]/[0.06] flex items-center justify-center">
											<Download className="w-8 h-8 text-[#F59E0B]/80" strokeWidth={1.5} />
										</div>
										{/* Spinning ring */}
										<svg
											className="absolute inset-0 w-[72px] h-[72px] animate-spin"
											style={{ animationDuration: "3s" }}
											viewBox="0 0 72 72"
										>
											<circle
												cx="36"
												cy="36"
												r="35"
												fill="none"
												stroke="rgba(245, 158, 11, 0.15)"
												strokeWidth="1"
											/>
											<circle
												cx="36"
												cy="36"
												r="35"
												fill="none"
												stroke="#F59E0B"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeDasharray="55 165"
											/>
										</svg>
									</>
								) : (
									<div className="w-[72px] h-[72px] rounded-full bg-white/[0.04] flex items-center justify-center ring-1 ring-white/[0.06]">
										<Download className="w-8 h-8 text-white/30" strokeWidth={1.5} />
									</div>
								)}
							</div>

							{/* Title & subtitle */}
							<h3 className="text-[17px] font-semibold text-white mb-1">
								{error
									? t("export.failed")
									: isFinalizing && exportFormat === "mp4"
										? t("export.finalizingVideoTitle")
										: isCompiling || isFinalizing
											? t("export.compilingGif")
											: t("export.exportingFormat", { format: formatLabel })}
							</h3>
							<p className="text-[13px] text-white/35 mb-7">{statusText}</p>

							{/* Progress */}
							{isExporting && progress && (
								<div className="w-full space-y-5">
									{/* Percentage */}
									<div className="text-[28px] font-light text-white/80 tabular-nums tracking-tight">
										{percentage >= 0 ? (
											<>
												{Math.min(percentage, 100).toFixed(0)}
												<span className="text-[16px] text-white/25 ml-0.5">%</span>
											</>
										) : (
											<Loader2 className="w-6 h-6 text-[#F59E0B]/60 animate-spin mx-auto" />
										)}
									</div>

									{/* Progress bar */}
									<div className="w-full h-[3px] bg-white/[0.04] rounded-full overflow-hidden">
										{percentage >= 0 ? (
											<div
												className="h-full rounded-full bg-[#F59E0B] transition-all duration-700 ease-out"
												style={{ width: `${Math.min(percentage, 100)}%` }}
											/>
										) : (
											<div className="h-full w-full relative overflow-hidden">
												<div
													className="absolute h-full w-1/4 rounded-full bg-[#F59E0B]/60"
													style={{
														animation: "exportIndeterminate 1.8s ease-in-out infinite",
													}}
												/>
												<style>{`
													@keyframes exportIndeterminate {
														0% { transform: translateX(-100%); }
														100% { transform: translateX(500%); }
													}
												`}</style>
											</div>
										)}
									</div>

									{/* Cancel */}
									{onCancel && (
										<button
											type="button"
											onClick={onCancel}
											className="mt-2 text-[13px] text-white/20 hover:text-red-400/70 transition-colors"
										>
											{t("export.cancelExport")}
										</button>
									)}
								</div>
							)}

							{/* Close button when not exporting and no progress */}
							{!isExporting && (
								<button
									type="button"
									onClick={onClose}
									className="absolute top-4 right-4 p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
								>
									<X className="w-4 h-4" />
								</button>
							)}
						</div>
					)}
				</div>
			</div>
		</>
	);

	return createPortal(dialog, document.body);
}
