#!/usr/bin/env node
// Refresh the HyperFrames agent skills vendored into vendor/hyperframes/.
//
// The AI Video Creator's "Animated" look hands these skills to the user's own
// Claude Code / Codex run, so the agent authors compositions the way the
// HyperFrames authors intend. They are vendored (not fetched at runtime)
// because the creator runs offline and a session must not change behaviour
// because upstream moved. Pin both this commit and the `hyperframes` npm
// version together: the skills describe that CLI's flags and lint rules.
//
//   node scripts/vendor-hyperframes-skills.mjs [commit]
//
// Upstream: https://github.com/heygen-com/hyperframes (Apache-2.0).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_COMMIT = "1d0a18c814d3bd53f8752be5a24c7e7c8ace787f";
const SKILLS = ["hyperframes", "hyperframes-cli", "media-use"];
const REPO = "https://github.com/heygen-com/hyperframes.git";

const commit = process.argv[2] ?? DEFAULT_COMMIT;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repoRoot, "vendor", "hyperframes");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-skills-"));

const git = (...args) =>
	execFileSync("git", args, {
		cwd: scratch,
		stdio: ["ignore", "inherit", "inherit"],
		env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
	});

try {
	git("init", "-q");
	git("remote", "add", "origin", REPO);
	git("config", "core.sparseCheckout", "true");
	fs.writeFileSync(
		path.join(scratch, ".git", "info", "sparse-checkout"),
		["/LICENSE", ...SKILLS.map((skill) => `/skills/${skill}/`)].join("\n"),
	);
	git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit);
	git("checkout", "-q", "FETCH_HEAD");

	fs.rmSync(target, { recursive: true, force: true });
	fs.mkdirSync(path.join(target, "skills"), { recursive: true });
	for (const skill of SKILLS) {
		fs.cpSync(path.join(scratch, "skills", skill), path.join(target, "skills", skill), {
			recursive: true,
		});
	}
	// Upstream test files are not used by an agent and would be picked up by
	// this repo's own test runner.
	for (const file of fs.readdirSync(target, { recursive: true })) {
		if (/\.test\.m?js$/.test(String(file))) fs.rmSync(path.join(target, String(file)));
	}
	fs.copyFileSync(path.join(scratch, "LICENSE"), path.join(target, "LICENSE"));
	fs.writeFileSync(
		path.join(target, "UPSTREAM.json"),
		`${JSON.stringify({ repository: REPO, commit, skills: SKILLS }, null, "\t")}\n`,
	);
	console.log(`Vendored ${SKILLS.join(", ")} at ${commit} into ${path.relative(repoRoot, target)}`);
} finally {
	fs.rmSync(scratch, { recursive: true, force: true });
}
