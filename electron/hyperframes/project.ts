// ── Session project scaffold ─────────────────────────────────────────────
//
// For the Animated look the session workspace IS a HyperFrames project: the
// agent writes index.html and compositions/*.html next to the staged media
// in assets/, and Guide Studio checks and renders that same folder. This file
// lays down everything the agent starts from:
//
//   .claude/skills/<skill>/        HyperFrames' own authoring skills (vendored)
//   assets/vendor/gsap.min.js      GSAP, local — compositions never use a CDN
//   assets/sfx/*.mp3               the bundled sound-effect library
//   assets/<assetId>.<ext>         the user's staged media (written by staging)
//   index.html                     a starter root at the right canvas size
//   hyperframes.json, meta.json    project metadata the CLI expects
//   hf, hf.cmd                     the only CLI entry point the agent may run

import fs from "node:fs";
import path from "node:path";
import {
	AGENT_SUBCOMMANDS,
	gsapBrowserBuildPath,
	hyperframesCliPath,
	hyperframesVendorDir,
	OFFLINE_FLAGS,
} from "./cli";

export type AnimatedFormat = "landscape" | "vertical" | "square";

export const VENDORED_SKILLS = ["hyperframes", "hyperframes-cli", "media-use"] as const;

export function canvasSize(format: AnimatedFormat): { width: number; height: number } {
	return format === "vertical"
		? { width: 1080, height: 1920 }
		: format === "square"
			? { width: 1080, height: 1080 }
			: { width: 1920, height: 1080 };
}

export interface SfxLibraryEntry {
	id: string;
	file: string;
	durationSeconds: number;
	description: string;
}

/** The bundled effects, read from the vendored media-use manifest. */
export function readSfxLibrary(vendorDir = hyperframesVendorDir()): SfxLibraryEntry[] {
	const directory = path.join(vendorDir, "skills", "media-use", "audio", "assets", "sfx");
	let manifest: unknown;
	try {
		manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
	} catch {
		return [];
	}
	if (!manifest || typeof manifest !== "object") return [];
	const entries: SfxLibraryEntry[] = [];
	for (const [id, value] of Object.entries(manifest as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const record = value as Record<string, unknown>;
		const file = typeof record.file === "string" ? record.file : "";
		if (!/^[a-z0-9-]+\.mp3$/i.test(file) || !fs.existsSync(path.join(directory, file))) continue;
		entries.push({
			id,
			file,
			durationSeconds: typeof record.duration === "number" ? record.duration : 0,
			description: typeof record.description === "string" ? record.description : "",
		});
	}
	return entries;
}

export function sfxLibraryDir(vendorDir = hyperframesVendorDir()): string {
	return path.join(vendorDir, "skills", "media-use", "audio", "assets", "sfx");
}

/** A starter root: the right canvas, local GSAP, no scenes yet. */
export function starterIndexHtml(format: AnimatedFormat, durationSeconds: number): string {
	const { width, height } = canvasSize(format);
	return `<!doctype html>
<html lang="en" data-resolution="${format === "vertical" ? "portrait" : format}"
  data-composition-variables='[]'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #0b0d14; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${durationSeconds}" data-width="${width}" data-height="${height}">
      <!-- Mount one scene per file in compositions/ here. -->
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The agent's CLI. A fixed subcommand allowlist (inspection only — no
 * render, publish, cloud, capture or registry installs, all of which either
 * reach the network or are Guide Studio's job) and the offline flags baked in.
 */
export function hfWrapperScript(execPath: string, cliPath: string): string {
	const allowed = AGENT_SUBCOMMANDS.join("|");
	const flags = Object.entries(OFFLINE_FLAGS)
		.map(([key, value]) => `${key}=${value}`)
		.join(" ");
	return `#!/bin/sh
# Guide Studio's HyperFrames CLI for this session (hyperframes, pinned).
# Inspection commands only; Guide Studio renders the video itself.
case "$1" in
  ${allowed}) ;;
  *) echo "hf: '$1' is not available here. Use one of: ${AGENT_SUBCOMMANDS.join(", ")}." >&2; exit 2 ;;
esac
export ELECTRON_RUN_AS_NODE=1 ${flags}
exec ${shellQuote(execPath)} ${shellQuote(cliPath)} "$@"
`;
}

export function hfWrapperCmd(execPath: string, cliPath: string): string {
	const checks = AGENT_SUBCOMMANDS.map((command) => `if /I "%~1"=="${command}" goto run`).join(
		"\r\n",
	);
	const flags = Object.entries(OFFLINE_FLAGS)
		.map(([key, value]) => `set "${key}=${value}"`)
		.join("\r\n");
	return `@echo off\r
rem Guide Studio's HyperFrames CLI for this session. Inspection commands only.\r
${checks}\r
echo hf: "%~1" is not available here. Use one of: ${AGENT_SUBCOMMANDS.join(", ")}. 1>&2\r
exit /b 2\r
:run\r
setlocal\r
set "ELECTRON_RUN_AS_NODE=1"\r
${flags}\r
"${execPath}" "${cliPath}" %*\r
`;
}

function copyDirectory(from: string, to: string): void {
	fs.mkdirSync(to, { recursive: true });
	fs.cpSync(from, to, { recursive: true, dereference: true });
}

export interface ScaffoldOptions {
	root: string;
	sessionId: string;
	title: string;
	format: AnimatedFormat;
	targetSeconds: number;
	/** Overridable for tests; default to the installed app's locations. */
	vendorDir?: string;
	gsapPath?: string;
	execPath?: string;
	cliPath?: string;
}

export function scaffoldAnimatedProject(options: ScaffoldOptions): void {
	const vendorDir = options.vendorDir ?? hyperframesVendorDir();
	const root = options.root;
	for (const skill of VENDORED_SKILLS) {
		const source = path.join(vendorDir, "skills", skill);
		if (fs.existsSync(source)) copyDirectory(source, path.join(root, ".claude", "skills", skill));
	}

	fs.mkdirSync(path.join(root, "assets", "vendor"), { recursive: true });
	fs.copyFileSync(
		options.gsapPath ?? gsapBrowserBuildPath(),
		path.join(root, "assets", "vendor", "gsap.min.js"),
	);

	const sfxTarget = path.join(root, "assets", "sfx");
	fs.mkdirSync(sfxTarget, { recursive: true });
	const sfxSource = sfxLibraryDir(vendorDir);
	for (const entry of readSfxLibrary(vendorDir)) {
		fs.copyFileSync(path.join(sfxSource, entry.file), path.join(sfxTarget, entry.file));
	}
	fs.mkdirSync(path.join(root, "compositions"), { recursive: true });

	const indexPath = path.join(root, "index.html");
	if (!fs.existsSync(indexPath)) {
		fs.writeFileSync(indexPath, starterIndexHtml(options.format, options.targetSeconds), "utf8");
	}
	fs.writeFileSync(
		path.join(root, "hyperframes.json"),
		`${JSON.stringify(
			{
				paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
				media: { autoProxy: true },
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "meta.json"),
		`${JSON.stringify({ id: options.sessionId, name: options.title.slice(0, 80) }, null, 2)}\n`,
		"utf8",
	);

	const execPath = options.execPath ?? process.execPath;
	const cliPath = options.cliPath ?? hyperframesCliPath();
	const wrapper = path.join(root, "hf");
	fs.writeFileSync(wrapper, hfWrapperScript(execPath, cliPath), "utf8");
	fs.chmodSync(wrapper, 0o755);
	fs.writeFileSync(path.join(root, "hf.cmd"), hfWrapperCmd(execPath, cliPath), "utf8");
}
