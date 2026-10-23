// ── Composition safety gate ──────────────────────────────────────────────
//
// The Animated look renders HTML, CSS and JavaScript the agent wrote. That
// code runs only inside headless Chrome's renderer — no Node, no Electron
// APIs — so the realistic harms are the page reaching the network (leaking
// the user's staged media or copy, or pulling in code we never reviewed) and
// pointing at files outside the session folder. This scan rejects both before
// anything is checked, previewed or rendered.
//
// It is deliberately a strict allowlist of shapes, not a sandbox: text that
// merely *mentions* a URL is fine in markup, but scripts may not contain one
// at all, and every src/href/url() must name a file inside the project.

import fs from "node:fs";
import path from "node:path";

export interface SafetyFinding {
	file: string;
	message: string;
}

/** Folders that are ours, not the composition's, and are never scanned. */
const SKIPPED_DIRS = new Set([
	".claude",
	".agents",
	".hyperframes",
	"output",
	"render",
	"node_modules",
]);
const SCANNED_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".svg"]);
/** Third-party code Guide Studio placed there itself. */
const TRUSTED_FILES = new Set(["assets/vendor/gsap.min.js"]);
const MAX_SCANNED_FILES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const FORBIDDEN_ELEMENTS: ReadonlyArray<[RegExp, string]> = [
	[/<\s*iframe\b/i, "<iframe> is not allowed"],
	[/<\s*object\b/i, "<object> is not allowed"],
	[/<\s*embed\b/i, "<embed> is not allowed"],
	[/<\s*base\b/i, "<base> is not allowed"],
	[/<\s*form\b/i, "<form> is not allowed"],
	[/<\s*meta\b[^>]*http-equiv\s*=\s*["']?refresh/i, "meta refresh is not allowed"],
	[
		/<\s*link\b[^>]*rel\s*=\s*["']?(?:prefetch|preconnect|dns-prefetch|prerender|preload|modulepreload)/i,
		"resource hints are not allowed",
	],
];

/** Browser APIs that reach the network or spawn code we did not scan. */
const FORBIDDEN_SCRIPT_APIS: ReadonlyArray<[RegExp, string]> = [
	[/\bfetch\s*\(/, "fetch()"],
	[/\bXMLHttpRequest\b/, "XMLHttpRequest"],
	[/\bWebSocket\b/, "WebSocket"],
	[/\bEventSource\b/, "EventSource"],
	[/\bsendBeacon\b/, "navigator.sendBeacon"],
	[/\bRTCPeerConnection\b/, "RTCPeerConnection"],
	[/\bimportScripts\s*\(/, "importScripts()"],
	[/\bimport\s*\(/, "dynamic import()"],
	[/\bnew\s+(?:Shared)?Worker\s*\(/, "Web Workers"],
	[/\bserviceWorker\b/, "service workers"],
	[/\bwindow\.open\s*\(/, "window.open()"],
	[/\b(?:document|window)\.location\b|\blocation\.(?:href|assign|replace)\b/, "navigation"],
	[/\beval\s*\(|\bnew\s+Function\s*\(/, "eval / new Function"],
];

const REMOTE_SCHEME = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const ANY_URL_IN_SCRIPT = /\b(?:https?|wss?|ftp):\/\//i;

function rel(root: string, file: string): string {
	return path.relative(root, file).split(path.sep).join("/");
}

function listFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (dir === root && SKIPPED_DIRS.has(entry.name)) continue;
				walk(full);
			} else if (SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
				files.push(full);
			}
		}
	};
	walk(root);
	return files;
}

/** Every <script> body in an HTML document (inline scripts only). */
function inlineScripts(html: string): string[] {
	const bodies: string[] = [];
	const pattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
	for (const match of html.matchAll(pattern)) bodies.push(match[1] ?? "");
	return bodies;
}

/** References a document or stylesheet makes to other files. */
export function collectReferences(text: string, extension: string): string[] {
	const references: string[] = [];
	if (extension !== ".css") {
		const attribute =
			/\s(?:src|href|poster|xlink:href|data-src|data-poster|data-var-src-default)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
		for (const match of text.matchAll(attribute)) references.push(match[1] ?? match[2] ?? "");
		const srcset = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
		for (const match of text.matchAll(srcset)) {
			for (const candidate of (match[1] ?? match[2] ?? "").split(",")) {
				const url = candidate.trim().split(/\s+/)[0];
				if (url) references.push(url);
			}
		}
	}
	for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi)) {
		references.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
	}
	for (const match of text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) {
		references.push(match[1] ?? "");
	}
	return references;
}

/**
 * Check one reference. HyperFrames resolves asset paths from the project
 * root, in sub-compositions too, so that is what "inside" means here.
 */
export function checkReference(root: string, reference: string): string | undefined {
	const value = reference.trim();
	if (!value || value.startsWith("#")) return undefined;
	if (/^(?:data|blob):/i.test(value)) return undefined;
	// Template expressions and CSS variables are resolved at runtime from
	// values that are themselves scanned.
	if (value.includes("{") || value.startsWith("var(")) return undefined;
	if (REMOTE_SCHEME.test(value)) return `remote reference "${value.slice(0, 80)}"`;
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return `"${value.slice(0, 40)}" uses a URL scheme`;
	if (value.startsWith("/") || value.startsWith("\\")) {
		return `absolute path "${value.slice(0, 80)}" (use a project-relative path like assets/...)`;
	}
	const withoutQuery = decodeURIComponent(value.split(/[?#]/)[0] ?? "");
	const resolved = path.resolve(root, withoutQuery);
	const relative = path.relative(root, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return `"${value.slice(0, 80)}" points outside the project folder`;
	}
	if (!fs.existsSync(resolved)) return `"${value.slice(0, 80)}" does not exist in the project`;
	return undefined;
}

/** Scan a whole project. An empty array means it may be checked and rendered. */
export function scanCompositionSafety(root: string): SafetyFinding[] {
	const findings: SafetyFinding[] = [];
	const resolvedRoot = path.resolve(root);
	const files = listFiles(resolvedRoot);
	if (files.length > MAX_SCANNED_FILES) {
		return [
			{
				file: ".",
				message: `The project has ${files.length} code files; the limit is ${MAX_SCANNED_FILES}.`,
			},
		];
	}
	if (!fs.existsSync(path.join(resolvedRoot, "index.html"))) {
		findings.push({ file: "index.html", message: "index.html is missing." });
	}

	for (const file of files) {
		const name = rel(resolvedRoot, file);
		if (TRUSTED_FILES.has(name)) continue;
		const stat = fs.statSync(file);
		if (stat.size > MAX_FILE_BYTES) {
			findings.push({ file: name, message: "file is larger than 2 MB" });
			continue;
		}
		const text = fs.readFileSync(file, "utf8");
		const extension = path.extname(file).toLowerCase();
		const add = (message: string) => findings.push({ file: name, message });

		const scripts =
			extension === ".js" || extension === ".mjs"
				? [text]
				: extension === ".css"
					? []
					: inlineScripts(text);
		for (const script of scripts) {
			for (const [pattern, label] of FORBIDDEN_SCRIPT_APIS) {
				if (pattern.test(script)) add(`scripts may not use ${label}`);
			}
			if (ANY_URL_IN_SCRIPT.test(script)) add("scripts may not contain URLs");
		}
		if (extension === ".html" || extension === ".htm" || extension === ".svg") {
			for (const [pattern, message] of FORBIDDEN_ELEMENTS) {
				if (pattern.test(text)) add(message);
			}
			if (/\son[a-z]+\s*=/i.test(text.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ""))) {
				add("inline event handler attributes (onload=, onclick=…) are not allowed");
			}
		}
		if (extension !== ".js" && extension !== ".mjs") {
			for (const reference of collectReferences(text, extension)) {
				const problem = checkReference(resolvedRoot, reference);
				if (problem) add(problem);
			}
		}
	}
	// One line per distinct problem keeps the repair prompt short.
	const seen = new Set<string>();
	return findings.filter((finding) => {
		const key = `${finding.file}\u0000${finding.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
