// ── Agent CLI detection ──────────────────────────────────────────────────
//
// The AI Video Creator drives a coding CLI the user already owns — their
// binary, their login, their subscription. Guide Studio never ships or
// proxies a model, so the first thing the feature has to answer is "is this
// agent on the machine, and can we run it?".
//
// Finding the binary is the awkward part. A GUI app launched from Finder or
// the Dock inherits a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that
// contains none of the places these CLIs actually install to, so `which
// claude` from inside Electron finds nothing even when the user's terminal
// finds it immediately. We therefore search the known install locations
// directly and only fall back to PATH lookup.
//
// Claude Code and Codex install through the same routes — the official
// installer, global npm, Homebrew, Volta, Bun — so one candidate list
// parameterised by binary name covers both.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type AgentId, agentLabel } from "./agents";

const execFileAsync = promisify(execFile);

/** The executable name each agent installs under, minus any extension. */
const BINARY_NAME: Record<AgentId, string> = { claude: "claude", codex: "codex" };

/**
 * Where an agent's CLI lands across the supported install routes.
 *
 * The agent argument defaults to Claude so the original two-argument call
 * sites keep working unchanged.
 */
export function candidateBinaryPaths(
	platform: NodeJS.Platform,
	home: string,
	agent: AgentId = "claude",
): string[] {
	const name = BINARY_NAME[agent];
	// Both CLIs keep a private install root named after themselves.
	const privateRoot =
		agent === "claude" ? path.join(home, ".claude", "local") : path.join(home, ".codex", "bin");

	if (platform === "win32") {
		const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
		const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
		return [
			path.join(localAppData, "Programs", name, `${name}.exe`),
			path.join(appData, "npm", `${name}.cmd`),
			path.join(home, ".local", "bin", `${name}.exe`),
			path.join(privateRoot, `${name}.exe`),
		];
	}

	return [
		// The official installer's location, and the one `claude migrate-installer` moves to.
		path.join(home, ".local", "bin", name),
		path.join(privateRoot, name),
		// Global npm installs, Intel and Apple-silicon Homebrew prefixes.
		`/usr/local/bin/${name}`,
		`/opt/homebrew/bin/${name}`,
		path.join(home, ".volta", "bin", name),
		path.join(home, ".bun", "bin", name),
		`/usr/bin/${name}`,
	];
}

/** PATH entries a GUI-launched app is missing but a login shell would have. */
export function augmentedPathEnv(
	platform: NodeJS.Platform,
	home: string,
	currentPath = "",
): string {
	if (platform === "win32") return currentPath;
	const extra = [
		path.join(home, ".local", "bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
		path.join(home, ".volta", "bin"),
		path.join(home, ".bun", "bin"),
		path.join(home, ".codex", "bin"),
	];
	const seen = new Set(currentPath.split(path.delimiter).filter(Boolean));
	for (const entry of extra) if (!seen.has(entry)) seen.add(entry);
	return [...seen].join(path.delimiter);
}

/**
 * `claude --version` prints e.g. "1.0.65 (Claude Code)" and `codex --version`
 * prints "codex-cli 0.153.4". Only the semver in there is meaningful to us.
 */
export function parseVersion(output: string): string | undefined {
	const match = /(\d+\.\d+\.\d+)/.exec(output);
	return match?.[1];
}

/** Compare two semver-ish strings. Returns true when `version` >= `minimum`. */
export function meetsMinimum(version: string | undefined, minimum: string): boolean {
	if (!version) return false;
	const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const [major, minor, patch] = parse(version);
	const [minMajor, minMinor, minPatch] = parse(minimum);
	if (major !== minMajor) return major > minMajor;
	if (minor !== minMinor) return minor > minMinor;
	return patch >= minPatch;
}

/**
 * Claude Code gained filesystem Agent Skills (`.claude/skills/<name>/SKILL.md`)
 * after this release. Below it we still work — the skill pack is inlined into
 * the prompt instead — so this only decides *how* skills are delivered, never
 * whether the feature runs.
 */
export const SKILLS_MINIMUM_VERSION = "2.0.0";

// Older Codex CLIs can inherit a modern model from ~/.codex/config.toml and
// then fail with a misleading 400. Keep them out of the creator preflight.
export const CODEX_CREATOR_MINIMUM_VERSION = "0.100.0";

export interface AgentInstallation {
	agent: AgentId;
	installed: boolean;
	/** Absolute path to the binary we would run. */
	binaryPath?: string;
	version?: string;
	/**
	 * True when this install loads skills from `.claude/skills/`. Claude Code
	 * only; Codex reads the brief and the skill files directly instead.
	 */
	supportsFileSkills: boolean;
	/** Populated when the binary is present but wouldn't run. */
	error?: string;
}

/**
 * Locate an agent's CLI and confirm it runs. Detection is deliberately cheap —
 * a `--version` call, no session, no auth prompt — so the creator window can
 * re-check whenever it opens.
 */
export async function detectAgent(agent: AgentId): Promise<AgentInstallation> {
	const home = os.homedir();
	const platform = process.platform;
	const searchPath = augmentedPathEnv(platform, home, process.env.PATH);
	const name = BINARY_NAME[agent];

	const candidates = candidateBinaryPaths(platform, home, agent).filter((candidate) => {
		try {
			return fs.statSync(candidate).isFile();
		} catch {
			return false;
		}
	});

	// PATH lookup last: an explicit install location is a better answer than
	// whatever a shim resolves to, but a custom install still has to work.
	candidates.push(platform === "win32" ? `${name}.cmd` : name);

	let lastError: string | undefined;
	for (const binaryPath of candidates) {
		try {
			const { stdout } = await execFileAsync(binaryPath, ["--version"], {
				env: { ...process.env, PATH: searchPath },
				timeout: 15_000,
				windowsHide: true,
			});
			const version = parseVersion(stdout);
			return {
				agent,
				installed: true,
				binaryPath,
				version,
				supportsFileSkills: agent === "claude" && meetsMinimum(version, SKILLS_MINIMUM_VERSION),
				...(agent === "codex" && !meetsMinimum(version, CODEX_CREATOR_MINIMUM_VERSION)
					? {
							error: `Codex ${version ?? ""} is too old for current ChatGPT models. Update it with \`npm install -g @openai/codex\`.`,
						}
					: {}),
			};
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
	}

	return {
		agent,
		installed: false,
		supportsFileSkills: false,
		...(lastError ? { error: lastError } : {}),
	};
}

/**
 * Detect every supported agent at once, so the creator window can offer the
 * ones that are ready and explain how to get the others.
 */
export async function detectAgents(): Promise<Record<AgentId, AgentInstallation>> {
	const [claude, codex] = await Promise.all([detectAgent("claude"), detectAgent("codex")]);
	return { claude, codex };
}

/** "Claude Code was not found…" — the message shown when a run cannot start. */
export function notInstalledMessage(agent: AgentId): string {
	return `${agentLabel(agent)} was not found on this machine. Install it, sign in, then try again.`;
}
