// ── Gate, summarize, snapshot, render ────────────────────────────────────
//
// The four things Guide Studio does to an agent-built HyperFrames project.
// The gate runs after every agent turn and every user edit: audio requests
// are filled first (so referenced files exist), then the safety scan, then
// HyperFrames' own `check`. Only a project that passes all three is ever
// snapshotted or rendered.

import fs from "node:fs";
import path from "node:path";
import { generateElevenLabsMusic } from "../ai/elevenLabsMusicService";
import { generateSfx } from "../ai/elevenLabsSfxService";
import { loadSettings } from "../settings";
import { type AudioGenerators, resolveAudioRequests } from "./audio";
import { extractJsonEnvelope, runHyperframes } from "./cli";
import { scanCompositionSafety } from "./safety";
import { type AnimatedProjectSummary, summarizeProject } from "./scenes";

const CHECK_TIMEOUT_MS = 6 * 60 * 1000;

export interface GateResult {
	ok: boolean;
	/** Blocking problems, phrased for the agent's repair turn. */
	problems: string[];
	/** Non-blocking findings worth showing the user. */
	warnings: string[];
	/** What Guide Studio filled in for the agent (generated or library audio). */
	notes: string[];
}

interface CheckFinding {
	code?: unknown;
	severity?: unknown;
	message?: unknown;
	file?: unknown;
	sourceFile?: unknown;
	fixHint?: unknown;
}

/** Pull error and warning lines out of a `check --json` envelope. */
export function readCheckEnvelope(envelope: unknown): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!envelope || typeof envelope !== "object") {
		return { errors: ["HyperFrames check produced no readable result."], warnings };
	}
	for (const section of Object.values(envelope as Record<string, unknown>)) {
		if (!section || typeof section !== "object" || Array.isArray(section)) continue;
		const findings = (section as { findings?: unknown }).findings;
		if (!Array.isArray(findings)) continue;
		for (const raw of findings as CheckFinding[]) {
			if (!raw || typeof raw !== "object") continue;
			const file =
				typeof raw.file === "string"
					? raw.file
					: typeof raw.sourceFile === "string"
						? raw.sourceFile
						: "";
			const where = file ? `${path.basename(file)}: ` : "";
			const hint = typeof raw.fixHint === "string" ? ` Fix: ${raw.fixHint}` : "";
			const line = `${where}${String(raw.message ?? raw.code ?? "unknown finding")}${hint}`;
			if (raw.severity === "error") errors.push(line);
			else if (raw.severity === "warning") warnings.push(line);
		}
	}
	return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/** ElevenLabs when the user has a key; otherwise nothing, and the library is used. */
export async function audioGenerators(): Promise<AudioGenerators> {
	const settings = await loadSettings();
	if (!settings.aiApiKey_elevenlabs) return {};
	return {
		sfx: async (prompt, durationSeconds) => {
			const result = await generateSfx(prompt, {
				...(durationSeconds ? { durationSec: durationSeconds } : {}),
			});
			return result.success ? result.filePath : undefined;
		},
		music: async (prompt, durationSeconds) => {
			const result = await generateElevenLabsMusic(prompt, {
				durationSec: durationSeconds,
				forceInstrumental: true,
			});
			return result.success ? result.audioPath : undefined;
		},
	};
}

export async function canGenerateAudio(): Promise<boolean> {
	return Boolean((await loadSettings()).aiApiKey_elevenlabs);
}

export async function runGate(root: string, signal?: AbortSignal): Promise<GateResult> {
	const audio = await resolveAudioRequests(root, await audioGenerators());
	const safety = scanCompositionSafety(root);
	if (safety.length) {
		return {
			ok: false,
			problems: safety.map((finding) => `${finding.file}: ${finding.message}`),
			warnings: audio.warnings,
			notes: audio.notes,
		};
	}
	const result = await runHyperframes(["check", "--json"], {
		cwd: root,
		timeoutMs: CHECK_TIMEOUT_MS,
		...(signal ? { signal } : {}),
	});
	if (result.cancelled) throw new Error("Cancelled.");
	const envelope = extractJsonEnvelope(result.stdout);
	const { errors, warnings } = readCheckEnvelope(envelope);
	const ok =
		errors.length === 0 &&
		Boolean(envelope && typeof envelope === "object" && (envelope as { ok?: unknown }).ok === true);
	if (!ok && errors.length === 0) {
		errors.push(
			result.timedOut
				? "HyperFrames check timed out."
				: `HyperFrames check failed: ${(result.stderr || result.stdout).trim().slice(-400)}`,
		);
	}
	return {
		ok,
		problems: errors,
		warnings: [...audio.warnings, ...warnings.slice(0, 12)],
		notes: audio.notes,
	};
}

export async function summarizeAnimatedProject(
	root: string,
	signal?: AbortSignal,
): Promise<AnimatedProjectSummary> {
	const result = await runHyperframes(["timeline", "--json"], {
		cwd: root,
		timeoutMs: 60_000,
		...(signal ? { signal } : {}),
	});
	const envelope = extractJsonEnvelope(result.stdout);
	if (result.code !== 0 || !envelope) {
		throw new Error(
			`Could not read the video's timeline: ${(result.stderr || result.stdout).trim().slice(-300)}`,
		);
	}
	return summarizeProject(root, envelope);
}

/**
 * One still per scene, taken a little past its middle where the entrance has
 * landed. Returns paths in scene order; a scene whose still failed is "".
 */
export async function snapshotScenes(
	root: string,
	summary: AnimatedProjectSummary,
	outputDirectory: string,
	signal?: AbortSignal,
): Promise<string[]> {
	if (!summary.scenes.length) return [];
	const times = summary.scenes.map(
		(scene) => Math.round((scene.startSeconds + scene.durationSeconds * 0.6) * 100) / 100,
	);
	fs.rmSync(outputDirectory, { recursive: true, force: true });
	fs.mkdirSync(outputDirectory, { recursive: true });
	const result = await runHyperframes(
		["snapshot", "--at", times.join(","), "--no-end", "--output", outputDirectory, "--json"],
		{ cwd: root, timeoutMs: 5 * 60 * 1000, ...(signal ? { signal } : {}) },
	);
	if (result.cancelled) throw new Error("Cancelled.");
	const envelope = extractJsonEnvelope(result.stdout) as
		| { frames?: Array<{ path?: unknown; time?: unknown }> }
		| undefined;
	const frames = Array.isArray(envelope?.frames) ? envelope.frames : [];
	return times.map((time) => {
		const frame = frames.find(
			(candidate) => typeof candidate.time === "number" && Math.abs(candidate.time - time) < 0.02,
		);
		return typeof frame?.path === "string" && fs.existsSync(frame.path) ? frame.path : "";
	});
}

export async function renderAnimatedProject(options: {
	root: string;
	outputPath: string;
	signal?: AbortSignal;
	onProgress?: (percent: number) => void;
}): Promise<void> {
	fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
	const result = await runHyperframes(
		["render", "--output", options.outputPath, "--fps", "30", "--quality", "delivery", "--strict"],
		{
			cwd: options.root,
			timeoutMs: 60 * 60 * 1000,
			...(options.signal ? { signal: options.signal } : {}),
			...(options.onProgress
				? { onProgress: (progress) => options.onProgress?.(Math.round(progress.pct)) }
				: {}),
		},
	);
	if (result.cancelled) throw new Error("Cancelled.");
	if (result.code !== 0 || !fs.existsSync(options.outputPath)) {
		throw new Error(
			result.timedOut
				? "The render did not finish within an hour."
				: `The render failed: ${(result.stderr || result.stdout).trim().slice(-600)}`,
		);
	}
}
