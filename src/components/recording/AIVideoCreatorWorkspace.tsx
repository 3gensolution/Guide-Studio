// ── AI Video Creator ─────────────────────────────────────────────────────
//
// Guide Studio orchestrates; Claude designs. The user describes a video, we
// hand Claude a brief plus our craft skills, and it writes a storyboard
// against the fixed scene library. We validate it, render it locally, and let
// the user drop the result onto the editor timeline.
//
// The stages are deliberately visible — brief, plan, preview, render — because
// each one costs the user something different (their Claude quota, then their
// CPU) and they should never be spent without the user seeing why.

import {
	AlertTriangle,
	ArrowRight,
	Bot,
	Check,
	Clapperboard,
	Copy,
	Film,
	Loader2,
	RefreshCw,
	Sparkles,
	Terminal,
	X,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { toFileUrl } from "@/components/video-editor/projectPersistence";

type Format = "landscape" | "vertical" | "square";
type Look = "motion" | "cards";

interface Installation {
	installed: boolean;
	binaryPath?: string;
	version?: string;
	supportsFileSkills: boolean;
	error?: string;
}

interface PlanScene {
	id: string;
	kind: string;
	durationSeconds: number;
	headline?: string;
	subhead?: string;
	bullets?: string[];
	/** Card scenes name a backdrop; text scenes name a typography animation. */
	backdrop?: string;
	textScene?: string;
	text?: string;
	scene?: string;
}

/** A stock image Guide Studio fetched for a frame that asked for one. */
interface CreatorAsset {
	id: string;
	query: string;
	path: string;
	label: string;
	attribution: string;
	sourceUrl: string;
}

interface CreatorSession {
	id: string;
	request: string;
	format: Format;
	status: "planning" | "planned" | "rendering" | "rendered" | "failed";
	look?: Look;
	storyboard?: { title: string; accent: string; frames: PlanScene[] };
	motion?: { title: string; accent: string; scenes: PlanScene[] };
	assets?: CreatorAsset[];
	warnings?: string[];
	durationSeconds?: number;
	previewPaths?: Array<{ frameIndex: number; path: string }>;
	videoPath?: string;
	costUsd?: number;
	error?: string;
}

interface Activity {
	kind: "started" | "text" | "tool" | "tool-result" | "log" | "finished";
	text?: string;
	tool?: string;
	detail?: string;
	ok?: boolean;
	summary?: string;
}

const FORMATS: Array<{ id: Format; label: string; hint: string }> = [
	{ id: "landscape", label: "16:9", hint: "Landscape" },
	{ id: "vertical", label: "9:16", hint: "Vertical" },
	{ id: "square", label: "1:1", hint: "Square" },
];

// Only the card renderer draws pictures, so the choice between the two looks
// is also a choice about whether the video can show a photograph. Saying so
// here is cheaper than a user discovering it after a render.
const LOOKS: Array<{ id: Look; label: string; hint: string }> = [
	{
		id: "motion",
		label: "Motion graphics",
		hint: "Animated backdrops and kinetic typography — text only",
	},
	{ id: "cards", label: "Clean cards", hint: "Layout cards, and the only look that shows photos" },
];

const LENGTHS = [15, 30, 45, 60, 90];

const MODELS = [
	{ id: "claude-opus-5", label: "Opus 5", hint: "Most capable" },
	{ id: "claude-sonnet-5", label: "Sonnet 5", hint: "Faster, cheaper" },
];

const INSTALL_COMMAND = "npm install -g @anthropic-ai/claude-code";

export function AIVideoCreatorWorkspace({ onClose }: { onClose: () => void }) {
	const [installation, setInstallation] = useState<Installation | null>(null);
	const [checking, setChecking] = useState(true);
	const [copied, setCopied] = useState(false);

	const [request, setRequest] = useState("");
	const [format, setFormat] = useState<Format>("landscape");
	const [targetSeconds, setTargetSeconds] = useState(45);
	const [look, setLook] = useState<Look>("motion");
	const [model, setModel] = useState(MODELS[0].id);

	const [session, setSession] = useState<CreatorSession | null>(null);
	const [activities, setActivities] = useState<Activity[]>([]);
	const [busy, setBusy] = useState<"planning" | "previewing" | "rendering" | null>(null);
	const [renderPercent, setRenderPercent] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [inserted, setInserted] = useState(false);
	const activityEndRef = useRef<HTMLDivElement | null>(null);

	const checkInstall = useCallback(async () => {
		setChecking(true);
		const result = await window.electronAPI.claudeDetect();
		setInstallation(result.installation ?? { installed: false, supportsFileSkills: false });
		setChecking(false);
	}, []);

	useEffect(() => {
		void checkInstall();
	}, [checkInstall]);

	// Live activity from the running Claude session.
	useEffect(() => {
		if (!window.electronAPI?.onClaudeActivity) return;
		return window.electronAPI.onClaudeActivity((activity) => {
			setActivities((previous) => [...previous.slice(-200), activity as Activity]);
		});
	}, []);

	useEffect(() => {
		if (!window.electronAPI?.onClaudeRenderProgress) return;
		return window.electronAPI.onClaudeRenderProgress(({ percent }) => setRenderPercent(percent));
	}, []);

	useEffect(() => {
		activityEndRef.current?.scrollIntoView({ block: "end" });
	}, []);

	const handlePlan = useCallback(async () => {
		if (!request.trim() || busy) return;
		setBusy("planning");
		setError(null);
		setActivities([]);
		setSession(null);
		setInserted(false);

		const result = await window.electronAPI.claudePlan({
			request,
			format,
			targetSeconds,
			model,
			look,
		});

		if (!result.success || !result.session) {
			setError(result.error ?? "Claude could not plan this video.");
			setBusy(null);
			return;
		}

		const planned = result.session as unknown as CreatorSession;
		setSession(planned);
		if (planned.status === "failed") {
			setError(planned.error ?? "Claude finished without a usable storyboard.");
			setBusy(null);
			return;
		}

		// Stills are cheap next to a full render and make the plan judgeable.
		setBusy("previewing");
		const preview = await window.electronAPI.claudePreview(planned.id);
		if (preview.success && preview.session) {
			setSession(preview.session as unknown as CreatorSession);
		}
		setBusy(null);
	}, [request, format, targetSeconds, model, look, busy]);

	const handleRender = useCallback(async () => {
		if (!session || busy) return;
		setBusy("rendering");
		setRenderPercent(0);
		setError(null);
		const result = await window.electronAPI.claudeRender(session.id);
		if (!result.success || !result.session) {
			setError(result.error ?? "The render failed.");
		} else {
			const rendered = result.session as unknown as CreatorSession;
			setSession(rendered);
			if (rendered.status === "failed") setError(rendered.error ?? "The render failed.");
		}
		setBusy(null);
	}, [session, busy]);

	const handleInsert = useCallback(async () => {
		if (!session?.videoPath) return;
		const result = await window.electronAPI.claudeInsertIntoEditor(session.id);
		if (result.success) setInserted(true);
		else setError(result.error ?? "Could not hand the scene to the editor.");
	}, [session]);

	const handleCancel = useCallback(async () => {
		if (!session) return;
		await window.electronAPI.claudeCancel(session.id);
	}, [session]);

	// ── Setup gate ──
	if (checking || !installation?.installed) {
		return (
			<SetupGate
				checking={checking}
				installation={installation}
				copied={copied}
				onCopy={() => {
					void navigator.clipboard.writeText(INSTALL_COMMAND);
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				}}
				onRecheck={checkInstall}
				onClose={onClose}
			/>
		);
	}

	// The two looks name their scene list differently; the view treats them alike.
	const plan: { title: string; accent: string; scenes: PlanScene[] } | undefined = session?.motion
		? session.motion
		: session?.storyboard
			? {
					title: session.storyboard.title,
					accent: session.storyboard.accent,
					scenes: session.storyboard.frames,
				}
			: undefined;
	const scenes: PlanScene[] = plan?.scenes ?? [];

	return (
		<div className="flex h-screen flex-col bg-[#1C1917] text-white">
			<header
				className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#6E6BFF]/15">
					<Bot size={15} className="text-[#6E6BFF]" />
				</div>
				<div className="min-w-0">
					<h1 className="text-sm font-semibold">AI Video Creator</h1>
					<p className="truncate text-[11px] text-white/40">
						Claude Code {installation.version} · designs scenes, Guide Studio renders them
					</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
					className="ml-auto rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
				>
					<X size={16} />
				</button>
			</header>

			<div className="flex min-h-0 flex-1">
				{/* Brief */}
				<aside className="flex w-[340px] flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/[0.06] p-5">
					<div>
						<label
							htmlFor="creator-request"
							className="mb-1.5 block text-[11px] font-medium text-white/60"
						>
							What should the video say?
						</label>
						<textarea
							id="creator-request"
							value={request}
							onChange={(event) => setRequest(event.target.value)}
							rows={6}
							disabled={busy !== null}
							placeholder="A 45-second explainer for our new export pipeline: it renders locally, keeps footage on the machine, and finishes a 5-minute walkthrough in under two minutes."
							className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13px] leading-relaxed text-white placeholder:text-white/25 focus:border-[#6E6BFF]/60 focus:outline-none disabled:opacity-50"
						/>
						<p className="mt-1.5 text-[10px] text-white/30">
							Specifics beat adjectives — name the audience, the outcome, and anything Claude should
							not invent.
						</p>
					</div>

					<Field label="Look">
						<div className="flex flex-col gap-1.5">
							{LOOKS.map((option) => (
								<button
									key={option.id}
									type="button"
									onClick={() => setLook(option.id)}
									disabled={busy !== null}
									className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
										look === option.id
											? "border-[#6E6BFF]/60 bg-[#6E6BFF]/15"
											: "border-white/10 hover:bg-white/5"
									}`}
								>
									<div className="text-[12px] text-white/90">{option.label}</div>
									<div className="text-[10px] text-white/40">{option.hint}</div>
								</button>
							))}
						</div>
					</Field>

					<Field label="Shape">
						<div className="flex gap-1.5">
							{FORMATS.map((option) => (
								<Choice
									key={option.id}
									active={format === option.id}
									disabled={busy !== null}
									onClick={() => setFormat(option.id)}
									label={option.label}
									hint={option.hint}
								/>
							))}
						</div>
					</Field>

					<Field label="Target length">
						<div className="flex flex-wrap gap-1.5">
							{LENGTHS.map((seconds) => (
								<Choice
									key={seconds}
									active={targetSeconds === seconds}
									disabled={busy !== null}
									onClick={() => setTargetSeconds(seconds)}
									label={`${seconds}s`}
								/>
							))}
						</div>
					</Field>

					<Field label="Model">
						<div className="flex gap-1.5">
							{MODELS.map((option) => (
								<Choice
									key={option.id}
									active={model === option.id}
									disabled={busy !== null}
									onClick={() => setModel(option.id)}
									label={option.label}
									hint={option.hint}
								/>
							))}
						</div>
						<p className="mt-1.5 text-[10px] text-white/30">
							Runs on your Claude subscription, through your own install.
						</p>
					</Field>

					<button
						type="button"
						onClick={handlePlan}
						disabled={!request.trim() || busy !== null}
						className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-[#6E6BFF] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#5B58E6] disabled:cursor-not-allowed disabled:opacity-40"
					>
						{busy === "planning" || busy === "previewing" ? (
							<>
								<Loader2 size={14} className="animate-spin" />
								{busy === "planning" ? "Claude is planning…" : "Rendering preview…"}
							</>
						) : (
							<>
								<Sparkles size={14} />
								Design the video
							</>
						)}
					</button>
					{busy === "planning" && (
						<button
							type="button"
							onClick={handleCancel}
							className="rounded-lg px-3 py-1.5 text-[11px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
						>
							Cancel run
						</button>
					)}
				</aside>

				{/* Result */}
				<main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
					{error && (
						<div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3.5 py-3">
							<AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-rose-400" />
							<div className="min-w-0">
								<p className="text-[12px] font-medium text-rose-200">That run did not finish</p>
								<p className="mt-0.5 break-words text-[11px] text-rose-200/70">{error}</p>
							</div>
						</div>
					)}

					{!session && activities.length === 0 && !error && <EmptyState />}

					{activities.length > 0 && !session?.storyboard && (
						<ActivityFeed activities={activities} endRef={activityEndRef} />
					)}

					{plan && (
						<div className="flex flex-col gap-5">
							<div>
								<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
									<h2 className="text-lg font-semibold">{plan.title}</h2>
									<span className="text-[11px] text-white/40">
										{scenes.length} scenes · {Math.round(session?.durationSeconds ?? 0)}s ·{" "}
										{plan.accent}
										{session?.costUsd ? ` · $${session.costUsd.toFixed(3)}` : ""}
									</span>
								</div>
							</div>

							{session?.warnings && session.warnings.length > 0 && (
								<details className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3.5 py-2.5">
									<summary className="cursor-pointer text-[11px] font-medium text-amber-200/90">
										Guide Studio corrected {session.warnings.length}{" "}
										{session.warnings.length === 1 ? "thing" : "things"} in Claude's plan
									</summary>
									<ul className="mt-2 space-y-1">
										{session.warnings.map((warning) => (
											<li key={warning} className="text-[11px] leading-relaxed text-amber-200/60">
												{warning}
											</li>
										))}
									</ul>
								</details>
							)}

							{session?.previewPaths && session.previewPaths.length > 0 && (
								<div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
									{session.previewPaths.map((still) => (
										<img
											key={still.frameIndex}
											src={toFileUrl(still.path)}
											alt={`Frame ${still.frameIndex + 1}`}
											className="w-full rounded-lg border border-white/10 bg-black/40"
										/>
									))}
								</div>
							)}

							{session?.assets && session.assets.length > 0 && (
								<ImageCredits assets={session.assets} />
							)}

							<ol className="flex flex-col gap-1.5">
								{scenes.map((frame, index) => (
									<li
										key={frame.id || index}
										className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
									>
										<span className="mt-0.5 w-5 flex-shrink-0 text-[10px] tabular-nums text-white/30">
											{index + 1}
										</span>
										<span className="mt-0.5 flex-shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/50">
											{frame.textScene ?? frame.backdrop ?? frame.scene ?? frame.kind}
										</span>
										<div className="min-w-0 flex-1">
											{frame.text && (
												<p className="truncate text-[12px] text-white/90">{frame.text}</p>
											)}
											{frame.headline && (
												<p className="truncate text-[12px] text-white/90">{frame.headline}</p>
											)}
											{frame.subhead && (
												<p className="truncate text-[11px] text-white/45">{frame.subhead}</p>
											)}
											{frame.bullets?.map((bullet) => (
												<p key={bullet} className="truncate text-[11px] text-white/45">
													• {bullet}
												</p>
											))}
										</div>
										<span className="mt-0.5 flex-shrink-0 text-[10px] tabular-nums text-white/30">
											{frame.durationSeconds}s
										</span>
									</li>
								))}
							</ol>

							{session?.videoPath ? (
								<div className="flex flex-col gap-3">
									{/** biome-ignore lint/a11y/useMediaCaption: local preview of the user's own render */}
									<video
										src={toFileUrl(session.videoPath)}
										controls
										className="w-full rounded-xl border border-white/10 bg-black"
									/>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={handleInsert}
											disabled={inserted}
											className="flex items-center gap-2 rounded-xl bg-[#6E6BFF] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#5B58E6] disabled:opacity-50"
										>
											{inserted ? <Check size={14} /> : <ArrowRight size={14} />}
											{inserted ? "Added to the timeline" : "Add to editor timeline"}
										</button>
										<button
											type="button"
											onClick={handleRender}
											className="rounded-xl border border-white/10 px-3.5 py-2.5 text-[12px] text-white/70 transition-colors hover:bg-white/5"
										>
											Re-render
										</button>
									</div>
								</div>
							) : (
								<button
									type="button"
									onClick={handleRender}
									disabled={busy !== null}
									className="flex items-center justify-center gap-2 self-start rounded-xl bg-[#6E6BFF] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#5B58E6] disabled:opacity-40"
								>
									{busy === "rendering" ? (
										<>
											<Loader2 size={14} className="animate-spin" />
											Rendering… {renderPercent}%
										</>
									) : (
										<>
											<Film size={14} />
											Render this video
										</>
									)}
								</button>
							)}

							<details className="rounded-xl border border-white/[0.06]">
								<summary className="cursor-pointer px-3.5 py-2.5 text-[11px] text-white/40">
									Claude's activity log
								</summary>
								<div className="border-t border-white/[0.06] p-3">
									<ActivityFeed activities={activities} endRef={activityEndRef} />
								</div>
							</details>
						</div>
					)}
				</main>
			</div>
		</div>
	);
}

/**
 * What Claude asked for and what Guide Studio actually found. The credit is
 * shown here as well as burned into the outro, because a user about to publish
 * should be able to see whose photograph they are publishing before they do.
 */
function ImageCredits({ assets }: { assets: CreatorAsset[] }) {
	return (
		<details className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
			<summary className="cursor-pointer px-3.5 py-2.5 text-[11px] text-white/50">
				{assets.length} {assets.length === 1 ? "image" : "images"} fetched · credited on the closing
				card
			</summary>
			<div className="flex flex-col gap-2 border-t border-white/[0.06] p-3">
				{assets.map((asset) => (
					<div key={asset.id} className="flex items-start gap-3">
						<img
							src={toFileUrl(asset.path)}
							alt={asset.label}
							className="h-11 w-16 flex-shrink-0 rounded border border-white/10 bg-black/40 object-cover"
						/>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[11px] text-white/80">{asset.label}</p>
							<p className="truncate text-[10px] text-white/35">asked for: {asset.query}</p>
							<p className="truncate text-[10px] text-white/35">{asset.attribution}</p>
						</div>
					</div>
				))}
			</div>
		</details>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<p className="mb-1.5 text-[11px] font-medium text-white/60">{label}</p>
			{children}
		</div>
	);
}

function Choice({
	active,
	disabled,
	onClick,
	label,
	hint,
}: {
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
	label: string;
	hint?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={hint}
			className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-40 ${
				active
					? "border-[#6E6BFF]/60 bg-[#6E6BFF]/15 text-white"
					: "border-white/10 text-white/50 hover:bg-white/5"
			}`}
		>
			{label}
		</button>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
			<Clapperboard size={26} className="text-white/15" />
			<p className="text-[13px] text-white/40">
				Describe a video and Claude will design the scenes
			</p>
			<p className="max-w-sm text-[11px] leading-relaxed text-white/25">
				Claude plans the frames against Guide Studio's scene library. Nothing renders until you
				approve the plan, and nothing leaves this machine.
			</p>
		</div>
	);
}

function ActivityFeed({
	activities,
	endRef,
}: {
	activities: Activity[];
	endRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
	return (
		<div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-[11px]">
			{activities.map((activity, index) => (
				<ActivityLine key={`${activity.kind}-${index}`} activity={activity} />
			))}
			<div ref={endRef} />
		</div>
	);
}

function ActivityLine({ activity }: { activity: Activity }) {
	if (activity.kind === "started") {
		return <p className="text-white/40">● session started</p>;
	}
	if (activity.kind === "tool") {
		return (
			<p className="text-[#6E6BFF]/80">
				→ {activity.tool}
				{activity.detail ? <span className="text-white/35"> {activity.detail}</span> : null}
			</p>
		);
	}
	if (activity.kind === "tool-result") {
		return (
			<p className={activity.ok ? "text-emerald-400/50" : "text-rose-400/70"}>
				{activity.ok ? "✓" : "✗"} {activity.detail ?? ""}
			</p>
		);
	}
	if (activity.kind === "finished") {
		return <p className="text-emerald-400/70">● {activity.summary ?? "done"}</p>;
	}
	if (activity.kind === "log") {
		return <p className="whitespace-pre-wrap break-words text-white/25">{activity.text}</p>;
	}
	return <p className="whitespace-pre-wrap break-words text-white/70">{activity.text}</p>;
}

function SetupGate({
	checking,
	installation,
	copied,
	onCopy,
	onRecheck,
	onClose,
}: {
	checking: boolean;
	installation: Installation | null;
	copied: boolean;
	onCopy: () => void;
	onRecheck: () => void;
	onClose: () => void;
}) {
	return (
		<div className="flex h-screen flex-col bg-[#1C1917] text-white">
			<header
				className="flex items-center px-5 py-3"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				<button
					type="button"
					onClick={onClose}
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
					className="ml-auto rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
				>
					<X size={16} />
				</button>
			</header>

			<div className="flex flex-1 items-center justify-center p-6">
				<div className="w-full max-w-md">
					<div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#6E6BFF]/15">
						{checking ? (
							<Loader2 size={20} className="animate-spin text-[#6E6BFF]" />
						) : (
							<Terminal size={20} className="text-[#6E6BFF]" />
						)}
					</div>

					<h1 className="text-lg font-semibold">
						{checking ? "Looking for Claude Code…" : "Connect your Claude Code"}
					</h1>
					<p className="mt-2 text-[13px] leading-relaxed text-white/50">
						The AI Video Creator drives Claude Code on this machine — your install, your login, your
						subscription. Guide Studio sends it the brief and renders what it designs.
					</p>

					{!checking && (
						<>
							<ol className="mt-5 flex flex-col gap-3">
								<Step index={1} title="Install Claude Code">
									<div className="mt-1.5 flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
										<code className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/70">
											{INSTALL_COMMAND}
										</code>
										<button
											type="button"
											onClick={onCopy}
											className="flex-shrink-0 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
										>
											{copied ? <Check size={13} /> : <Copy size={13} />}
										</button>
									</div>
								</Step>
								<Step index={2} title="Sign in">
									<p className="mt-1 text-[12px] text-white/45">
										Run <code className="font-mono text-white/60">claude</code> once in a terminal
										and complete the login.
									</p>
								</Step>
								<Step index={3} title="Come back and re-check">
									<p className="mt-1 text-[12px] text-white/45">
										Guide Studio looks in the standard install locations, so no path setup is
										needed.
									</p>
								</Step>
							</ol>

							{installation?.error && (
								<p className="mt-4 break-words rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[10px] text-white/35">
									{installation.error}
								</p>
							)}

							<button
								type="button"
								onClick={onRecheck}
								className="mt-5 flex items-center gap-2 rounded-xl bg-[#6E6BFF] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#5B58E6]"
							>
								<RefreshCw size={14} />
								Check again
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function Step({
	index,
	title,
	children,
}: {
	index: number;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<li className="flex gap-3">
			<span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] text-white/50">
				{index}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-[13px] font-medium text-white/85">{title}</p>
				{children}
			</div>
		</li>
	);
}
