/**
 * Polish Setup Dialog — lets the user choose what the one-click Auto-Polish
 * should add (framing, cursor, narration, music, intro) and customize the
 * background music, narration voice, and intro card before running once.
 */

import { Sparkles, Wand2 } from "lucide-react";
import type { CSSProperties } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	INTRO_STYLES,
	MUSIC_STYLES,
	type PolishOptions,
	VOICE_OPTIONS,
} from "@/lib/ai/polishTemplates";

interface PolishSetupDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	options: PolishOptions;
	onOptionsChange: (options: PolishOptions) => void;
	onRun: () => void;
	isRunning: boolean;
	/** Whether the user is signed in (AI stages need the backend). */
	isAuthenticated: boolean;
}

function Row({
	title,
	desc,
	checked,
	onCheckedChange,
	disabled = false,
	children,
}: {
	title: string;
	desc: string;
	checked: boolean;
	onCheckedChange: (v: boolean) => void;
	disabled?: boolean;
	children?: React.ReactNode;
}) {
	return (
		<div
			className={`rounded-lg border border-white/10 bg-white/[0.02] p-3 ${
				disabled ? "pointer-events-none opacity-50" : ""
			}`}
			aria-disabled={disabled || undefined}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-sm font-medium text-white">{title}</div>
					<div className="text-xs text-slate-400">{desc}</div>
				</div>
				<Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
			</div>
			{checked && children ? <div className="mt-3 space-y-2">{children}</div> : null}
		</div>
	);
}

export function PolishSetupDialog({
	open,
	onOpenChange,
	options,
	onOptionsChange,
	onRun,
	isRunning,
	isAuthenticated,
}: PolishSetupDialogProps) {
	const set = <K extends keyof PolishOptions>(key: K, value: PolishOptions[K]) =>
		onOptionsChange({ ...options, [key]: value });

	const nothingSelected =
		!options.framing &&
		!options.smoothCursor &&
		!options.narration &&
		!options.music &&
		!options.intro;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[520px]"
				style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Wand2 className="h-5 w-5 text-[#6E6BFF]" />
						Polish setup
					</DialogTitle>
					<DialogDescription>
						Choose what to add. Your selection is remembered for next time.
					</DialogDescription>
				</DialogHeader>

				<div className="max-h-[60vh] space-y-2 overflow-y-auto py-1">
					<Row
						title="Smart framing"
						desc="Auto-zoom, trim dead time, and pace the recording."
						checked={options.framing}
						onCheckedChange={(v) => set("framing", v)}
					/>

					<Row
						title="Smooth cursor"
						desc="Glide the pointer and add click rings."
						checked={options.smoothCursor}
						onCheckedChange={(v) => set("smoothCursor", v)}
					/>

					<Row
						title="AI narration"
						desc="Write and voice a step-by-step voiceover."
						checked={options.narration}
						onCheckedChange={(v) => set("narration", v)}
					>
						<Select value={options.voiceId} onValueChange={(v) => set("voiceId", v)}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Voice" />
							</SelectTrigger>
							<SelectContent>
								{VOICE_OPTIONS.map((v) => (
									<SelectItem key={v.id} value={v.id}>
										{v.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Row>

					{/* Temporarily disabled — remove `disabled` and the forced-off check to restore */}
					<Row
						title="Background music"
						desc="Add a ducked music bed."
						checked={false}
						onCheckedChange={(v) => set("music", v)}
						disabled
					>
						<Select value={options.musicStyleId} onValueChange={(v) => set("musicStyleId", v)}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Music style" />
							</SelectTrigger>
							<SelectContent>
								{MUSIC_STYLES.map((m) => (
									<SelectItem key={m.id} value={m.id}>
										{m.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Row>

					<Row
						title="Intro card"
						desc="Open with a branded title card."
						checked={options.intro}
						onCheckedChange={(v) => set("intro", v)}
					>
						<Input
							placeholder="Title (defaults to the project name)"
							value={options.introTitle}
							onChange={(e) => set("introTitle", e.target.value)}
						/>
						<Input
							placeholder="Subtitle"
							value={options.introSubtitle}
							onChange={(e) => set("introSubtitle", e.target.value)}
						/>
						<Select value={options.introStyleId} onValueChange={(v) => set("introStyleId", v)}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Intro style" />
							</SelectTrigger>
							<SelectContent>
								{INTRO_STYLES.map((s) => (
									<SelectItem key={s.id} value={s.id}>
										{s.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Row>
				</div>

				{!isAuthenticated && (
					<p className="text-xs text-amber-400">
						Narration and music need your account — you'll be asked to sign in.
					</p>
				)}

				<DialogFooter>
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onRun}
						disabled={isRunning || nothingSelected}
						className="flex items-center gap-2 rounded-md bg-[#6E6BFF] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6E6BFF]/90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Sparkles className="h-4 w-4" />
						{isRunning ? "Polishing…" : "Polish"}
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
