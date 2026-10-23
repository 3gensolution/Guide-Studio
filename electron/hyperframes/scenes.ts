// ── Scenes and editable values of a HyperFrames project ──────────────────
//
// What the creator shows as "scenes" is read from the CLI's own
// `timeline --json` (the authority on when each scene host plays, including
// relative starts like `data-start="intro"`), joined with the variables each
// file declares in `data-composition-variables`.
//
// Editing a value rewrites that variable's `default` in the file that
// declares it. Defaults are what preview, snapshot and render all read, so
// one edit shows up everywhere without threading a values file through
// every command — and the project on disk stays the single source of truth.

import fs from "node:fs";
import path from "node:path";

export type AnimatedVariableType = "string" | "number" | "color" | "boolean" | "enum";

export interface AnimatedVariable {
	id: string;
	type: AnimatedVariableType;
	label: string;
	value: string | number | boolean;
	maxLength?: number;
	min?: number;
	max?: number;
	options?: Array<{ value: string; label: string }>;
}

export interface AnimatedScene {
	/** The host element id in index.html, which is also its composition id. */
	id: string;
	/** Project-relative scene file, e.g. compositions/intro.html. */
	file: string;
	startSeconds: number;
	durationSeconds: number;
	variables: AnimatedVariable[];
}

export interface AnimatedAudioClip {
	id: string;
	src: string;
	startSeconds: number;
	durationSeconds: number;
	volume?: number;
	/** "music" for a bed, "source" for footage that keeps its sound, else an effect. */
	role: "music" | "sfx" | "voice" | "source";
}

export interface AnimatedProjectSummary {
	durationSeconds: number;
	scenes: AnimatedScene[];
	/** Variables on index.html — brand colours and the like, shared by every scene. */
	globalVariables: AnimatedVariable[];
	audio: AnimatedAudioClip[];
}

interface TimelineRow {
	id?: unknown;
	kind?: unknown;
	trackKind?: unknown;
	absStart?: unknown;
	absEnd?: unknown;
	duration?: unknown;
	file?: unknown;
	src?: unknown;
	sourceFile?: unknown;
	volume?: unknown;
	nested?: unknown;
	role?: unknown;
}

const VARIABLES_ATTRIBUTE = /data-composition-variables\s*=\s*(?:'([^']*)'|"([^"]*)")/;

function decodeAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function encodeSingleQuotedAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The variable declarations in one HTML file, in declaration order. */
export function parseVariableDeclarations(html: string): AnimatedVariable[] {
	const match = VARIABLES_ATTRIBUTE.exec(html);
	if (!match) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			match[1] !== undefined ? decodeAttribute(match[1]) : decodeAttribute(match[2] ?? ""),
		);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const variables: AnimatedVariable[] = [];
	for (const entry of parsed) {
		if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) continue;
		const type: AnimatedVariableType =
			entry.type === "number" ||
			entry.type === "color" ||
			entry.type === "boolean" ||
			entry.type === "enum"
				? entry.type
				: "string";
		const fallback = type === "number" ? 0 : type === "boolean" ? false : "";
		const value =
			typeof entry.default === "string" ||
			typeof entry.default === "number" ||
			typeof entry.default === "boolean"
				? entry.default
				: fallback;
		variables.push({
			id: entry.id,
			type,
			label: typeof entry.label === "string" && entry.label ? entry.label : entry.id,
			value,
			...(typeof entry.maxLength === "number" ? { maxLength: entry.maxLength } : {}),
			...(typeof entry.min === "number" ? { min: entry.min } : {}),
			...(typeof entry.max === "number" ? { max: entry.max } : {}),
			...(Array.isArray(entry.options)
				? {
						options: entry.options.filter(isRecord).map((option) => ({
							value: String(option.value ?? ""),
							label: String(option.label ?? option.value ?? ""),
						})),
					}
				: {}),
		});
	}
	return variables;
}

/** Coerce a user-entered value to what the declaration accepts, or throw. */
export function coerceVariableValue(
	variable: AnimatedVariable,
	value: unknown,
): string | number | boolean {
	switch (variable.type) {
		case "number": {
			const number = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(number)) throw new Error(`${variable.label} must be a number.`);
			const low = variable.min ?? Number.NEGATIVE_INFINITY;
			const high = variable.max ?? Number.POSITIVE_INFINITY;
			return Math.min(high, Math.max(low, number));
		}
		case "boolean":
			return value === true || value === "true";
		case "color": {
			const color = String(value ?? "").trim();
			if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(color)) {
				throw new Error(`${variable.label} must be a hex colour like #6d74ff.`);
			}
			return color;
		}
		case "enum": {
			const choice = String(value ?? "");
			if (variable.options?.length && !variable.options.some((option) => option.value === choice)) {
				throw new Error(`${variable.label} must be one of its listed options.`);
			}
			return choice;
		}
		default: {
			const text = String(value ?? "")
				.replace(/\s+/g, " ")
				.trim();
			const limit = variable.maxLength ?? 240;
			return text.length > limit ? text.slice(0, limit) : text;
		}
	}
}

function escapeHtmlText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite the defaults of the named variables in one file. Text bound with
 * `data-var-text` also gets its fallback text replaced, so the file reads
 * correctly to the next agent turn and in any tool that ignores variables.
 */
export function applyVariableValues(
	html: string,
	values: Record<string, string | number | boolean>,
): string {
	const match = VARIABLES_ATTRIBUTE.exec(html);
	if (!match) return html;
	const raw = match[1] !== undefined ? decodeAttribute(match[1]) : decodeAttribute(match[2] ?? "");
	let declarations: unknown;
	try {
		declarations = JSON.parse(raw);
	} catch {
		return html;
	}
	if (!Array.isArray(declarations)) return html;
	const updated = declarations.map((entry) =>
		isRecord(entry) && typeof entry.id === "string" && entry.id in values
			? { ...entry, default: values[entry.id] }
			: entry,
	);
	const attribute = `data-composition-variables='${encodeSingleQuotedAttribute(JSON.stringify(updated))}'`;
	let next = html.slice(0, match.index) + attribute + html.slice(match.index + match[0].length);

	for (const [id, value] of Object.entries(values)) {
		if (typeof value !== "string") continue;
		const bound = new RegExp(
			`(<([a-z][a-z0-9-]*)\\b[^>]*\\sdata-var-text\\s*=\\s*["']${escapeRegExp(id)}["'][^>]*>)([^<]*)(</\\2\\s*>)`,
			"gi",
		);
		next = next.replace(
			bound,
			(_whole, open: string, _tag: string, _text: string, close: string) =>
				`${open}${escapeHtmlText(value)}${close}`,
		);
	}
	return next;
}

function audioRole(id: string, src: string, kind: string): AnimatedAudioClip["role"] {
	if (kind === "video") return "source";
	const text = `${id} ${src}`.toLowerCase();
	if (/\b(?:music|bgm|bed|score|track)\b|assets\/music\//.test(text)) return "music";
	if (/\b(?:voice|narration|vo)\b|assets\/voice\//.test(text)) return "voice";
	return "sfx";
}

/** Flatten the CLI's `timeline --json` envelope into its rows. */
export function timelineRows(envelope: unknown): TimelineRow[] {
	const timeline =
		isRecord(envelope) && isRecord(envelope.timeline) ? envelope.timeline : undefined;
	const tracks = timeline && Array.isArray(timeline.tracks) ? timeline.tracks : [];
	const rows: TimelineRow[] = [];
	for (const track of tracks) {
		if (!isRecord(track) || !Array.isArray(track.rows)) continue;
		for (const row of track.rows) if (isRecord(row)) rows.push(row as TimelineRow);
	}
	return rows;
}

export function timelineDuration(envelope: unknown): number | undefined {
	const timeline =
		isRecord(envelope) && isRecord(envelope.timeline) ? envelope.timeline : undefined;
	return timeline && typeof timeline.duration === "number" ? timeline.duration : undefined;
}

/**
 * Build the creator's view of a project from the timeline envelope and the
 * files on disk. A scene is a top-level host that mounts a scene file.
 */
export function summarizeProject(root: string, envelope: unknown): AnimatedProjectSummary {
	const rows = timelineRows(envelope);
	const read = (file: string) => {
		const full = path.resolve(root, file);
		const relative = path.relative(root, full);
		if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(full)) return "";
		return fs.readFileSync(full, "utf8");
	};

	const scenes: AnimatedScene[] = rows
		.filter(
			(row) =>
				row.nested !== true &&
				typeof row.sourceFile === "string" &&
				typeof row.id === "string" &&
				typeof row.absStart === "number" &&
				typeof row.absEnd === "number",
		)
		.map((row) => ({
			id: String(row.id),
			file: String(row.sourceFile),
			startSeconds: round(Number(row.absStart)),
			durationSeconds: round(Number(row.absEnd) - Number(row.absStart)),
			variables: parseVariableDeclarations(read(String(row.sourceFile))),
		}))
		.sort((a, b) => a.startSeconds - b.startSeconds);

	const audio: AnimatedAudioClip[] = rows
		.filter(
			(row) =>
				typeof row.id === "string" &&
				typeof row.src === "string" &&
				typeof row.absStart === "number" &&
				typeof row.absEnd === "number" &&
				(row.kind === "audio" || (row.kind === "video" && row.trackKind === "audio")),
		)
		.map((row) => {
			const id = String(row.id);
			const src = String(row.src);
			return {
				id,
				src,
				startSeconds: round(Number(row.absStart)),
				durationSeconds: round(Number(row.absEnd) - Number(row.absStart)),
				...(typeof row.volume === "number" ? { volume: row.volume } : {}),
				role: audioRole(id, src, String(row.kind)),
			};
		})
		.sort((a, b) => a.startSeconds - b.startSeconds);

	const lastEnd = scenes.reduce(
		(end, scene) => Math.max(end, scene.startSeconds + scene.durationSeconds),
		0,
	);
	return {
		durationSeconds: round(timelineDuration(envelope) ?? lastEnd),
		scenes,
		globalVariables: parseVariableDeclarations(read("index.html")),
		audio,
	};
}
