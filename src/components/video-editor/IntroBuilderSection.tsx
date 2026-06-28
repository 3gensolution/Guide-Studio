/**
 * IntroBuilderSection — direct customization intro builder.
 * No template grid. Users immediately configure title, subtitle,
 * animation style, images, timing, and see a live canvas preview.
 */
import {
	Image as ImageIcon,
	Loader2,
	Palette,
	Play,
	Plus,
	Sparkles,
	Timer,
	Trash2,
	Type,
	Upload,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useIntroPreview } from "@/hooks/useIntroPreview";
import { renderIntroToBlob } from "@/lib/intro/introRenderer";
import {
	ANIMATION_LABELS,
	DEFAULT_INTRO_CONFIG,
	type IntroAnimationStyle,
	type IntroConfig,
	type IntroImageEntry,
	type IntroTextPosition,
	POSITION_LABELS,
} from "@/lib/intro/introTypes";
import type { VideoClip } from "./types";

interface IntroBuilderSectionProps {
	onInsertIntro?: (clip: VideoClip) => void;
}

const BACKGROUND_SWATCHES: { key: string; label: string; color: string; color2?: string }[] = [
	{ key: "brand-dark", label: "Dark", color: "#171412" },
	{ key: "navy", label: "Navy", color: "#0f172a" },
	{ key: "deep-purple", label: "Purple", color: "#1e1033" },
	{ key: "charcoal", label: "Charcoal", color: "#292524" },
	{ key: "slate", label: "Slate", color: "#1e293b" },
	{ key: "gradient-blue", label: "Blue", color: "#0f172a", color2: "#1e3a5f" },
	{ key: "gradient-green", label: "Green", color: "#0f172a", color2: "#064e3b" },
	{ key: "gradient-purple", label: "Purple", color: "#1e1033", color2: "#312e81" },
];

const ANIMATION_STYLES = Object.keys(ANIMATION_LABELS) as IntroAnimationStyle[];
const TEXT_POSITIONS = Object.keys(POSITION_LABELS) as IntroTextPosition[];

export function IntroBuilderSection({ onInsertIntro }: IntroBuilderSectionProps) {
	const [config, setConfig] = useState<IntroConfig>({ ...DEFAULT_INTRO_CONFIG });
	const [isInserting, setIsInserting] = useState(false);
	const [insertError, setInsertError] = useState<string | null>(null);
	const previewCanvasRef = useRef<HTMLCanvasElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const fileInputRoleRef = useRef<"logo" | "background" | "decoration">("logo");

	useIntroPreview(previewCanvasRef, config, 640, 360);

	const updateConfig = useCallback(<K extends keyof IntroConfig>(key: K, value: IntroConfig[K]) => {
		setConfig((prev) => ({ ...prev, [key]: value }));
	}, []);

	// ── Image upload ────────────────────────────────────────────────
	const handleImageUpload = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const files = event.currentTarget.files;
			if (!files?.length) return;

			const file = files[0];
			const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
			if (!validTypes.includes(file.type)) {
				event.target.value = "";
				return;
			}

			const reader = new FileReader();
			reader.onload = (e) => {
				const dataUrl = e.target?.result as string;
				if (!dataUrl) return;

				const role = fileInputRoleRef.current;

				if (role === "background") {
					updateConfig("customBackgroundImage", dataUrl);
				} else {
					const entry: IntroImageEntry = {
						id: `img-${Date.now()}`,
						dataUrl,
						role,
						position: "center",
						scale: role === "logo" ? 0.3 : 0.5,
						opacity: 1,
					};
					setConfig((prev) => ({ ...prev, images: [...prev.images, entry] }));
				}
			};
			reader.readAsDataURL(file);
			event.target.value = "";
		},
		[updateConfig],
	);

	const triggerUpload = useCallback((role: "logo" | "background" | "decoration") => {
		fileInputRoleRef.current = role;
		fileInputRef.current?.click();
	}, []);

	const removeImage = useCallback((id: string) => {
		setConfig((prev) => ({
			...prev,
			images: prev.images.filter((i) => i.id !== id),
		}));
	}, []);

	const updateImage = useCallback(
		<K extends keyof IntroImageEntry>(id: string, key: K, value: IntroImageEntry[K]) => {
			setConfig((prev) => ({
				...prev,
				images: prev.images.map((i) => (i.id === id ? { ...i, [key]: value } : i)),
			}));
		},
		[],
	);

	// ── Insert handler ──────────────────────────────────────────────
	const handleInsertIntro = useCallback(async () => {
		if (!onInsertIntro) return;
		setIsInserting(true);
		setInsertError(null);

		try {
			const blob = await renderIntroToBlob(config);
			const arrayBuffer = await blob.arrayBuffer();
			const result = await window.electronAPI.saveIntroVideo(arrayBuffer);
			if (!result.success || !result.path) {
				throw new Error(result.error || "Failed to save intro video");
			}

			const clip: VideoClip = {
				id: `intro-${Date.now()}`,
				sourceVideoPath: result.path,
				startMs: 0,
				endMs: config.durationMs,
				offsetMs: 0,
				durationMs: config.durationMs,
				label: config.title || "Intro",
				sourceType: "intro",
				introConfig: {
					config: { ...config },
				},
			};
			onInsertIntro(clip);
		} catch (err) {
			console.error("Failed to generate intro video:", err);
			setInsertError(err instanceof Error ? err.message : "Failed to generate intro");
		} finally {
			setIsInserting(false);
		}
	}, [config, onInsertIntro]);

	return (
		<div className="flex flex-col gap-2">
			{/* Hidden file input */}
			<input
				type="file"
				ref={fileInputRef}
				onChange={handleImageUpload}
				accept=".jpg,.jpeg,.png,.gif,.webp,image/*"
				className="hidden"
			/>

			{/* Live preview */}
			<div className="rounded-lg overflow-hidden border border-white/10 aspect-video">
				<canvas ref={previewCanvasRef} className="w-full h-full" width={640} height={360} />
			</div>

			{/* Duration slider (always visible) */}
			<div className="flex items-center gap-2 px-1">
				<Timer size={10} className="text-white/40 shrink-0" />
				<Slider
					value={[config.durationMs]}
					onValueChange={([v]) => updateConfig("durationMs", v)}
					min={1000}
					max={10000}
					step={500}
					className="flex-1"
				/>
				<span className="text-[10px] text-white/50 tabular-nums w-8 text-right">
					{(config.durationMs / 1000).toFixed(1)}s
				</span>
			</div>

			{/* Customization sections */}
			<Accordion type="multiple" defaultValue={["text", "animation"]} className="w-full">
				{/* ── Text section ────────────────────────────────────── */}
				<AccordionItem value="text">
					<AccordionTrigger className="py-2 text-[11px]">
						<span className="flex items-center gap-1.5">
							<Type size={12} className="text-[#14b8a6]" />
							Text
						</span>
					</AccordionTrigger>
					<AccordionContent className="space-y-2.5 pb-3">
						{/* Title */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1">Title</label>
							<input
								type="text"
								value={config.title}
								onChange={(e) => updateConfig("title", e.target.value)}
								placeholder="Your Title"
								className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder-white/30 focus:outline-none focus:border-[#14b8a6]/40"
							/>
						</div>

						{/* Subtitle */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1">Subtitle</label>
							<input
								type="text"
								value={config.subtitle}
								onChange={(e) => updateConfig("subtitle", e.target.value)}
								placeholder="Your subtitle goes here"
								className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder-white/30 focus:outline-none focus:border-[#14b8a6]/40"
							/>
						</div>

						{/* Text Position */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1">Position</label>
							<Select
								value={config.textPosition}
								onValueChange={(v) => updateConfig("textPosition", v as IntroTextPosition)}
							>
								<SelectTrigger className="h-7 text-[11px] bg-white/5 border-white/10">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TEXT_POSITIONS.map((pos) => (
										<SelectItem key={pos} value={pos} className="text-[11px]">
											{POSITION_LABELS[pos]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Title Size */}
						<div>
							<div className="flex items-center justify-between mb-1">
								<label className="text-[10px] text-white/50">Title Size</label>
								<span className="text-[10px] text-white/40 tabular-nums">
									{config.titleSize.toFixed(1)}x
								</span>
							</div>
							<Slider
								value={[config.titleSize]}
								onValueChange={([v]) => updateConfig("titleSize", v)}
								min={0.5}
								max={2.0}
								step={0.1}
							/>
						</div>

						{/* Subtitle Size */}
						<div>
							<div className="flex items-center justify-between mb-1">
								<label className="text-[10px] text-white/50">Subtitle Size</label>
								<span className="text-[10px] text-white/40 tabular-nums">
									{config.subtitleSize.toFixed(1)}x
								</span>
							</div>
							<Slider
								value={[config.subtitleSize]}
								onValueChange={([v]) => updateConfig("subtitleSize", v)}
								min={0.5}
								max={2.0}
								step={0.1}
							/>
						</div>
					</AccordionContent>
				</AccordionItem>

				{/* ── Animation section ───────────────────────────────── */}
				<AccordionItem value="animation">
					<AccordionTrigger className="py-2 text-[11px]">
						<span className="flex items-center gap-1.5">
							<Sparkles size={12} className="text-[#14b8a6]" />
							Animation
						</span>
					</AccordionTrigger>
					<AccordionContent className="space-y-2.5 pb-3">
						{/* Title Animation */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1">Title Animation</label>
							<Select
								value={config.titleAnimation}
								onValueChange={(v) => updateConfig("titleAnimation", v as IntroAnimationStyle)}
							>
								<SelectTrigger className="h-7 text-[11px] bg-white/5 border-white/10">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ANIMATION_STYLES.map((style) => (
										<SelectItem key={style} value={style} className="text-[11px]">
											{ANIMATION_LABELS[style]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Subtitle Animation */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1">Subtitle Animation</label>
							<Select
								value={config.subtitleAnimation}
								onValueChange={(v) => updateConfig("subtitleAnimation", v as IntroAnimationStyle)}
							>
								<SelectTrigger className="h-7 text-[11px] bg-white/5 border-white/10">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ANIMATION_STYLES.map((style) => (
										<SelectItem key={style} value={style} className="text-[11px]">
											{ANIMATION_LABELS[style]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Stagger */}
						<div>
							<div className="flex items-center justify-between mb-1">
								<label className="text-[10px] text-white/50">Stagger</label>
								<span className="text-[10px] text-white/40 tabular-nums">
									{config.animationStagger}ms
								</span>
							</div>
							<Slider
								value={[config.animationStagger]}
								onValueChange={([v]) => updateConfig("animationStagger", v)}
								min={0}
								max={2000}
								step={50}
							/>
						</div>

						{/* Fade In */}
						<div>
							<div className="flex items-center justify-between mb-1">
								<label className="text-[10px] text-white/50">Fade In</label>
								<span className="text-[10px] text-white/40 tabular-nums">
									{Math.round(config.fadeInPercent * 100)}%
								</span>
							</div>
							<Slider
								value={[config.fadeInPercent]}
								onValueChange={([v]) => updateConfig("fadeInPercent", v)}
								min={0.05}
								max={0.5}
								step={0.05}
							/>
						</div>

						{/* Fade Out */}
						<div>
							<div className="flex items-center justify-between mb-1">
								<label className="text-[10px] text-white/50">Fade Out</label>
								<span className="text-[10px] text-white/40 tabular-nums">
									{Math.round(config.fadeOutPercent * 100)}%
								</span>
							</div>
							<Slider
								value={[config.fadeOutPercent]}
								onValueChange={([v]) => updateConfig("fadeOutPercent", v)}
								min={0.05}
								max={0.3}
								step={0.05}
							/>
						</div>
					</AccordionContent>
				</AccordionItem>

				{/* ── Appearance section ──────────────────────────────── */}
				<AccordionItem value="appearance">
					<AccordionTrigger className="py-2 text-[11px]">
						<span className="flex items-center gap-1.5">
							<Palette size={12} className="text-[#14b8a6]" />
							Appearance
						</span>
					</AccordionTrigger>
					<AccordionContent className="space-y-2.5 pb-3">
						{/* Accent Color */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1">Accent Color</label>
							<div className="flex items-center gap-2">
								<input
									type="color"
									value={config.accentColor}
									onChange={(e) => updateConfig("accentColor", e.target.value)}
									className="w-7 h-7 rounded border border-white/10 bg-transparent cursor-pointer"
								/>
								<span className="text-[10px] text-white/40 font-mono">{config.accentColor}</span>
							</div>
						</div>

						{/* Background swatches */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1.5">Background</label>
							<div className="grid grid-cols-4 gap-1.5">
								{BACKGROUND_SWATCHES.map((swatch) => (
									<button
										key={swatch.key}
										type="button"
										onClick={() => updateConfig("backgroundColor", swatch.key)}
										className={`h-8 rounded border transition-all ${
											config.backgroundColor === swatch.key
												? "border-[#14b8a6] ring-1 ring-[#14b8a6]/30"
												: "border-white/10 hover:border-white/20"
										}`}
										style={
											swatch.color2
												? {
														background: `linear-gradient(135deg, ${swatch.color}, ${swatch.color2})`,
													}
												: { background: swatch.color }
										}
										title={swatch.label}
									/>
								))}
							</div>
						</div>

						{/* Background image */}
						<div>
							<label className="text-[10px] text-white/50 block mb-1.5">Background Image</label>
							{config.customBackgroundImage ? (
								<div className="flex items-center gap-2">
									<div
										className="w-16 h-9 rounded border border-white/10 bg-cover bg-center"
										style={{ backgroundImage: `url(${config.customBackgroundImage})` }}
									/>
									<button
										type="button"
										onClick={() => updateConfig("customBackgroundImage", null)}
										className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
									>
										<Trash2 size={12} />
									</button>
								</div>
							) : (
								<button
									type="button"
									onClick={() => triggerUpload("background")}
									className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/50 hover:text-white/70 hover:bg-white/10 transition-colors"
								>
									<Upload size={10} />
									Upload Image
								</button>
							)}
						</div>
					</AccordionContent>
				</AccordionItem>

				{/* ── Images section ──────────────────────────────────── */}
				<AccordionItem value="images">
					<AccordionTrigger className="py-2 text-[11px]">
						<span className="flex items-center gap-1.5">
							<ImageIcon size={12} className="text-[#14b8a6]" />
							Images
						</span>
					</AccordionTrigger>
					<AccordionContent className="space-y-2.5 pb-3">
						{/* Add buttons */}
						<div className="flex gap-1.5">
							<button
								type="button"
								onClick={() => triggerUpload("logo")}
								className="flex items-center gap-1 px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/50 hover:text-white/70 hover:bg-white/10 transition-colors"
							>
								<Plus size={10} />
								Logo
							</button>
							<button
								type="button"
								onClick={() => triggerUpload("decoration")}
								className="flex items-center gap-1 px-2 py-1.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/50 hover:text-white/70 hover:bg-white/10 transition-colors"
							>
								<Plus size={10} />
								Image
							</button>
						</div>

						{/* Image list */}
						{config.images.length === 0 && (
							<p className="text-[9px] text-white/30">No images added yet.</p>
						)}

						{config.images.map((entry) => (
							<div
								key={entry.id}
								className="rounded-lg bg-white/[0.03] border border-white/5 p-2 space-y-2"
							>
								<div className="flex items-center gap-2">
									<div
										className="w-10 h-10 rounded border border-white/10 bg-cover bg-center shrink-0"
										style={{ backgroundImage: `url(${entry.dataUrl})` }}
									/>
									<div className="flex-1 min-w-0">
										<span className="text-[9px] text-white/40 capitalize">{entry.role}</span>
									</div>
									<button
										type="button"
										onClick={() => removeImage(entry.id)}
										className="text-red-400/50 hover:text-red-400 transition-colors p-1"
									>
										<Trash2 size={10} />
									</button>
								</div>

								{/* Position */}
								<div>
									<label className="text-[9px] text-white/40 block mb-0.5">Position</label>
									<Select
										value={entry.position}
										onValueChange={(v) => updateImage(entry.id, "position", v as IntroTextPosition)}
									>
										<SelectTrigger className="h-6 text-[10px] bg-white/5 border-white/10">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{TEXT_POSITIONS.map((pos) => (
												<SelectItem key={pos} value={pos} className="text-[10px]">
													{POSITION_LABELS[pos]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								{/* Scale */}
								<div>
									<div className="flex items-center justify-between mb-0.5">
										<label className="text-[9px] text-white/40">Scale</label>
										<span className="text-[9px] text-white/30 tabular-nums">
											{entry.scale.toFixed(1)}x
										</span>
									</div>
									<Slider
										value={[entry.scale]}
										onValueChange={([v]) => updateImage(entry.id, "scale", v)}
										min={0.1}
										max={2.0}
										step={0.1}
									/>
								</div>

								{/* Opacity */}
								<div>
									<div className="flex items-center justify-between mb-0.5">
										<label className="text-[9px] text-white/40">Opacity</label>
										<span className="text-[9px] text-white/30 tabular-nums">
											{Math.round(entry.opacity * 100)}%
										</span>
									</div>
									<Slider
										value={[entry.opacity]}
										onValueChange={([v]) => updateImage(entry.id, "opacity", v)}
										min={0}
										max={1}
										step={0.05}
									/>
								</div>
							</div>
						))}
					</AccordionContent>
				</AccordionItem>
			</Accordion>

			{/* Insert button */}
			<button
				type="button"
				onClick={handleInsertIntro}
				disabled={isInserting}
				className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-[#14b8a6]/20 to-[#14b8a6]/10 hover:from-[#14b8a6]/30 hover:to-[#14b8a6]/20 text-[#14b8a6] disabled:opacity-40 disabled:cursor-not-allowed transition-all mt-1"
			>
				{isInserting ? (
					<>
						<Loader2 size={14} className="animate-spin" />
						Generating Intro...
					</>
				) : (
					<>
						<Play size={14} />
						Insert as Intro Clip
					</>
				)}
			</button>

			{insertError && <p className="text-[10px] text-red-400/80 mt-1">{insertError}</p>}
		</div>
	);
}
