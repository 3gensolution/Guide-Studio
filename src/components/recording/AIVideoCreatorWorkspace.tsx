// ── AI Video Creator ─────────────────────────────────────────────────────
//
// Guide Studio orchestrates; a coding agent designs. The user describes a
// video, we hand the agent a brief plus our craft skills, and it writes a
// storyboard against the fixed scene library. We validate it, render it
// locally, and let the user drop the result onto the editor timeline.
//
// Two agents can do the designing — Claude Code on a Claude subscription, or
// Codex on a ChatGPT sign-in — and the user picks per video. Nothing after the
// plan differs, so the choice only shows up in this file as copy, a model
// list, and which install we look for.
//
// The stages are deliberately visible — brief, plan, preview, render — because
// each one costs the user something different (their agent quota, then their
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
type Look = "motion" | "cards" | "whiteboard";
type AgentId = "claude" | "codex";

interface Installation {
	agent?: AgentId;
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
	{
		id: "whiteboard",
		label: "Whiteboard",
		hint: "A hand writes every frame on a board — text only",
	},
];

const LENGTHS = [15, 30, 45, 60, 90];

/**
 * The two agents, as the user meets them. This mirrors `electron/claude-
 * runtime/agents.ts`, which is the authority — main narrows whatever the
 * renderer sends and picks the model itself if this list is out of date.
 *
 * `scope` is not decoration. The two agents are confined to the session folder
 * by different mechanisms, and Codex reaching that guarantee through a sandbox
 * rather than a tool allowlist means it *can* run commands in there. That is a
 * real difference in what the user is authorising, so it is on the screen
 * rather than in a changelog.
 */
const AGENT_UI: Record<
	AgentId,
	{
		label: string;
		account: string;
		installCommand: string;
		signInCommand: string;
		note: string;
		scope: string;
		models: Array<{ id: string; label: string; hint?: string }>;
	}
> = {
	claude: {
		label: "Claude Code",
		account: "Claude subscription",
		installCommand: "npm install -g @anthropic-ai/claude-code",
		signInCommand: "claude",
		note: "Runs on your Claude subscription, through your own install.",
		scope: "File tools only, scoped to the session folder.",
		models: [
			{ id: "claude-opus-5", label: "Opus 5", hint: "Most capable" },
			{ id: "claude-sonnet-5", label: "Sonnet 5", hint: "Faster, cheaper" },
		],
	},
	codex: {
		label: "Codex",
		account: "ChatGPT sign-in",
		installCommand: "npm install -g @openai/codex",
		signInCommand: "codex",
		// Codex model ids depend on both the CLI version and the ChatGPT plan,
		// and pinning one either side does not carry fails the run outright, so
		// the only offer here is the CLI's own default.
		note: "Runs on your ChatGPT sign-in. Auto uses the model selected by a current Codex CLI; older CLIs can inherit an incompatible model from ~/.codex/config.toml.",
		scope:
			"Sandboxed to the session folder with the network off; it can run shell commands in there.",
		models: [{ id: "", label: "Auto", hint: "Codex-compatible default" }],
	},
};

const AGENT_ORDER: AgentId[] = ["claude", "codex"];

export function AIVideoCreatorWorkspace({ onClose }: { onClose: () => void }) {
	const [installations, setInstallations] = useState<Record<AgentId, Installation> | null>(null);
	const [checking, setChecking] = useState(true);
	const [copied, setCopied] = useState<AgentId | null>(null);

	const [request, setRequest] = useState("");
	const [agent, setAgent] = useState<AgentId>("claude");
	const [format, setFormat] = useState<Format>("landscape");
	const [targetSeconds, setTargetSeconds] = useState(45);
	const [look, setLook] = useState<Look>("motion");
	const [model, setModel] = useState(AGENT_UI.claude.models[0].id);

	const [session, setSession] = useState<CreatorSession | null>(null);
	const [activities, setActivities] = useState<Activity[]>([]);
	const [busy, setBusy] = useState<"planning" | "previewing" | "rendering" | null>(null);
	const [renderPercent, setRenderPercent] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [inserted, setInserted] = useState(false);
	const activityEndRef = useRef<HTMLDivElement | null>(null);

	const agentUi = AGENT_UI[agent];
	const agentLabel = agentUi.label;
	const installation = installations?.[agent] ?? null;
	const anyInstalled = AGENT_ORDER.some((id) => installations?.[id]?.installed === true);

	const checkInstall = useCallback(async () => {
		setChecking(true);
		const result = await window.electronAPI.agentDetect();
		const found = result.agents ?? {
			claude: { installed: false, supportsFileSkills: false },
			codex: { installed: false, supportsFileSkills: false },
		};
		setInstallations(found);
		// Land on an agent that can actually run. Claude first when both are
		// present, because it is the one the feature was built against.
		setAgent((current) => {
			if (found[current]?.installed) return current;
			return AGENT_ORDER.find((id) => found[id]?.installed) ?? current;
		});
		setChecking(false);
	}, []);

	useEffect(() => {
		void checkInstall();
	}, [checkInstall]);

	// A model id only means anything to the agent it belongs to, so switching
	// agents resets the choice rather than sending Claude's id to Codex.
	useEffect(() => {
		setModel(AGENT_UI[agent].models[0].id);
	}, [agent]);

	// Live activity from the running agent session.
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
			agent,
			format,
			targetSeconds,
			model,
			look,
		});

		if (!result.success || !result.session) {
			setError(result.error ?? `${agentLabel} could not plan this video.`);
			setBusy(null);
			return;
		}

		const planned = result.session as unknown as CreatorSession;
		setSession(planned);
		if (planned.status === "failed") {
			setError(planned.error ?? `${agentLabel} finished without a usable storyboard.`);
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
	}, [request, agent, agentLabel, format, targetSeconds, model, look, busy]);

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
	// Held until *some* agent is runnable, not until the selected one is: with
	// two supported CLIs, "you have neither" and "you have the other" are
	// different problems and only the first is a wall.
	if (checking || !anyInstalled) {
		return (
			<SetupGate
				checking={checking}
				installations={installations}
				copied={copied}
				onCopy={(id) => {
					void navigator.clipboard.writeText(AGENT_UI[id].installCommand);
					setCopied(id);
					setTimeout(() => setCopied(null), 2000);
				}}
				onRecheck={checkInstall}
				onClose={onClose}
			/>
		);
	}

	// A motion project names its scene list differently from a storyboard; the
	// view treats them alike.
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
						{agentLabel}
						{installation?.version ? ` ${installation.version}` : ""} · designs scenes, Guide Studio
						renders them
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
							Specifics beat adjectives — name the audience, the outcome, and anything the agent
							should not invent.
						</p>
					</div>

					<Field label="Agent">
						<div className="flex gap-1.5">
							{AGENT_ORDER.map((id) => {
								const found = installations?.[id];
								return (
									<button
										key={id}
										type="button"
										onClick={() => setAgent(id)}
										// An agent that is not installed cannot be chosen, but it
										// is still shown: a user who only has one of the two
										// should learn the other is supported.
										disabled={busy !== null || !found?.installed}
										className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
											agent === id
												? "border-[#6E6BFF]/60 bg-[#6E6BFF]/15"
												: "border-white/10 hover:bg-white/5"
										}`}
									>
										<div className="text-[12px] text-white/90">{AGENT_UI[id].label}</div>
										<div className="truncate text-[10px] text-white/40">
											{found?.installed ? AGENT_UI[id].account : "Not installed"}
										</div>
									</button>
								);
							})}
						</div>
						<p className="mt-1.5 text-[10px] text-white/30">{agentUi.scope}</p>
					</Field>

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
							{agentUi.models.map((option) => (
								<Choice
									key={option.id || "auto"}
									active={model === option.id}
									disabled={busy !== null}
									onClick={() => setModel(option.id)}
									label={option.label}
									hint={option.hint}
								/>
							))}
						</div>
						<p className="mt-1.5 text-[10px] text-white/30">{agentUi.note}</p>
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
								{busy === "planning" ? `${agentLabel} is planning…` : "Rendering preview…"}
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

					{!session && activities.length === 0 && !error && <EmptyState agentLabel={agentLabel} />}

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
										{session.warnings.length === 1 ? "thing" : "things"} in the agent's plan
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
									{agentLabel} activity log
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
 * What the agent asked for and what Guide Studio actually found. The credit is
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

function EmptyState({ agentLabel }: { agentLabel: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
			<Clapperboard size={26} className="text-white/15" />
			<p className="text-[13px] text-white/40">
				Describe a video and {agentLabel} will design the scenes
			</p>
			<p className="max-w-sm text-[11px] leading-relaxed text-white/25">
				{agentLabel} plans the frames against Guide Studio's scene library. Nothing renders until
				you approve the plan, and nothing leaves this machine.
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
	installations,
	copied,
	onCopy,
	onRecheck,
	onClose,
}: {
	checking: boolean;
	installations: Record<AgentId, Installation> | null;
	copied: AgentId | null;
	onCopy: (agent: AgentId) => void;
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
						{checking ? "Looking for a coding agent…" : "Connect a coding agent"}
					</h1>
					<p className="mt-2 text-[13px] leading-relaxed text-white/50">
						The AI Video Creator drives a coding CLI on this machine — your install, your login,
						your subscription. Guide Studio sends it the brief and renders what it designs. Set up
						either one; you can switch per video.
					</p>

					{!checking && (
						<>
							<div className="mt-5 flex flex-col gap-3">
								{AGENT_ORDER.map((id) => (
									<AgentSetupCard
										key={id}
										agent={id}
										installation={installations?.[id] ?? null}
										copied={copied === id}
										onCopy={() => onCopy(id)}
									/>
								))}
							</div>

							<button
								type="button"
								onClick={onRecheck}
								className="mt-5 flex items-center gap-2 rounded-xl bg-[#6E6BFF] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#5B58E6]"
							>
								<RefreshCw size={14} />
								Check again
							</button>

							<p className="mt-3 text-[11px] text-white/30">
								Guide Studio looks in the standard install locations, so no path setup is needed.
							</p>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * One agent's install instructions, or a green tick if it is already there.
 * The error is shown verbatim because the useful ones are specific — a
 * missing sign-in, a broken shim — and paraphrasing them loses the fix.
 */
function AgentSetupCard({
	agent,
	installation,
	copied,
	onCopy,
}: {
	agent: AgentId;
	installation: Installation | null;
	copied: boolean;
	onCopy: () => void;
}) {
	const ui = AGENT_UI[agent];
	const ready = installation?.installed === true;

	return (
		<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
			<div className="flex items-center gap-2">
				<p className="text-[13px] font-medium text-white/85">{ui.label}</p>
				<span className="text-[11px] text-white/35">{ui.account}</span>
				{ready && (
					<span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400/80">
						<Check size={12} />
						{installation?.version ?? "ready"}
					</span>
				)}
			</div>

			{!ready && (
				<>
					<div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
						<code className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/70">
							{ui.installCommand}
						</code>
						<button
							type="button"
							onClick={onCopy}
							className="flex-shrink-0 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
						>
							{copied ? <Check size={13} /> : <Copy size={13} />}
						</button>
					</div>
					<p className="mt-1.5 text-[11px] text-white/40">
						Then run <code className="font-mono text-white/60">{ui.signInCommand}</code> once in a
						terminal and complete the login.
					</p>
					{installation?.error && (
						<p className="mt-2 break-words rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[10px] text-white/30">
							{installation.error}
						</p>
					)}
				</>
			)}
		</div>
	);
}
