// ── Claude Code detection ────────────────────────────────────────────────
//
// The AI Video Creator drives the user's own Claude Code install — their
// binary, their login, their subscription. Guide Studio never ships or
// proxies a model, so the first thing the feature has to answer is "is
// Claude on this machine, and can we run it?".
//
// Finding the binary is the awkward part. A GUI app launched from Finder or
// the Dock inherits a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that
// contains none of the places Claude actually installs to, so `which claude`
// from inside Electron finds nothing even when the user's terminal finds it
// immediately. We therefore search the known install locations directly and
// only fall back to PATH lookup.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Where Claude Code lands across the supported install routes. */
export function candidateBinaryPaths(platform: NodeJS.Platform, home: string): string[] {
	if (platform === "win32") {
		const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
		const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
		return [
			path.join(localAppData, "Programs", "claude", "claude.exe"),
			path.join(appData, "npm", "claude.cmd"),
			path.join(home, ".local", "bin", "claude.exe"),
			path.join(home, ".claude", "local", "claude.exe"),
		];
	}

	return [
		// The official installer's location, and the one `claude migrate-installer` moves to.
		path.join(home, ".local", "bin", "claude"),
		path.join(home, ".claude", "local", "claude"),
		// Global npm installs, Intel and Apple-silicon Homebrew prefixes.
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
		path.join(home, ".volta", "bin", "claude"),
		path.join(home, ".bun", "bin", "claude"),
		"/usr/bin/claude",
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
	];
	const seen = new Set(currentPath.split(path.delimiter).filter(Boolean));
	for (const entry of extra) if (!seen.has(entry)) seen.add(entry);
	return [...seen].join(path.delimiter);
}

/**
 * `claude --version` prints e.g. "1.0.65 (Claude Code)". Only the leading
 * semver is meaningful to us.
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

export interface ClaudeInstallation {
	installed: boolean;
	/** Absolute path to the binary we would run. */
	binaryPath?: string;
	version?: string;
	/** True when this install loads skills from `.claude/skills/`. */
	supportsFileSkills: boolean;
	/** Populated when the binary is present but wouldn't run. */
	error?: string;
}

/**
 * Locate Claude Code and confirm it runs. Detection is deliberately cheap —
 * a `--version` call, no session, no auth prompt — so the creator window can
 * re-check whenever it opens.
 */
export async function detectClaude(): Promise<ClaudeInstallation> {
	const home = os.homedir();
	const platform = process.platform;
	const searchPath = augmentedPathEnv(platform, home, process.env.PATH);

	const candidates = candidateBinaryPaths(platform, home).filter((candidate) => {
		try {
			return fs.statSync(candidate).isFile();
		} catch {
			return false;
		}
	});

	// PATH lookup last: an explicit install location is a better answer than
	// whatever a shim resolves to, but a custom install still has to work.
	candidates.push(platform === "win32" ? "claude.cmd" : "claude");

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
				installed: true,
				binaryPath,
				version,
				supportsFileSkills: meetsMinimum(version, SKILLS_MINIMUM_VERSION),
			};
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
	}

	return {
		installed: false,
		supportsFileSkills: false,
		...(lastError ? { error: lastError } : {}),
	};
}
