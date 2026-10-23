// ── Self-contained HyperFrames CLI for packaged builds ───────────────────
//
// The Animated look runs the `hyperframes` CLI on Electron's own Node. Its
// ESM dependency graph cannot be loaded from inside app.asar, so packaged
// builds ship a clean production install as an extra resource instead:
//
//   dist-hyperframes/<arch>/node_modules/hyperframes/bin/hyperframes.mjs
//
// One tree per CPU architecture, because sharp and esbuild carry native
// binaries and a macOS build packages x64 and arm64 in the same run;
// electron-builder picks the matching tree with its ${arch} macro. Chrome is
// not bundled: the CLI downloads its headless shell on first use.
//
// Usage:  node scripts/bundle-hyperframes.mjs [arch ...]   (default: host arch,
//         plus arm64 and x64 on macOS)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = pkg.dependencies?.hyperframes;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	throw new Error("package.json must pin hyperframes to an exact version.");
}

const requested = process.argv.slice(2);
const arches = requested.length
	? requested
	: process.platform === "darwin"
		? ["x64", "arm64"]
		: [process.arch];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const outRoot = path.join(projectRoot, "dist-hyperframes");
fs.rmSync(outRoot, { recursive: true, force: true });

for (const arch of arches) {
	const target = path.join(outRoot, arch);
	fs.mkdirSync(target, { recursive: true });
	fs.writeFileSync(
		path.join(target, "package.json"),
		`${JSON.stringify({ name: "guide-studio-hyperframes", private: true, dependencies: { hyperframes: version } }, null, 2)}\n`,
	);
	console.log(`[bundle-hyperframes] hyperframes@${version} for ${process.platform}-${arch}`);
	execFileSync(
		npm,
		[
			"install",
			"--omit=dev",
			"--no-audit",
			"--no-fund",
			"--no-package-lock",
			// Install scripts only re-verify native binaries by executing them,
			// which cannot work for a foreign --cpu; the prebuilt per-platform
			// optional packages are what actually ship.
			"--ignore-scripts",
			`--os=${process.platform}`,
			`--cpu=${arch}`,
		],
		{
			cwd: target,
			stdio: "inherit",
			shell: process.platform === "win32",
			// The CLI fetches its own headless Chrome on first use; never bundle one.
			env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", PUPPETEER_SKIP_CHROME_DOWNLOAD: "1" },
		},
	);
	const cli = path.join(target, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
	if (!fs.existsSync(cli)) throw new Error(`The HyperFrames CLI is missing from ${target}.`);
}
console.log(
	`[bundle-hyperframes] Wrote ${arches.join(", ")} into ${path.relative(projectRoot, outRoot)}/`,
);
