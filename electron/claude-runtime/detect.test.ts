import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	augmentedPathEnv,
	candidateBinaryPaths,
	meetsMinimum,
	parseVersion,
	SKILLS_MINIMUM_VERSION,
} from "./detect";

describe("candidateBinaryPaths", () => {
	it("covers the official installer location on macOS and Linux", () => {
		const candidates = candidateBinaryPaths("darwin", "/Users/ada");
		expect(candidates).toContain("/Users/ada/.local/bin/claude");
		expect(candidates).toContain("/usr/local/bin/claude");
		expect(candidates).toContain("/opt/homebrew/bin/claude");
	});

	it("uses Windows layouts and the .exe/.cmd suffixes on win32", () => {
		const candidates = candidateBinaryPaths("win32", "C:\\Users\\ada");
		expect(candidates.every((candidate) => /\.(exe|cmd)$/.test(candidate))).toBe(true);
	});

	it("searches the same install routes for Codex, under its own name", () => {
		const candidates = candidateBinaryPaths("darwin", "/Users/ada", "codex");
		expect(candidates).toContain("/Users/ada/.local/bin/codex");
		expect(candidates).toContain("/opt/homebrew/bin/codex");
		expect(candidates).toContain("/Users/ada/.codex/bin/codex");
		// Nothing from the other agent leaks into the list.
		expect(candidates.some((candidate) => candidate.includes("claude"))).toBe(false);
	});
});

describe("parseVersion across both CLIs", () => {
	it("reads Claude Code's format", () => {
		expect(parseVersion("1.0.65 (Claude Code)")).toBe("1.0.65");
	});

	it("reads the Codex CLI's format", () => {
		expect(parseVersion("codex-cli 0.153.4")).toBe("0.153.4");
	});
});

describe("augmentedPathEnv", () => {
	it("adds the install directories a Finder launch is missing", () => {
		const result = augmentedPathEnv("darwin", "/Users/ada", "/usr/bin:/bin");
		const entries = result.split(path.delimiter);
		expect(entries).toContain("/usr/bin");
		expect(entries).toContain("/usr/local/bin");
		expect(entries).toContain("/Users/ada/.local/bin");
	});

	it("does not duplicate an entry the shell already exported", () => {
		const result = augmentedPathEnv("darwin", "/Users/ada", "/usr/local/bin:/usr/bin");
		const occurrences = result.split(path.delimiter).filter((entry) => entry === "/usr/local/bin");
		expect(occurrences).toHaveLength(1);
	});

	it("leaves Windows PATH untouched", () => {
		expect(augmentedPathEnv("win32", "C:\\Users\\ada", "C:\\Windows")).toBe("C:\\Windows");
	});
});

describe("parseVersion", () => {
	it("reads the semver out of the CLI banner", () => {
		expect(parseVersion("1.0.65 (Claude Code)\n")).toBe("1.0.65");
		expect(parseVersion("2.1.238 (Claude Code)")).toBe("2.1.238");
	});

	it("returns nothing when the output carries no version", () => {
		expect(parseVersion("command not found")).toBeUndefined();
	});
});

describe("meetsMinimum", () => {
	it("compares numerically rather than lexically", () => {
		// The lexical trap: "10" < "9" as strings.
		expect(meetsMinimum("2.10.0", "2.9.0")).toBe(true);
		expect(meetsMinimum("2.9.0", "2.10.0")).toBe(false);
	});

	it("treats an equal version as meeting the minimum", () => {
		expect(meetsMinimum("2.0.0", "2.0.0")).toBe(true);
	});

	it("puts the observed 1.0.65 install below the file-skills threshold", () => {
		expect(meetsMinimum("1.0.65", SKILLS_MINIMUM_VERSION)).toBe(false);
	});

	it("is false when the version is unknown", () => {
		expect(meetsMinimum(undefined, "2.0.0")).toBe(false);
	});
});
