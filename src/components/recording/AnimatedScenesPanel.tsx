// ── Animated scenes ──────────────────────────────────────────────────────
//
// The editing surface for the Animated (HyperFrames) look. The agent built
// each scene as its own composition and declared its copy and brand colours
// as variables; this panel shows those as plain fields. Two ways to change a
// scene, matching how the change is best made:
//
//   * a field edit — exact copy or a colour, applied directly, no agent turn
//   * "Ask for a change" — anything else (timing, motion, layout), sent to
//     the agent scoped to that scene, then gated and re-snapshotted
//
// Main validates every value against its declaration again; nothing here is
// trusted beyond being a convenient form.

import { AudioLines, Loader2, Music2, Palette, Send, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toFileUrl } from "@/components/video-editor/projectPersistence";

export interface AnimatedVariableView {
	id: string;
	type: "string" | "number" | "color" | "boolean" | "enum";
	label: string;
	value: string | number | boolean;
	maxLength?: number;
	min?: number;
	max?: number;
	options?: Array<{ value: string; label: string }>;
}

export interface AnimatedSceneView {
	id: string;
	file: string;
	startSeconds: number;
	durationSeconds: number;
	variables: AnimatedVariableView[];
}

export interface AnimatedStateView {
	summary: {
		durationSeconds: number;
		scenes: AnimatedSceneView[];
		globalVariables: AnimatedVariableView[];
		audio: Array<{
			id: string;
			src: string;
			startSeconds: number;
			durationSeconds: number;
			volume?: number;
			role: "music" | "sfx" | "voice" | "source";
		}>;
	};
	warnings: string[];
	notes: string[];
	revisions: Array<{ instruction: string; sceneId?: string; at: number }>;
}

type Values = Record<string, string | number | boolean>;

interface Props {
	animated: AnimatedStateView;
	previewPaths?: Array<{ frameIndex: number; path: string }>;
	disabled: boolean;
	/** Which scene (or "video" for the whole thing) is being worked on, if any. */
	working: string | null;
	onSetValues: (sceneId: string | undefined, values: Values) => Promise<void>;
	onRevise: (instruction: string, sceneId?: string) => Promise<void>;
}

/**
 * Keyed into each card so a saved edit or a revision — which changes the
 * values on disk — remounts the card with fresh drafts.
 */
function variablesKey(variables: AnimatedVariableView[]): string {
	return variables.map((variable) => `${variable.id}=${String(variable.value)}`).join("|");
}

function formatSeconds(seconds: number): string {
	return `${seconds.toFixed(1)}s`;
}

function changedValues(variables: AnimatedVariableView[], drafts: Values): Values {
	const changed: Values = {};
	for (const variable of variables) {
		const draft = drafts[variable.id];
		if (draft !== undefined && draft !== variable.value) changed[variable.id] = draft;
	}
	return changed;
}

function VariableField({
	variable,
	value,
	disabled,
	onChange,
}: {
	variable: AnimatedVariableView;
	value: string | number | boolean;
	disabled: boolean;
	onChange: (value: string | number | boolean) => void;
}) {
	const inputClass =
		"w-full rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-white/85 outline-none focus:border-[#6E6BFF]/60 disabled:opacity-50";
	return (
		<label className="flex flex-col gap-1">
			<span className="flex items-baseline justify-between text-[10px] text-white/45">
				{variable.label}
				{variable.type === "string" && variable.maxLength ? (
					<span className="tabular-nums text-white/25">
						{String(value).length}/{variable.maxLength}
					</span>
				) : null}
			</span>
			{variable.type === "color" ? (
				<span className="flex items-center gap-2">
					<input
						type="color"
						value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#000000"}
						disabled={disabled}
						onChange={(event) => onChange(event.target.value)}
						className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
					/>
					<span className="text-[10px] tabular-nums text-white/45">{String(value)}</span>
				</span>
			) : variable.type === "boolean" ? (
				<input
					type="checkbox"
					checked={value === true}
					disabled={disabled}
					onChange={(event) => onChange(event.target.checked)}
					className="h-4 w-4 accent-[#6E6BFF]"
				/>
			) : variable.type === "enum" ? (
				<select
					value={String(value)}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
					className={inputClass}
				>
					{(variable.options ?? []).map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			) : variable.type === "number" ? (
				<input
					type="number"
					value={Number(value)}
					min={variable.min}
					max={variable.max}
					disabled={disabled}
					onChange={(event) => onChange(Number(event.target.value))}
					className={inputClass}
				/>
			) : (
				<input
					type="text"
					value={String(value)}
					maxLength={variable.maxLength}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
					className={inputClass}
				/>
			)}
		</label>
	);
}

function AskForChange({
	placeholder,
	disabled,
	busy,
	onSubmit,
}: {
	placeholder: string;
	disabled: boolean;
	busy: boolean;
	onSubmit: (instruction: string) => Promise<void>;
}) {
	const [draft, setDraft] = useState("");
	const submit = async () => {
		const instruction = draft.trim();
		if (!instruction || disabled) return;
		await onSubmit(instruction);
		setDraft("");
	};
	return (
		<div className="flex items-center gap-1.5">
			<input
				type="text"
				value={draft}
				disabled={disabled}
				placeholder={placeholder}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") void submit();
				}}
				className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-white/85 outline-none placeholder:text-white/25 focus:border-[#6E6BFF]/60 disabled:opacity-50"
			/>
			<button
				type="button"
				onClick={() => void submit()}
				disabled={disabled || !draft.trim()}
				className="flex items-center gap-1 rounded-md bg-[#6E6BFF]/80 px-2 py-1.5 text-[10px] font-medium text-white transition-colors hover:bg-[#6E6BFF] disabled:opacity-40"
			>
				{busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
				Ask
			</button>
		</div>
	);
}

function SceneCard({
	scene,
	index,
	still,
	disabled,
	working,
	onSetValues,
	onRevise,
}: {
	scene: AnimatedSceneView;
	index: number;
	still?: string;
	disabled: boolean;
	working: string | null;
	onSetValues: Props["onSetValues"];
	onRevise: Props["onRevise"];
}) {
	const [drafts, setDrafts] = useState<Values>({});
	const changed = useMemo(() => changedValues(scene.variables, drafts), [scene.variables, drafts]);
	const busy = working === scene.id;
	return (
		<div className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 lg:flex-row">
			<div className="flex-shrink-0 lg:w-[260px]">
				{still ? (
					<img
						src={toFileUrl(still)}
						alt={`Scene ${index + 1}: ${scene.id}`}
						className="w-full rounded-lg border border-white/10 bg-black/40"
					/>
				) : (
					<div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-white/10 text-[10px] text-white/25">
						No preview yet
					</div>
				)}
				<p className="mt-1.5 text-[10px] tabular-nums text-white/35">
					{index + 1} · {scene.id} · {formatSeconds(scene.startSeconds)}–
					{formatSeconds(scene.startSeconds + scene.durationSeconds)}
				</p>
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-2.5">
				{scene.variables.length > 0 ? (
					<div className="grid gap-2 sm:grid-cols-2">
						{scene.variables.map((variable) => (
							<VariableField
								key={variable.id}
								variable={variable}
								value={drafts[variable.id] ?? variable.value}
								disabled={disabled}
								onChange={(value) => setDrafts((current) => ({ ...current, [variable.id]: value }))}
							/>
						))}
					</div>
				) : (
					<p className="text-[10px] text-white/30">
						This scene has no editable copy. Ask for a change to adjust it.
					</p>
				)}
				{Object.keys(changed).length > 0 && (
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void onSetValues(scene.id, changed)}
							disabled={disabled}
							className="flex items-center gap-1 rounded-md bg-emerald-400/15 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
						>
							{busy ? <Loader2 size={11} className="animate-spin" /> : null}
							Apply edits
						</button>
						<button
							type="button"
							onClick={() => setDrafts({})}
							disabled={disabled}
							className="rounded-md px-2 py-1 text-[10px] text-white/40 hover:bg-white/5"
						>
							Discard
						</button>
					</div>
				)}
				<AskForChange
					placeholder={`Ask for a change to "${scene.id}" — e.g. slower reveal, swap the layout, add a pop on the badge`}
					disabled={disabled}
					busy={busy}
					onSubmit={(instruction) => onRevise(instruction, scene.id)}
				/>
			</div>
		</div>
	);
}

function BrandCard({
	variables,
	disabled,
	busy,
	onApply,
}: {
	variables: AnimatedVariableView[];
	disabled: boolean;
	busy: boolean;
	onApply: (values: Values) => Promise<void>;
}) {
	const [drafts, setDrafts] = useState<Values>({});
	const changed = useMemo(() => changedValues(variables, drafts), [variables, drafts]);
	return (
		<div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
			<p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-white/70">
				<Palette size={12} />
				Brand
			</p>
			<div className="grid gap-2 sm:grid-cols-3">
				{variables.map((variable) => (
					<VariableField
						key={variable.id}
						variable={variable}
						value={drafts[variable.id] ?? variable.value}
						disabled={disabled}
						onChange={(value) => setDrafts((current) => ({ ...current, [variable.id]: value }))}
					/>
				))}
			</div>
			{Object.keys(changed).length > 0 && (
				<button
					type="button"
					onClick={() => void onApply(changed)}
					disabled={disabled}
					className="mt-2 flex items-center gap-1 rounded-md bg-emerald-400/15 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
				>
					{busy ? <Loader2 size={11} className="animate-spin" /> : null}
					Apply to every scene
				</button>
			)}
		</div>
	);
}

export function AnimatedScenesPanel({
	animated,
	previewPaths,
	disabled,
	working,
	onSetValues,
	onRevise,
}: Props) {
	const { summary } = animated;
	const effects = summary.audio.filter((clip) => clip.role === "sfx");
	const music = summary.audio.filter((clip) => clip.role === "music");
	const footageSound = summary.audio.filter((clip) => clip.role === "source");

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-white/90">
						<Wand2 size={13} className="text-[#6E6BFF]" />
						Scenes
					</h3>
					<p className="mt-0.5 text-[11px] text-white/40">
						Edit copy and colours directly, or ask the agent to change a scene. Every change is
						checked before it can be rendered.
					</p>
				</div>
			</div>

			{summary.globalVariables.length > 0 && (
				<BrandCard
					key={variablesKey(summary.globalVariables)}
					variables={summary.globalVariables}
					disabled={disabled}
					busy={working === "video"}
					onApply={(values) => onSetValues(undefined, values)}
				/>
			)}

			{summary.scenes.map((scene, index) => (
				<SceneCard
					key={`${scene.id}:${scene.durationSeconds}:${variablesKey(scene.variables)}`}
					scene={scene}
					index={index}
					still={previewPaths?.find((candidate) => candidate.frameIndex === index)?.path}
					disabled={disabled}
					working={working}
					onSetValues={onSetValues}
					onRevise={onRevise}
				/>
			))}

			<div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
				<p className="mb-2 text-[11px] font-medium text-white/70">Change the whole video</p>
				<AskForChange
					placeholder="e.g. tighten it to 30 seconds, make the motion punchier, add a closing call to action"
					disabled={disabled}
					busy={working === "video"}
					onSubmit={(instruction) => onRevise(instruction)}
				/>
			</div>

			<details className="rounded-xl border border-violet-400/20 bg-violet-400/[0.05] px-3.5 py-2.5">
				<summary className="cursor-pointer text-[11px] font-medium text-violet-200/90">
					<AudioLines size={12} className="mr-1.5 inline" />
					Sound design · {effects.length} effect{effects.length === 1 ? "" : "s"}
					{music.length ? " · music bed" : " · no music"}
					{footageSound.length ? " · footage audio" : ""}
				</summary>
				<ul className="mt-2 space-y-1">
					{summary.audio.map((clip) => (
						<li key={clip.id} className="flex items-center gap-2 text-[10px] text-white/50">
							{clip.role === "music" ? <Music2 size={10} /> : <AudioLines size={10} />}
							<span className="w-14 tabular-nums text-white/35">
								{formatSeconds(clip.startSeconds)}
							</span>
							<span className="truncate">
								{clip.id} — {clip.src.split("/").pop()}
								{clip.volume !== undefined ? ` · vol ${clip.volume}` : ""}
							</span>
						</li>
					))}
					{summary.audio.length === 0 && (
						<li className="text-[10px] text-white/35">This cut is silent.</li>
					)}
				</ul>
				{animated.notes.length > 0 && (
					<ul className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-2">
						{animated.notes.map((note) => (
							<li key={note} className="text-[10px] text-violet-200/50">
								{note}
							</li>
						))}
					</ul>
				)}
			</details>
		</div>
	);
}
