import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkReference, collectReferences, scanCompositionSafety } from "./safety";

const created: string[] = [];

function project(files: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "hf-safety-"));
	created.push(root);
	for (const [name, body] of Object.entries(files)) {
		const full = path.join(root, name);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, body);
	}
	return root;
}

afterEach(() => {
	while (created.length) fs.rmSync(created.pop() as string, { recursive: true, force: true });
});

const SAFE_INDEX = `<!doctype html><html><head><script src="assets/vendor/gsap.min.js"></script>
<style>#bg{background:url('assets/media/bg.png')}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4">
<div id="intro" data-composition-src="compositions/intro.html" data-start="0" data-duration="4"></div>
<audio id="sfx-pop" data-start="1" src="assets/sfx/pop.mp3"></audio>
<p>Visit https://example.com to learn more.</p>
</div>
<script>const tl = gsap.timeline({ paused: true }); window.__timelines["main"] = tl;</script>
</body></html>`;

function safeProject(extra: Record<string, string> = {}) {
	return project({
		"index.html": SAFE_INDEX,
		"compositions/intro.html": "<template><div id='root'></div></template>",
		"assets/vendor/gsap.min.js": "/* https://greensock.com */ fetch('x')",
		"assets/media/bg.png": "png",
		"assets/sfx/pop.mp3": "mp3",
		...extra,
	});
}

describe("scanCompositionSafety", () => {
	it("accepts a local project and a URL that is only visible text", () => {
		expect(scanCompositionSafety(safeProject())).toEqual([]);
	});

	it("trusts the vendored GSAP build it placed itself", () => {
		// The fixture's gsap.min.js contains both a URL and fetch(); neither is reported.
		expect(scanCompositionSafety(safeProject())).toEqual([]);
	});

	it("rejects remote media, stylesheets and CDN scripts", () => {
		const root = safeProject({
			"compositions/outro.html": `<template>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<link rel="stylesheet" href="//fonts.googleapis.com/css2?family=Inter">
<img src="http://tracker.example/pixel.gif">
<style>@import url("https://evil.example/x.css"); .a{background:url(https://x.example/a.png)}</style>
</template>`,
		});
		const messages = scanCompositionSafety(root).map((finding) => finding.message);
		expect(messages.filter((message) => message.startsWith("remote reference"))).toHaveLength(5);
	});

	it("rejects network and code-loading APIs in scripts", () => {
		const root = safeProject({
			"compositions/x.html": `<template><script>
fetch("assets/a.json"); new XMLHttpRequest(); new WebSocket("x"); navigator.sendBeacon("x");
import("./mod.js"); new Worker("w.js"); eval("1"); window.open("x");
</script></template>`,
		});
		const messages = scanCompositionSafety(root).map((finding) => finding.message);
		for (const api of [
			"fetch()",
			"XMLHttpRequest",
			"WebSocket",
			"navigator.sendBeacon",
			"dynamic import()",
			"Web Workers",
			"eval / new Function",
			"window.open()",
		]) {
			expect(messages).toContain(`scripts may not use ${api}`);
		}
	});

	it("rejects URLs inside script code even without a network call", () => {
		const root = safeProject({
			"compositions/x.html": `<template><script>const img = new Image(); img.src = "https://x.example/a.png";</script></template>`,
		});
		expect(scanCompositionSafety(root).map((finding) => finding.message)).toContain(
			"scripts may not contain URLs",
		);
	});

	it("rejects paths that escape the project, absolute paths and missing files", () => {
		const root = safeProject({
			"compositions/x.html": `<template>
<video src="../../secrets.mp4"></video><img src="/Users/me/photo.png"><img src="file:///etc/passwd">
<img src="assets/media/missing.png"></template>`,
		});
		const messages = scanCompositionSafety(root).map((finding) => finding.message);
		expect(messages.some((message) => message.includes("points outside the project"))).toBe(true);
		expect(messages.some((message) => message.startsWith("absolute path"))).toBe(true);
		expect(messages.some((message) => message.includes("file:///etc/passwd"))).toBe(true);
		expect(messages.some((message) => message.includes("does not exist"))).toBe(true);
	});

	it("rejects embedding elements and inline handlers", () => {
		const root = safeProject({
			"compositions/x.html": `<template><iframe src="assets/media/bg.png"></iframe><img src="assets/media/bg.png" onerror="x()"></template>`,
		});
		const messages = scanCompositionSafety(root).map((finding) => finding.message);
		expect(messages).toContain("<iframe> is not allowed");
		expect(messages.some((message) => message.startsWith("inline event handler"))).toBe(true);
	});

	it("does not scan Guide Studio's own folders", () => {
		const root = safeProject({
			".claude/skills/hyperframes/assets/showcase.html": `<script src="https://cdn.example/x.js"></script>`,
			"output/notes.html": `<img src="https://x.example/a.png">`,
		});
		expect(scanCompositionSafety(root)).toEqual([]);
	});

	it("reports a missing index.html", () => {
		const root = project({ "compositions/a.html": "<template></template>" });
		expect(scanCompositionSafety(root)).toContainEqual({
			file: "index.html",
			message: "index.html is missing.",
		});
	});
});

describe("references", () => {
	it("collects src, srcset, url() and @import references", () => {
		expect(
			collectReferences(
				`<img src="a.png" srcset="b.png 1x, c.png 2x"><div style="background:url('d.png')"></div><style>@import "e.css";</style>`,
				".html",
			),
		).toEqual(["a.png", "b.png", "c.png", "d.png", "e.css"]);
	});

	it("ignores fragments, data URIs and runtime-resolved values", () => {
		const root = os.tmpdir();
		for (const value of [
			"#clip",
			"data:image/png;base64,AA",
			"blob:abc",
			"var(--logo)",
			"{{logo}}",
		]) {
			expect(checkReference(root, value)).toBeUndefined();
		}
	});
});
