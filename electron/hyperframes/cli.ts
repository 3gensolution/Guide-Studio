// ── HyperFrames CLI host ─────────────────────────────────────────────────
//
// Guide Studio runs the pinned `hyperframes` CLI itself — never `npx`, which
// would resolve whatever version the network serves today. It runs on
// Electron's own Node (`ELECTRON_RUN_AS_NODE`), so users need no Node install.
//
// Every invocation is local-only: telemetry, update checks and on-demand
// package installs are switched off here, in one place, because the CLI
// defaults all three on and Guide Studio promises the user it phones nobody.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { augmentedPathEnv } from "../claude-runtime/detect";
import { getFfmpegEnv, getProductionFfmpegPath } from "../ffmpeg";

/** Pinned with vendor/hyperframes/UPSTREAM.json — the skills describe this CLI. */
export const HYPERFRAMES_VERSION = "0.8.186";

/** Subcommands an agent may run through the session's `hf` wrapper. */
export const AGENT_SUBCOMMANDS = [
	"check",
	"lint",
	"validate",
	"snapshot",
	"timeline",
	"inspect",
	"keyframes",
	"audio",
	"docs",
	"info",
	"compositions",
] as const;

/**
 * Packaged builds ship a self-contained production install (see
 * scripts/bundle-hyperframes.mjs) as an extra resource, because the CLI's
 * ESM dependency graph cannot be loaded from inside app.asar.
 */
export function hyperframesCliPath(): string {
	const base = app.isPackaged
		? path.join(process.resourcesPath, "hyperframes", "node_modules")
		: path.join(app.getAppPath(), "node_modules");
	return path.join(base, "hyperframes", "bin", "hyperframes.mjs");
}

/** Root of the vendored HyperFrames agent skills (vendor/hyperframes). */
export function hyperframesVendorDir(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, "hyperframes-vendor")
		: path.join(app.getAppPath(), "vendor", "hyperframes");
}

/** GSAP served from the project folder, so compositions never reach a CDN. */
export function gsapBrowserBuildPath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, "hyperframes-vendor", "gsap.min.js")
		: path.join(app.getAppPath(), "node_modules", "gsap", "dist", "gsap.min.js");
}

/** The environment flags that keep the CLI from reaching the network on its own. */
export const OFFLINE_FLAGS: Readonly<Record<string, string>> = {
	DO_NOT_TRACK: "1",
	HYPERFRAMES_NO_TELEMETRY: "1",
	HYPERFRAMES_NO_UPDATE_CHECK: "1",
	HYPERFRAMES_NO_AUTO_INSTALL: "1",
	HYPERFRAMES_NO_OPTIONAL_INSTALL: "1",
	HYPERFRAMES_NO_CAPTURE_DOTENV: "1",
	HYPERFRAMES_SKIP_SKILLS: "1",
};

/**
 * The CLI's environment: Electron as Node, the offline flags, and a PATH that
 * finds ffmpeg/ffprobe even from a GUI launch where the shell PATH is absent.
 */
export async function hyperframesEnv(): Promise<NodeJS.ProcessEnv> {
	const ffmpegPath = await getProductionFfmpegPath();
	const env: NodeJS.ProcessEnv = ffmpegPath ? getFfmpegEnv(ffmpegPath) : { ...process.env };
	const widened = augmentedPathEnv(process.platform, app.getPath("home"), env.PATH);
	env.PATH = ffmpegPath ? `${path.dirname(ffmpegPath)}${path.delimiter}${widened}` : widened;
	env.ELECTRON_RUN_AS_NODE = "1";
	Object.assign(env, OFFLINE_FLAGS);
	return env;
}

export interface HyperframesRunOptions {
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Parsed `@hf-progress` lines the CLI prints during long commands. */
	onProgress?: (progress: { code: string; pct: number }) => void;
}

export interface HyperframesRunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	cancelled: boolean;
	timedOut: boolean;
}

const OUTPUT_CAP = 4 * 1024 * 1024;

/** Parse one `@hf-progress {...}` line, or undefined for any other line. */
export function parseProgressLine(line: string): { code: string; pct: number } | undefined {
	const marker = line.indexOf("@hf-progress ");
	if (marker < 0) return undefined;
	try {
		const parsed = JSON.parse(line.slice(marker + "@hf-progress ".length)) as {
			code?: unknown;
			pct?: unknown;
		};
		if (typeof parsed.code !== "string" || typeof parsed.pct !== "number") return undefined;
		return { code: parsed.code, pct: Math.max(0, Math.min(100, parsed.pct)) };
	} catch {
		return undefined;
	}
}

export async function runHyperframes(
	args: string[],
	options: HyperframesRunOptions,
): Promise<HyperframesRunResult> {
	const cliPath = hyperframesCliPath();
	if (!fs.existsSync(cliPath)) {
		throw new Error(
			`The HyperFrames renderer is missing (${cliPath}). Reinstall Guide Studio or run npm install.`,
		);
	}
	const env = await hyperframesEnv();
	return await new Promise<HyperframesRunResult>((resolve) => {
		const child = spawn(process.execPath, [cliPath, ...args], {
			cwd: options.cwd,
			env,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let lineBuffer = "";
		let cancelled = false;
		let timedOut = false;
		let settled = false;

		const stop = () => {
			child.kill("SIGTERM");
			setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, 3_000).unref?.();
		};
		const timer = options.timeoutMs
			? setTimeout(() => {
					timedOut = true;
					stop();
				}, options.timeoutMs)
			: undefined;
		const onAbort = () => {
			cancelled = true;
			stop();
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		const scanProgress = (chunk: string) => {
			if (!options.onProgress) return;
			lineBuffer += chunk;
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const progress = parseProgressLine(line);
				if (progress) options.onProgress(progress);
			}
		};

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (stdout.length < OUTPUT_CAP) stdout += chunk;
			scanProgress(chunk);
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-OUTPUT_CAP);
			scanProgress(chunk);
		});

		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve({ code, stdout, stderr, cancelled, timedOut });
		};
		child.on("error", (error) => {
			stderr += `\n${error.message}`;
			finish(null);
		});
		child.on("close", (code) => finish(code));
	});
}

/** The CLI prints human text around its `--json` envelope; take the JSON. */
export function extractJsonEnvelope(stdout: string): unknown {
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(stdout.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

/**
 * Make sure the headless Chrome HyperFrames captures with is present. The
 * first call on a machine downloads it (~100 MB) into Puppeteer's cache;
 * after that it is a fast lookup.
 */
export async function ensureHyperframesBrowser(cwd: string, signal?: AbortSignal): Promise<void> {
	const result = await runHyperframes(["browser", "ensure"], {
		cwd,
		timeoutMs: 15 * 60 * 1000,
		...(signal ? { signal } : {}),
	});
	if (result.cancelled) throw new Error("Cancelled.");
	if (result.code !== 0) {
		throw new Error(
			`Could not prepare the HyperFrames renderer's browser: ${(result.stderr || result.stdout).trim().slice(-400)}`,
		);
	}
}
