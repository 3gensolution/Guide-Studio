import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyVariableValues,
	coerceVariableValue,
	parseVariableDeclarations,
	summarizeProject,
} from "./scenes";

const created: string[] = [];
afterEach(() => {
	while (created.length) fs.rmSync(created.pop() as string, { recursive: true, force: true });
});

const INTRO = `<template>
  <div id="root" data-composition-id="intro"
    data-composition-variables='[{"id":"headline","type":"string","label":"Headline","default":"Record once.","maxLength":40}]'>
    <h1 id="intro-title" class="clip" data-start="0.2" data-duration="3" data-var-text="headline">Record once.</h1>
  </div>
</template>`;

const INDEX = `<html data-composition-variables='[{"id":"accent","type":"color","label":"Accent","default":"#6d74ff"}]'><body></body></html>`;

/** A trimmed copy of a real `hyperframes timeline --json` envelope (v0.8.186). */
const TIMELINE = {
	timeline: {
		duration: 8,
		tracks: [
			{
				kind: "video",
				rows: [
					{
						id: "proof-video",
						kind: "video",
						trackKind: "video",
						absStart: 3.5,
						absEnd: 8,
						file: "compositions/proof.html",
						src: "assets/media/ref-1.mp4",
						nested: true,
						host: "proof",
					},
				],
			},
			{
				kind: "graphics",
				rows: [
					{
						id: "bg",
						kind: "div",
						absStart: 0,
						absEnd: 8,
						file: "index.html",
						src: null,
						sourceFile: null,
						nested: false,
					},
					{
						id: "proof",
						kind: "div",
						absStart: 3.5,
						absEnd: 8,
						file: "index.html",
						src: "compositions/proof.html",
						sourceFile: "compositions/proof.html",
						nested: false,
					},
					{
						id: "intro",
						kind: "div",
						absStart: 0,
						absEnd: 3.5,
						file: "index.html",
						src: "compositions/intro.html",
						sourceFile: "compositions/intro.html",
						nested: false,
					},
					{
						id: "intro-title",
						kind: "h1",
						absStart: 0.2,
						absEnd: 3.5,
						file: "compositions/intro.html",
						sourceFile: null,
						nested: true,
					},
				],
			},
			{
				kind: "audio",
				rows: [
					{
						id: "sfx-whoosh-1",
						kind: "audio",
						absStart: 3.45,
						absEnd: 4.02,
						src: "assets/sfx/whoosh.mp3",
						volume: 0.8,
					},
					{
						id: "music-bed",
						kind: "audio",
						absStart: 0,
						absEnd: 8,
						src: "assets/music/bed.mp3",
						volume: 0.5,
					},
				],
			},
		],
	},
};

describe("variables", () => {
	it("parses declarations in single- and double-quoted attributes", () => {
		expect(parseVariableDeclarations(INTRO)).toEqual([
			{ id: "headline", type: "string", label: "Headline", value: "Record once.", maxLength: 40 },
		]);
		const doubleQuoted = `<html data-composition-variables="[{&quot;id&quot;:&quot;n&quot;,&quot;type&quot;:&quot;number&quot;,&quot;default&quot;:3,&quot;min&quot;:1}]">`;
		expect(parseVariableDeclarations(doubleQuoted)).toEqual([
			{ id: "n", type: "number", label: "n", value: 3, min: 1 },
		]);
	});

	it("returns nothing for a missing or malformed declaration", () => {
		expect(parseVariableDeclarations("<div></div>")).toEqual([]);
		expect(parseVariableDeclarations(`<html data-composition-variables='not json'>`)).toEqual([]);
	});

	it("rewrites the default and the bound fallback text", () => {
		const next = applyVariableValues(INTRO, { headline: "Ship <everywhere> & 'now'" });
		expect(parseVariableDeclarations(next)[0]?.value).toBe("Ship <everywhere> & 'now'");
		expect(next).toContain(`data-var-text="headline">Ship &lt;everywhere&gt; &amp; 'now'</h1>`);
		// Everything outside the declaration and the bound text is untouched.
		expect(next).toContain(`id="intro-title" class="clip" data-start="0.2"`);
	});

	it("leaves unknown ids and files without declarations alone", () => {
		expect(applyVariableValues(INTRO, { other: "x" })).toContain(">Record once.</h1>");
		expect(applyVariableValues("<div>x</div>", { headline: "y" })).toBe("<div>x</div>");
	});

	it("coerces values to their declared type", () => {
		const text = { id: "t", type: "string" as const, label: "T", value: "", maxLength: 5 };
		expect(coerceVariableValue(text, "  a   long  title ")).toBe("a lon");
		const number = { id: "n", type: "number" as const, label: "N", value: 0, min: 0, max: 10 };
		expect(coerceVariableValue(number, "42")).toBe(10);
		expect(() => coerceVariableValue(number, "abc")).toThrow("must be a number");
		const color = { id: "c", type: "color" as const, label: "C", value: "#000000" };
		expect(coerceVariableValue(color, "#AbCdEf")).toBe("#AbCdEf");
		expect(() => coerceVariableValue(color, "red; background:url(x)")).toThrow("hex colour");
		const choice = {
			id: "e",
			type: "enum" as const,
			label: "E",
			value: "a",
			options: [{ value: "a", label: "A" }],
		};
		expect(() => coerceVariableValue(choice, "b")).toThrow("listed options");
	});
});

describe("summarizeProject", () => {
	it("lists top-level scene hosts in play order with their variables, and the audio", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "hf-scenes-"));
		created.push(root);
		fs.mkdirSync(path.join(root, "compositions"));
		fs.writeFileSync(path.join(root, "index.html"), INDEX);
		fs.writeFileSync(path.join(root, "compositions", "intro.html"), INTRO);
		fs.writeFileSync(path.join(root, "compositions", "proof.html"), "<template></template>");

		const summary = summarizeProject(root, TIMELINE);
		expect(summary.durationSeconds).toBe(8);
		expect(
			summary.scenes.map((scene) => [scene.id, scene.startSeconds, scene.durationSeconds]),
		).toEqual([
			["intro", 0, 3.5],
			["proof", 3.5, 4.5],
		]);
		expect(summary.scenes[0]?.variables.map((variable) => variable.id)).toEqual(["headline"]);
		expect(summary.globalVariables.map((variable) => variable.id)).toEqual(["accent"]);
		expect(summary.audio.map((clip) => [clip.id, clip.role])).toEqual([
			["music-bed", "music"],
			["sfx-whoosh-1", "sfx"],
		]);
	});

	it("never reads a scene file outside the project", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "hf-scenes-"));
		created.push(root);
		const envelope = {
			timeline: {
				duration: 2,
				tracks: [
					{
						rows: [
							{ id: "x", absStart: 0, absEnd: 2, sourceFile: "../../etc/passwd", nested: false },
						],
					},
				],
			},
		};
		expect(summarizeProject(root, envelope).scenes[0]?.variables).toEqual([]);
	});
});
