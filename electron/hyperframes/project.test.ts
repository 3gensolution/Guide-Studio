import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));

import { buildAnimatedBrief } from "./brief";
import { extractJsonEnvelope, parseProgressLine } from "./cli";
import { readCheckEnvelope } from "./pipeline";
import { hfWrapperScript, readSfxLibrary, scaffoldAnimatedProject } from "./project";
import { scanCompositionSafety } from "./safety";

const VENDOR = path.join(process.cwd(), "vendor", "hyperframes");
const created: string[] = [];
afterEach(() => {
	while (created.length) fs.rmSync(created.pop() as string, { recursive: true, force: true });
});

function tempRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "hf-project-"));
	created.push(root);
	return root;
}

describe("scaffoldAnimatedProject", () => {
	it("lays down skills, local GSAP, the effect library and a safe starter", () => {
		const root = tempRoot();
		const fakeGsap = path.join(root, "gsap-source.js");
		fs.writeFileSync(fakeGsap, "/* gsap */");
		scaffoldAnimatedProject({
			root,
			sessionId: "s1",
			title: "Launch film",
			format: "vertical",
			targetSeconds: 30,
			vendorDir: VENDOR,
			gsapPath: fakeGsap,
			execPath: "/Applications/Guide Studio.app/Contents/MacOS/Guide Studio",
			cliPath: "/opt/hf/bin/hyperframes.mjs",
		});
		fs.rmSync(fakeGsap);
		expect(fs.existsSync(path.join(root, ".claude/skills/hyperframes/SKILL.md"))).toBe(true);
		expect(fs.existsSync(path.join(root, ".claude/skills/media-use/references/mixing.md"))).toBe(
			true,
		);
		expect(fs.readFileSync(path.join(root, "assets/vendor/gsap.min.js"), "utf8")).toBe(
			"/* gsap */",
		);
		expect(fs.readdirSync(path.join(root, "assets/sfx")).length).toBe(
			readSfxLibrary(VENDOR).length,
		);
		const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
		expect(index).toContain('data-width="1080" data-height="1920"');
		expect(index).toContain('data-duration="30"');
		// The starter passes Guide Studio's own safety gate as written.
		expect(scanCompositionSafety(root)).toEqual([]);
		expect(fs.statSync(path.join(root, "hf")).mode & 0o111).toBeTruthy();
	});

	it("ships a non-empty effect library with durations", () => {
		const library = readSfxLibrary(VENDOR);
		expect(library.length).toBeGreaterThan(10);
		expect(library.find((entry) => entry.id === "whoosh")?.durationSeconds).toBeGreaterThan(0);
	});
});

describe("hf wrapper", () => {
	it.skipIf(process.platform === "win32")(
		"runs allowed subcommands and refuses render, publish and installs",
		() => {
			const root = tempRoot();
			// Stand-ins for Electron and the CLI: echo what would have run.
			const fakeExec = path.join(root, "fake electron");
			fs.writeFileSync(fakeExec, '#!/bin/sh\necho "$ELECTRON_RUN_AS_NODE $DO_NOT_TRACK $2 $3"\n');
			fs.chmodSync(fakeExec, 0o755);
			const wrapper = path.join(root, "hf");
			fs.writeFileSync(wrapper, hfWrapperScript(fakeExec, "/cli's path.mjs"));
			fs.chmodSync(wrapper, 0o755);

			expect(execFileSync(wrapper, ["check", "--json"], { encoding: "utf8" }).trim()).toBe(
				"1 1 check --json",
			);
			for (const command of ["render", "publish", "add", "cloud", "capture", "preview"]) {
				expect(() => execFileSync(wrapper, [command], { stdio: "pipe" })).toThrow();
			}
		},
	);
});

describe("CLI output", () => {
	it("parses progress lines and ignores everything else", () => {
		expect(parseProgressLine('@hf-progress {"code":"encode","done":1,"total":2,"pct":90}')).toEqual(
			{
				code: "encode",
				pct: 90,
			},
		);
		expect(parseProgressLine("  ████ 90% Assembling")).toBeUndefined();
	});

	it("takes the JSON envelope out of surrounding log text", () => {
		expect(extractJsonEnvelope('[INFO] fonts cached\n{"ok":true}\n')).toEqual({ ok: true });
		expect(extractJsonEnvelope("no json here")).toBeUndefined();
	});

	it("collects errors and warnings from every check section", () => {
		const { errors, warnings } = readCheckEnvelope({
			ok: false,
			lint: {
				findings: [
					{
						severity: "error",
						message: "<video> has src but no data-start.",
						file: "/x/compositions/proof.html",
						fixHint: 'Add data-start="0".',
					},
				],
			},
			runtime: { findings: [{ severity: "warning", message: "slot is longer than the audio" }] },
			layout: { findings: [] },
			_meta: { version: "0.8.186" },
		});
		expect(errors).toEqual([
			'proof.html: <video> has src but no data-start. Fix: Add data-start="0".',
		]);
		expect(warnings).toEqual(["slot is longer than the audio"]);
	});
});

describe("buildAnimatedBrief", () => {
	const base = {
		agent: "claude" as const,
		request: "A 30s launch film for our recorder",
		format: "landscape" as const,
		targetSeconds: 30,
		assets: [
			{
				id: "ref-1",
				kind: "video" as const,
				label: "demo.mp4",
				file: "assets/ref-1.mp4",
				shotSegments: [{ startSeconds: 0, endSeconds: 4.2 }],
				transcriptExcerpt: "Click record",
			},
		],
		sfxLibrary: readSfxLibrary(VENDOR),
		workspaceRoot: "/tmp/session",
	};

	it("states the environment's differences from the HyperFrames skills", () => {
		const brief = buildAnimatedBrief({ ...base, canGenerateAudio: false });
		for (const rule of [
			"No questions, no stops",
			"No network",
			"assets/vendor/gsap.min.js",
			"You do not render",
			"data-composition-variables",
			"data-var-text",
			"assets/ref-1.mp4",
			"0.0–4.2s",
			"assets/sfx/whoosh.mp3",
			"./hf check --json",
			"without a music bed",
		]) {
			expect(brief).toContain(rule);
		}
		expect(brief).not.toContain("music-request.json");
	});

	it("offers generated audio only when a key is configured", () => {
		const brief = buildAnimatedBrief({ ...base, canGenerateAudio: true });
		expect(brief).toContain("output/sfx-requests.json");
		expect(brief).toContain("output/music-request.json");
		expect(brief).toContain("data-automation");
	});

	it("tells Codex about its sandbox instead of a tool allowlist", () => {
		const brief = buildAnimatedBrief({ ...base, agent: "codex", canGenerateAudio: false });
		expect(brief).toContain("sandbox");
		expect(brief).toContain(".\\hf.cmd");
	});
});
