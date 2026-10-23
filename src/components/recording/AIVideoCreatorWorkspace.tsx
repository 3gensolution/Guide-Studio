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
	AudioLines,
	Bot,
	Captions,
	Check,
	CheckCheck,
	Clapperboard,
	Copy,
	Film,
	Loader2,
	Music2,
	Paperclip,
	RefreshCw,
	Sparkles,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import type { MediaContextAsset } from "@/lib/ai/mediaContext";
import { VOICE_OPTIONS } from "@/lib/ai/polishTemplates";
import { aiService } from "@/lib/api/ai";
import { AnimatedScenesPanel, type AnimatedStateView } from "./AnimatedScenesPanel";

type Format = "landscape" | "vertical" | "square";
type Look = "animated" | "motion" | "cards" | "whiteboard";
type CreativeSkillId = "explainer-motion" | "product-launch" | "product-update" | "brand-reveal";
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
	logoAssetId?: string;
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
	generated?: boolean;
}

interface CreatorSession {
	id: string;
	request: string;
	format: Format;
	status: "planning" | "planned" | "rendering" | "rendered" | "failed";
	look?: Look;
	creativeSkill?: CreativeSkillId;
	visualSource?: "stock" | "generated";
	storyboard?: { title: string; accent: string; frames: PlanScene[] };
	motion?: { title: string; accent: string; scenes: PlanScene[] };
	/** The Animated look: an agent-built HyperFrames project, summarized. */
	animated?: AnimatedStateView;
	assets?: CreatorAsset[];
	referenceAssets?: MediaContextAsset[];
	warnings?: string[];
	craftWarnings?: string[];
	durationSeconds?: number;
	previewPaths?: Array<{ frameIndex: number; path: string }>;
	shotReviews?: Array<{
		shotIndex: number;
		status: "pending" | "approved" | "rejected";
		durationSeconds?: number;
		note?: string;
	}>;
	videoPath?: string;
	masterPath?: string;
	interchange?: { manifestPath: string; fcpxmlPath: string };
	costUsd?: number;
	error?: string;
	finishing?: {
		narration?: {
			segments: Array<{ text: string; startMs: number; endMs: number; audioPath: string }>;
			fullAudioPath?: string;
		};
		musicPath?: string;
		musicVolume: number;
		muteOriginalAudio: boolean;
		sfx?: Array<{ audioPath: string; offsetMs: number; volume?: number }>;
	};
}

interface CreatorFinishingInput {
	narration?: {
		segments: Array<{
			id: string;
			text: string;
			startMs: number;
			endMs: number;
			audioPath: string;
		}>;
		voiceId: string;
		language: string;
		fullAudioPath?: string;
		captions?: Array<{ text: string; startMs: number; endMs: number }>;
	};
	musicPath?: string;
	musicVolume: number;
	muteOriginalAudio: boolean;
	sfx?: Array<{ audioPath: string; offsetMs: number; volume?: number }>;
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

// Animated has the agent write real HyperFrames compositions (HTML + GSAP)
// with sound design. Motion templates and cards pick from our fixed library.
const LOOKS: Array<{ id: Look; label: string; hint: string }> = [
	{
		id: "animated",
		label: "Animated (HyperFrames)",
		hint: "Custom motion graphics, sound effects and music over your footage — every scene editable",
	},
	{
		id: "motion",
		label: "Motion templates",
		hint: "Animated images, camera movement, and kinetic typography from a fixed library",
	},
	{ id: "cards", label: "Clean cards", hint: "Layout cards with product imagery and footage" },
	{
		id: "whiteboard",
		label: "Whiteboard",
		hint: "A hand writes every frame on a board — text only",
	},
];

const CREATIVE_SKILLS: Array<{ id: CreativeSkillId; label: string; hint: string }> = [
	{
		id: "explainer-motion",
		label: "Explainer motion",
		hint: "Problem → proof → outcome",
	},
	{
		id: "product-launch",
		label: "Product launch",
		hint: "Anticipation → reveal → brand",
	},
	{
		id: "product-update",
		label: "Product update",
		hint: "Show the workflow change",
	},
	{
		id: "brand-reveal",
		label: "Brand reveal",
		hint: "Identity, texture, logo",
	},
];

const LENGTHS = [15, 24, 30, 45, 60, 90];

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
	const [look, setLook] = useState<Look>("animated");
	const [creativeSkill, setCreativeSkill] = useState<CreativeSkillId>("explainer-motion");
	const [visualSource, setVisualSource] = useState<"stock" | "generated">("stock");
	const [model, setModel] = useState(AGENT_UI.claude.models[0].id);
	const [references, setReferences] = useState<MediaContextAsset[]>([]);

	const [session, setSession] = useState<CreatorSession | null>(null);
	const [activities, setActivities] = useState<Activity[]>([]);
	const [busy, setBusy] = useState<
		| "planning"
		| "previewing"
		| "reviewing"
		| "rendering"
		| "clearing"
		| "revising"
		| "editing"
		| null
	>(null);
	const [renderPercent, setRenderPercent] = useState(0);
	/** The animated scene (or "video") a revision or edit is running for. */
	const [workingOn, setWorkingOn] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [inserted, setInserted] = useState(false);
	const [durationDrafts, setDurationDrafts] = useState<Record<number, string>>({});
	const [narrationScript, setNarrationScript] = useState("");
	const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);
	const [voiceoverPath, setVoiceoverPath] = useState<string | undefined>();
	const [musicPath, setMusicPath] = useState<string | undefined>();
	const [musicVolume, setMusicVolume] = useState(18);
	const [sfxPath, setSfxPath] = useState<string | undefined>();
	const [sfxOffsetSec, setSfxOffsetSec] = useState(0);
	const [finishingBusy, setFinishingBusy] = useState(false);
	const [masterBusy, setMasterBusy] = useState(false);
	const [interchangeBusy, setInterchangeBusy] = useState(false);
	const activityEndRef = useRef<HTMLDivElement | null>(null);
	const referencesRef = useRef<MediaContextAsset[]>([]);
	referencesRef.current = references;

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

	// The creator window can be reloaded by the app after display sleep or a
	// renderer recovery. Restore the latest reviewable session instead of
	// making the user lose a completed plan.
	useEffect(() => {
		let cancelled = false;
		void window.electronAPI.claudeSessions().then((result) => {
			if (cancelled || !result.success) return;
			const recovered = result.sessions.find(
				(candidate) => candidate.status === "planned" || candidate.status === "rendered",
			);
			if (recovered) setSession(recovered as unknown as CreatorSession);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		activityEndRef.current?.scrollIntoView({ block: "end" });
	}, []);

	useEffect(() => {
		return () => {
			const assetIds = referencesRef.current.map((asset) => asset.id);
			if (assetIds.length) void window.electronAPI.releaseAIReferenceAssets(assetIds);
		};
	}, []);

	const handlePlan = useCallback(async () => {
		if ((!request.trim() && !references.some((asset) => asset.kind === "video")) || busy) return;
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
			creativeSkill,
			visualSource,
			referenceAssetIds: references.map((asset) => asset.id),
		});

		if (!result.success || !result.session) {
			setError(result.error ?? `${agentLabel} could not plan this video.`);
			setBusy(null);
			return;
		}

		const planned = result.session as unknown as CreatorSession;
		setSession(planned);
		setDurationDrafts({});
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
	}, [
		request,
		agent,
		agentLabel,
		format,
		targetSeconds,
		model,
		look,
		creativeSkill,
		visualSource,
		references,
		busy,
	]);

	const handlePickReferences = useCallback(async () => {
		if (busy) return;
		const result = await window.electronAPI.openAIReferenceFilePicker();
		if (!result.success || !result.assets?.length) {
			if (result.error) setError(result.error);
			return;
		}
		setError(null);
		setReferences((current) => {
			const byId = new Map(current.map((asset) => [asset.id, asset]));
			for (const asset of result.assets ?? []) byId.set(asset.id, asset);
			return [...byId.values()].slice(0, 12);
		});
	}, [busy]);

	const handleRemoveReference = useCallback((id: string) => {
		setReferences((current) => current.filter((asset) => asset.id !== id));
		void window.electronAPI.releaseAIReferenceAssets([id]);
	}, []);

	const handleRender = useCallback(async () => {
		if (!session || busy) return;
		const shotCount = session.motion?.scenes.length ?? session.storyboard?.frames.length ?? 0;
		const approvedCount =
			session.shotReviews?.filter((review) => review.status === "approved").length ?? 0;
		if (!shotCount || approvedCount !== shotCount) {
			setError("Approve every shot in the review panel before rendering.");
			return;
		}
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

	const handleChooseMusic = useCallback(async () => {
		const result = await window.electronAPI.openAudioFilePicker();
		if (result.success && result.path) {
			setMusicPath(result.path);
			setError(null);
		} else if (result.error) {
			setError(result.error);
		}
	}, []);

	const handleChooseVoiceover = useCallback(async () => {
		const result = await window.electronAPI.openAudioFilePicker();
		if (result.success && result.path) {
			setVoiceoverPath(result.path);
			setError(null);
		} else if (result.error) {
			setError(result.error);
		}
	}, []);

	const handleChooseSfx = useCallback(async () => {
		const result = await window.electronAPI.openAudioFilePicker();
		if (result.success && result.path) {
			setSfxPath(result.path);
			setError(null);
		} else if (result.error) {
			setError(result.error);
		}
	}, []);

	const handleGenerateFinishing = useCallback(async () => {
		if (!session || finishingBusy) return;
		const shots = session.motion?.scenes ?? session.storyboard?.frames ?? [];
		const blocks = narrationScript
			.split(/\n\s*\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (blocks.length > 0 && blocks.length !== shots.length) {
			setError(
				`Use one voiceover paragraph per shot (${shots.length} shots, ${blocks.length} provided).`,
			);
			return;
		}
		if (blocks.length === 0 && !voiceoverPath && !musicPath && !sfxPath) {
			setError(
				"Add a voiceover script, choose a voiceover file, or choose a music bed before applying finishing.",
			);
			return;
		}

		setFinishingBusy(true);
		setError(null);
		try {
			const segments: NonNullable<CreatorFinishingInput["narration"]>["segments"] = [];
			let fullAudioPath: string | undefined;
			let captions: Array<{ text: string; startMs: number; endMs: number }> = [];
			if (voiceoverPath) {
				const durationMs = await measureAudioDurationMs(voiceoverPath);
				const totalWords = blocks.reduce((total, block) => total + block.split(/\s+/).length, 0);
				if (!totalWords)
					throw new Error("Paste the voiceover script so captions can be synchronized.");
				let cursorMs = 0;
				captions = blocks.map((block, index) => {
					const remaining = blocks.length - index - 1;
					const proportional = Math.round((block.split(/\s+/).length / totalWords) * durationMs);
					const endMs =
						index === blocks.length - 1
							? durationMs
							: Math.min(durationMs - remaining * 500, cursorMs + Math.max(500, proportional));
					const line = { text: block, startMs: cursorMs, endMs: Math.max(cursorMs + 1, endMs) };
					cursorMs = line.endMs;
					return line;
				});
				fullAudioPath = voiceoverPath;
			} else if (blocks.length > 0) {
				let startMs = 0;
				for (let index = 0; index < blocks.length; index += 1) {
					const tts = await aiService.generateSpeech({
						text: blocks[index],
						voice: voiceId,
						model: "edge-tts",
					});
					if (!tts.success) {
						const providerError = tts.error ?? "Text-to-speech is unavailable.";
						if (/piper is not installed|tts not available/i.test(providerError)) {
							throw new Error(
								"No narration provider is available. Choose Use voiceover file for an ElevenLabs/recorded read, or configure MiniMax TTS in AI Settings.",
							);
						}
						throw new Error(providerError);
					}
					const durationMs = await measureAudioDurationMs(tts.data.audioUrl);
					const sceneDurationMs = Math.round((shots[index]?.durationSeconds ?? 1.5) * 1000);
					if (durationMs > sceneDurationMs + 350) {
						throw new Error(
							`Voiceover for shot ${index + 1} is too long. Shorten it or give the shot more time.`,
						);
					}
					segments.push({
						id: `creator-narration-${index + 1}`,
						text: blocks[index],
						startMs,
						endMs: Math.min(startMs + Math.max(durationMs, 600), startMs + sceneDurationMs),
						audioPath: tts.data.audioUrl,
					});
					startMs += sceneDurationMs;
				}
			}

			const finishing: CreatorFinishingInput = {
				...(segments.length || fullAudioPath
					? {
							narration: {
								segments,
								...(fullAudioPath ? { fullAudioPath, captions } : {}),
								voiceId,
								language: "en",
							},
						}
					: {}),
				...(musicPath ? { musicPath } : {}),
				...(sfxPath
					? {
							sfx: [
								{
									audioPath: sfxPath,
									offsetMs: Math.max(0, Math.round(sfxOffsetSec * 1000)),
									volume: 1,
								},
							],
						}
					: {}),
				musicVolume: musicVolume / 100,
				muteOriginalAudio: true,
			};
			const result = await window.electronAPI.claudeSetFinishing(session.id, finishing);
			if (!result.success || !result.session)
				throw new Error(result.error ?? "Could not save finishing.");
			const preview = await window.electronAPI.claudePreview(session.id);
			setSession(
				(preview.success && preview.session
					? preview.session
					: result.session) as unknown as CreatorSession,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not generate finishing audio.");
		} finally {
			setFinishingBusy(false);
		}
	}, [
		session,
		finishingBusy,
		narrationScript,
		voiceoverPath,
		musicPath,
		voiceId,
		musicVolume,
		sfxPath,
		sfxOffsetSec,
	]);

	const handleShotReview = useCallback(
		async (shotIndex: number, status: "pending" | "approved" | "rejected") => {
			if (!session || busy) return;
			const shots = session.motion?.scenes ?? session.storyboard?.frames ?? [];
			const shot = shots[shotIndex];
			if (!shot) return;
			const rawDuration = durationDrafts[shotIndex] ?? String(shot.durationSeconds);
			const durationSeconds = Number(rawDuration);
			if (!Number.isFinite(durationSeconds)) {
				setError(`Shot ${shotIndex + 1} needs a valid duration.`);
				return;
			}
			setError(null);
			const result = await window.electronAPI.claudeReviewShots(session.id, [
				{ shotIndex, status, durationSeconds },
			]);
			if (!result.success || !result.session) {
				setError(result.error ?? "Could not save the shot review.");
				return;
			}
			setSession(result.session as unknown as CreatorSession);
		},
		[session, busy, durationDrafts],
	);

	const handleApproveAll = useCallback(async () => {
		if (!session || busy) return;
		const shots = session.motion?.scenes ?? session.storyboard?.frames ?? [];
		if (shots.length === 0) return;
		const updates = shots.map((shot, shotIndex) => {
			const rawDuration = durationDrafts[shotIndex] ?? String(shot.durationSeconds);
			return {
				shotIndex,
				status: "approved" as const,
				durationSeconds: Number(rawDuration),
			};
		});
		if (updates.some((update) => !Number.isFinite(update.durationSeconds))) {
			setError("Every shot needs a valid duration before it can be approved.");
			return;
		}
		setBusy("reviewing");
		setError(null);
		const result = await window.electronAPI.claudeReviewShots(session.id, updates);
		if (!result.success || !result.session) {
			setError(result.error ?? "Could not approve all shots.");
		} else {
			setSession(result.session as unknown as CreatorSession);
		}
		setBusy(null);
	}, [session, busy, durationDrafts]);

	const handleRefreshPreview = useCallback(async () => {
		if (!session || busy) return;
		setBusy("previewing");
		setError(null);
		const result = await window.electronAPI.claudePreview(session.id);
		if (!result.success || !result.session) {
			setError(result.error ?? "Could not rebuild the scene previews.");
		} else {
			setSession(result.session as unknown as CreatorSession);
		}
		setBusy(null);
	}, [session, busy]);

	const handleClearSavedMedia = useCallback(async () => {
		if (!session || busy) return;
		setBusy("clearing");
		setError(null);
		const result = await window.electronAPI.claudeClearMedia(session.id);
		if (!result.success || !result.session) {
			setError(result.error ?? "Could not clear the saved preview and render.");
		} else {
			setSession(result.session as unknown as CreatorSession);
		}
		setBusy(null);
	}, [session, busy]);

	const handleClearAll = useCallback(async () => {
		if (!session || busy) return;
		const confirmed = window.confirm(
			"Clear this plan, its previews, and its rendered video? This cannot be undone.",
		);
		if (!confirmed) return;

		setBusy("clearing");
		setError(null);
		const assetIds = referencesRef.current.map((asset) => asset.id);
		const result = await window.electronAPI.claudeDiscard(session.id);
		if (!result.success) {
			setError("Could not clear this saved video session.");
			setBusy(null);
			return;
		}
		if (assetIds.length) void window.electronAPI.releaseAIReferenceAssets(assetIds);
		setReferences([]);
		setSession(null);
		setActivities([]);
		setDurationDrafts({});
		setInserted(false);
		setError(null);
		setBusy(null);
	}, [session, busy]);

	const handleInsert = useCallback(async () => {
		if (!session?.videoPath) return;
		const result = await window.electronAPI.claudeInsertIntoEditor(session.id);
		if (result.success) setInserted(true);
		else setError(result.error ?? "Could not hand the scene to the editor.");
	}, [session]);

	const handleCreateMaster = useCallback(async () => {
		if (!session?.videoPath || masterBusy) return;
		setMasterBusy(true);
		setError(null);
		const result = await window.electronAPI.claudeCreateMaster(session.id);
		if (!result.success || !result.session)
			setError(result.error ?? "Could not create the ProRes master.");
		else setSession(result.session as unknown as CreatorSession);
		setMasterBusy(false);
	}, [session, masterBusy]);

	const handleCreateInterchange = useCallback(async () => {
		if (!session?.videoPath || interchangeBusy) return;
		setInterchangeBusy(true);
		setError(null);
		const result = await window.electronAPI.claudeCreateInterchange(session.id);
		if (!result.success || !result.session) {
			setError(result.error ?? "Could not create the editable interchange package.");
		} else {
			setSession(result.session as unknown as CreatorSession);
		}
		setInterchangeBusy(false);
	}, [session, interchangeBusy]);

	const handleAnimatedSetValues = useCallback(
		async (sceneId: string | undefined, values: Record<string, string | number | boolean>) => {
			if (!session || busy) return;
			setBusy("editing");
			setWorkingOn(sceneId ?? "video");
			setError(null);
			const result = await window.electronAPI.claudeAnimatedSetValues(session.id, {
				...(sceneId ? { sceneId } : {}),
				values,
			});
			if (!result.success || !result.session) {
				setError(result.error ?? "Could not apply that edit.");
			} else {
				setSession(result.session as unknown as CreatorSession);
				const preview = await window.electronAPI.claudePreview(session.id);
				if (preview.success && preview.session) {
					setSession(preview.session as unknown as CreatorSession);
				}
			}
			setWorkingOn(null);
			setBusy(null);
		},
		[session, busy],
	);

	const handleAnimatedRevise = useCallback(
		async (instruction: string, sceneId?: string) => {
			if (!session || busy) return;
			setBusy("revising");
			setWorkingOn(sceneId ?? "video");
			setError(null);
			setActivities([]);
			const result = await window.electronAPI.claudeAnimatedRevise(session.id, {
				instruction,
				...(sceneId ? { sceneId } : {}),
			});
			if (!result.success || !result.session) {
				setError(result.error ?? `${agentLabel} could not make that change.`);
			} else {
				const revised = result.session as unknown as CreatorSession;
				setSession(revised);
				if (revised.status === "failed") {
					setError(revised.error ?? `${agentLabel} could not make that change.`);
				} else {
					setBusy("previewing");
					const preview = await window.electronAPI.claudePreview(revised.id);
					if (preview.success && preview.session) {
						setSession(preview.session as unknown as CreatorSession);
					}
				}
			}
			setWorkingOn(null);
			setBusy(null);
		},
		[session, busy, agentLabel],
	);

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
	const plan: { title: string; accent: string; scenes: PlanScene[] } | undefined = session?.animated
		? {
				title: session.request.split("\n")[0]?.slice(0, 80) || "Animated video",
				accent: "HyperFrames",
				scenes: session.animated.summary.scenes.map((scene) => ({
					id: scene.id,
					kind: "animated",
					durationSeconds: scene.durationSeconds,
					headline: String(
						scene.variables.find((variable) => variable.type === "string")?.value ?? scene.id,
					),
					scene: scene.id,
				})),
			}
		: session?.motion
			? session.motion
			: session?.storyboard
				? {
						title: session.storyboard.title,
						accent: session.storyboard.accent,
						scenes: session.storyboard.frames,
					}
				: undefined;
	const scenes: PlanScene[] = plan?.scenes ?? [];
	const approvedCount =
		session?.shotReviews?.filter((review) => review.status === "approved").length ?? 0;
	const allShotsApproved = scenes.length > 0 && approvedCount === scenes.length;

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
							What should the video say? (optional with a video)
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
							Attach a video to let AI infer the story, or add direction about the audience and
							outcome. Choose Animated for custom motion graphics like a finished product promo.
						</p>
					</div>

					<Field label="References">
						<button
							type="button"
							onClick={() => void handlePickReferences()}
							disabled={busy !== null || references.length >= 12}
							className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-3 py-2 text-[11px] text-white/55 transition-colors hover:border-[#6E6BFF]/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Paperclip size={13} />
							{references.length ? "Add more references" : "Add images or videos"}
						</button>
						{references.length > 0 && (
							<div className="mt-2 flex flex-col gap-1.5">
								{references.map((asset) => (
									<div
										key={asset.id}
										className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5"
									>
										{asset.kind === "image" && asset.previewPath ? (
											<img
												src={toFileUrl(asset.previewPath)}
												alt=""
												className="h-8 w-10 rounded object-cover"
											/>
										) : (
											<div className="flex h-8 w-10 items-center justify-center rounded bg-white/5 text-[9px] uppercase text-white/35">
												{asset.kind}
											</div>
										)}
										<span className="min-w-0 flex-1 truncate text-[10px] text-white/65">
											{asset.label}
										</span>
										<button
											type="button"
											onClick={() => handleRemoveReference(asset.id)}
											className="rounded p-1 text-white/30 hover:bg-white/10 hover:text-white/70"
											aria-label={`Remove ${asset.label}`}
										>
											<X size={12} />
										</button>
									</div>
								))}
							</div>
						)}
						<p className="mt-1.5 text-[10px] text-white/30">
							References are copied into the private session workspace before planning.
						</p>
					</Field>

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
						<p className="mt-1.5 text-[10px] text-white/30">
							{look === "animated" && agent === "claude"
								? "File tools plus the HyperFrames checker (./hf), scoped to the session folder."
								: agentUi.scope}
						</p>
					</Field>

					<Field label="Story skill">
						<div className="flex flex-col gap-1.5">
							{CREATIVE_SKILLS.map((option) => (
								<button
									key={option.id}
									type="button"
									onClick={() => setCreativeSkill(option.id)}
									disabled={busy !== null}
									className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
										creativeSkill === option.id
											? "border-[#6E6BFF]/60 bg-[#6E6BFF]/15"
											: "border-white/10 hover:bg-white/5"
									}`}
								>
									<div className="text-[12px] text-white/90">{option.label}</div>
									<div className="text-[10px] text-white/40">{option.hint}</div>
								</button>
							))}
						</div>
						<p className="mt-1.5 text-[10px] text-white/30">
							Skills share the same media, motion, review, and export infrastructure.
						</p>
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

					<Field label="Visuals">
						<div className="flex gap-1.5">
							{(
								[
									{ id: "stock" as const, label: "Stock", hint: "Licensed photographs" },
									{
										id: "generated" as const,
										label: "AI-generated",
										hint: "Atmosphere and illustration",
									},
								] as const
							).map((option) => (
								<button
									key={option.id}
									type="button"
									onClick={() => setVisualSource(option.id)}
									disabled={busy !== null}
									className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
										visualSource === option.id
											? "border-[#6E6BFF]/60 bg-[#6E6BFF]/15"
											: "border-white/10 hover:bg-white/5"
									}`}
								>
									<div className="text-[12px] text-white/90">{option.label}</div>
									<div className="text-[10px] text-white/40">{option.hint}</div>
								</button>
							))}
						</div>
						<p className="mt-1.5 text-[10px] text-white/30">
							Generated visuals are never used for exact UI, logos, charts, or readable product
							text.
						</p>
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
						disabled={
							(!request.trim() && !references.some((asset) => asset.kind === "video")) ||
							busy !== null
						}
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
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
									<h2 className="text-lg font-semibold">{plan.title}</h2>
									<span className="text-[11px] text-white/40">
										{scenes.length} scenes · {Math.round(session?.durationSeconds ?? 0)}s ·{" "}
										{plan.accent}
										{session?.costUsd ? ` · $${session.costUsd.toFixed(3)}` : ""}
									</span>
								</div>
								<button
									type="button"
									onClick={() => void handleClearAll()}
									disabled={busy !== null}
									className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] text-white/45 transition-colors hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Trash2 size={12} />
									Clear all
								</button>
							</div>

							{session?.warnings && session.warnings.length > 0 && (
								<details className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3.5 py-2.5">
									<summary className="cursor-pointer text-[11px] font-medium text-amber-200/90">
										{session.animated
											? `${session.warnings.length} ${session.warnings.length === 1 ? "note" : "notes"} from Guide Studio's checks`
											: `Guide Studio corrected ${session.warnings.length} ${session.warnings.length === 1 ? "thing" : "things"} in the agent's plan`}
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

							{session?.craftWarnings && session.craftWarnings.length > 0 && (
								<details className="rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-3.5 py-2.5">
									<summary className="cursor-pointer text-[11px] font-medium text-sky-200/90">
										Story and pacing notes · review before approval
									</summary>
									<ul className="mt-2 space-y-1">
										{session.craftWarnings.map((warning) => (
											<li key={warning} className="text-[11px] leading-relaxed text-sky-200/65">
												{warning}
											</li>
										))}
									</ul>
								</details>
							)}

							<div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-3.5">
								<div className="flex items-start gap-2.5">
									<AudioLines size={15} className="mt-0.5 flex-shrink-0 text-violet-300" />
									<div className="min-w-0 flex-1">
										<h3 className="text-[12px] font-semibold text-white/90">
											Production finishing
										</h3>
										<p className="mt-0.5 text-[11px] leading-relaxed text-white/45">
											{session?.animated
												? "Optional: one narration paragraph per scene becomes voiceover, mixed over the animated cut's own effects and music (which are kept). Captions are not burned into animated cuts."
												: "Optional but recommended for a launch cut: one narration paragraph per shot becomes voiceover. Captions are limited to text/card beats and never cover supplied imagery, product footage, or the logo. Music is ducked under dialogue."}
										</p>
									</div>
									{session?.finishing ? (
										<span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] uppercase text-emerald-300">
											ready
										</span>
									) : null}
								</div>
								<div className="mt-3 flex flex-col gap-2.5">
									<textarea
										value={narrationScript}
										onChange={(event) => setNarrationScript(event.target.value)}
										rows={5}
										placeholder={`One paragraph per shot (${scenes.length} shots). Example:\n\nYour customer just signed up.\n\nThey should not need another training call.`}
										className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] leading-relaxed text-white placeholder:text-white/25 focus:border-violet-300/50 focus:outline-none"
									/>
									<div className="flex flex-wrap items-center gap-2">
										<label className="flex items-center gap-1.5 text-[10px] text-white/45">
											<span>Voice</span>
											<select
												value={voiceId}
												onChange={(event) => setVoiceId(event.target.value)}
												className="rounded border border-white/10 bg-[#211d1c] px-2 py-1 text-[10px] text-white/75 outline-none"
											>
												{VOICE_OPTIONS.map((voice) => (
													<option key={voice.id} value={voice.id}>
														{voice.name}
													</option>
												))}
											</select>
										</label>
										<button
											type="button"
											onClick={() => void handleChooseVoiceover()}
											className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/5"
										>
											<AudioLines size={11} />
											{voiceoverPath ? "Voiceover selected" : "Use voiceover file"}
										</button>
										<button
											type="button"
											onClick={() => void handleChooseMusic()}
											className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/5"
										>
											<Music2 size={11} />
											{musicPath ? "Music selected" : "Choose music"}
										</button>
										<button
											type="button"
											onClick={() => void handleChooseSfx()}
											className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/5"
										>
											<AudioLines size={11} />
											{sfxPath ? "SFX selected" : "Choose SFX"}
										</button>
										{sfxPath ? (
											<label className="flex items-center gap-1.5 text-[10px] text-white/45">
												<span>SFX at</span>
												<input
													type="number"
													min={0}
													step={0.1}
													value={sfxOffsetSec}
													onChange={(event) => setSfxOffsetSec(Number(event.target.value) || 0)}
													className="w-14 rounded border border-white/10 bg-[#211d1c] px-1.5 py-1 text-[10px] text-white/75 outline-none"
												/>
												<span>s</span>
											</label>
										) : null}
										<label className="flex items-center gap-1.5 text-[10px] text-white/45">
											<span>Music {musicVolume}%</span>
											<input
												type="range"
												min={0}
												max={40}
												value={musicVolume}
												onChange={(event) => setMusicVolume(Number(event.target.value))}
												className="w-20 accent-violet-400"
											/>
										</label>
									</div>
									<button
										type="button"
										onClick={() => void handleGenerateFinishing()}
										disabled={finishingBusy || busy !== null}
										className="flex items-center justify-center gap-2 self-start rounded-lg bg-violet-500/80 px-3 py-2 text-[11px] font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
									>
										{finishingBusy ? (
											<Loader2 size={12} className="animate-spin" />
										) : (
											<Captions size={12} />
										)}
										{finishingBusy ? "Preparing voiceover…" : "Apply voiceover + captions"}
									</button>
								</div>
							</div>

							{session?.animated && (
								<AnimatedScenesPanel
									animated={session.animated}
									{...(session.previewPaths ? { previewPaths: session.previewPaths } : {})}
									disabled={busy !== null}
									working={workingOn}
									onSetValues={handleAnimatedSetValues}
									onRevise={handleAnimatedRevise}
								/>
							)}

							{!session?.animated && session?.previewPaths && session.previewPaths.length > 0 && (
								<div className="flex flex-col gap-2.5">
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
									<button
										type="button"
										onClick={() => void handleClearSavedMedia()}
										disabled={busy !== null}
										className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[10px] text-white/35 transition-colors hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
									>
										<Trash2 size={11} />
										{busy === "clearing" ? "Clearing…" : "Clear saved preview"}
									</button>
								</div>
							)}

							{session?.assets && session.assets.length > 0 && (
								<ImageCredits assets={session.assets} />
							)}

							<div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5">
								<div className="flex flex-wrap items-baseline justify-between gap-2">
									<div>
										<h3 className="text-[12px] font-semibold text-white/90">Shot review</h3>
										<p className="mt-0.5 text-[11px] text-white/40">
											Approve every shot and tune its rhythm before the MP4 is rendered.
										</p>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-[11px] tabular-nums text-white/45">
											{approvedCount}/{scenes.length} approved
										</span>
										<button
											type="button"
											onClick={() => void handleApproveAll()}
											disabled={busy !== null || allShotsApproved}
											className="flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-400/20 disabled:opacity-40"
										>
											<CheckCheck size={11} />
											{busy === "reviewing"
												? "Approving…"
												: allShotsApproved
													? "All approved"
													: "Approve all"}
										</button>
										<button
											type="button"
											onClick={() => void handleRefreshPreview()}
											disabled={busy !== null}
											className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/80 disabled:opacity-40"
										>
											<RefreshCw size={11} />
											Refresh previews
										</button>
									</div>
								</div>
								<div className="mt-3 flex flex-col gap-2">
									{scenes.map((frame, index) => {
										const review = session?.shotReviews?.[index];
										const still = session?.previewPaths?.find(
											(candidate) => candidate.frameIndex === index,
										);
										const status = review?.status ?? "pending";
										const draftDuration =
											durationDrafts[index] ??
											String(review?.durationSeconds ?? frame.durationSeconds);
										return (
											<div
												key={`review-${frame.id || index}`}
												className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-black/10 px-2.5 py-2"
											>
												{still ? (
													<img
														src={toFileUrl(still.path)}
														alt={`Preview of shot ${index + 1}`}
														className="h-12 w-20 flex-shrink-0 rounded-md border border-white/10 bg-black/40 object-cover"
													/>
												) : (
													<div className="flex h-12 w-20 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-white/10 text-[9px] text-white/25">
														No preview
													</div>
												)}
												<span className="w-5 text-[10px] tabular-nums text-white/30">
													{index + 1}
												</span>
												<span
													className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
														status === "approved"
															? "bg-emerald-400/15 text-emerald-300"
															: status === "rejected"
																? "bg-rose-400/15 text-rose-300"
																: "bg-white/[0.08] text-white/45"
													}`}
												>
													{status === "rejected" ? "needs changes" : status}
												</span>
												<div className="min-w-[180px] flex-1">
													<p className="truncate text-[11px] text-white/85">
														{frame.logoAssetId
															? "Logo reveal"
															: frame.text || frame.headline || "Untitled shot"}
													</p>
													<p className="truncate text-[10px] text-white/35">
														{frame.textScene || frame.backdrop || frame.kind}
													</p>
												</div>
												{/* An animated scene is retimed by asking for a change. */}
												{session?.animated ? (
													<span className="text-[10px] tabular-nums text-white/40">
														{frame.durationSeconds}s
													</span>
												) : (
													<label className="flex items-center gap-1 text-[10px] text-white/40">
														<span className="sr-only">Shot {index + 1} duration in seconds</span>
														<input
															type="number"
															min={1.5}
															max={session?.motion ? 12 : 20}
															step={0.1}
															value={draftDuration}
															onChange={(event) =>
																setDurationDrafts((current) => ({
																	...current,
																	[index]: event.target.value,
																}))
															}
															className="w-16 rounded border border-white/10 bg-white/[0.05] px-1.5 py-1 text-right text-[10px] text-white/80 outline-none focus:border-[#6E6BFF]"
														/>
														<span>s</span>
													</label>
												)}
												<button
													type="button"
													onClick={() => void handleShotReview(index, "approved")}
													disabled={busy !== null}
													className="rounded-md bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-400/20 disabled:opacity-40"
												>
													{status === "approved" ? "Save" : "Approve"}
												</button>
												<button
													type="button"
													onClick={() => void handleShotReview(index, "rejected")}
													disabled={busy !== null}
													className="rounded-md px-2 py-1 text-[10px] text-rose-300/80 transition-colors hover:bg-rose-400/10 disabled:opacity-40"
												>
													Needs changes
												</button>
											</div>
										);
									})}
								</div>
							</div>

							{!session?.animated && (
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
							)}

							{session?.videoPath ? (
								<div className="flex flex-col gap-3">
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
											disabled={!allShotsApproved || busy !== null}
											className="rounded-xl border border-white/10 px-3.5 py-2.5 text-[12px] text-white/70 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
										>
											Re-render
										</button>
										<button
											type="button"
											onClick={() => void handleClearSavedMedia()}
											disabled={busy !== null}
											className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2.5 text-[12px] text-white/50 transition-colors hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
										>
											<Trash2 size={13} />
											Clear saved output
										</button>
										<button
											type="button"
											onClick={() => void handleCreateMaster()}
											disabled={masterBusy}
											className="rounded-xl border border-cyan-400/20 px-3.5 py-2.5 text-[12px] text-cyan-200/75 transition-colors hover:bg-cyan-400/10 disabled:opacity-40"
										>
											{masterBusy
												? "Creating ProRes…"
												: session.masterPath
													? "ProRes master ready"
													: "Create ProRes master"}
										</button>
										<button
											type="button"
											onClick={() => void handleCreateInterchange()}
											disabled={interchangeBusy}
											className="rounded-xl border border-emerald-400/20 px-3.5 py-2.5 text-[12px] text-emerald-200/75 transition-colors hover:bg-emerald-400/10 disabled:opacity-40"
										>
											{interchangeBusy
												? "Preparing edit package…"
												: session.interchange
													? "Edit package ready"
													: "Export edit package"}
										</button>
									</div>
									{session.masterPath ? (
										<p className="text-[10px] text-cyan-200/50">
											Edit-friendly ProRes 422 HQ master created.
										</p>
									) : null}
									{session.interchange ? (
										<p className="text-[10px] text-emerald-200/50">
											JSON scene manifest and FCPXML markers created beside the render.
										</p>
									) : null}
								</div>
							) : (
								<button
									type="button"
									onClick={handleRender}
									disabled={busy !== null || !allShotsApproved}
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
											{allShotsApproved ? "Render this video" : "Approve all shots to render"}
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

function measureAudioDurationMs(audioPath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const audio = new Audio();
		audio.preload = "metadata";
		audio.onloadedmetadata = () => {
			const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
			URL.revokeObjectURL(audio.src);
			if (duration <= 0) reject(new Error("The generated voiceover has no readable duration."));
			else resolve(Math.round(duration * 1000));
		};
		audio.onerror = () => {
			URL.revokeObjectURL(audio.src);
			reject(new Error("The generated voiceover could not be read."));
		};
		audio.src = toFileUrl(audioPath);
	});
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
