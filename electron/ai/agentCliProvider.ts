// ── Local agent CLIs as text providers ───────────────────────────────────
//
// Lets every AI feature (chat, narration scripts, publish kit, polish, vision
// analysis) run on the user's own Claude Code or Codex install instead of an
// API key. Same idea as the AI Video Creator: their binary, their sign-in,
// their subscription — Guide Studio only hands over a prompt and reads the
// answer back.
//
// Each request is one headless, single-answer run in a throwaway folder:
//
//   claude -p --output-format json --model <id> [--append-system-prompt …]
//   codex exec --json --skip-git-repo-check --sandbox read-only --cd <tmp> -
//
// The prompt goes in on stdin, not argv. Planner prompts run past 64 KB, and
// Linux caps a single argument at 128 KB and Windows a whole command line at
// 32 KB. Both CLIs wait for stdin EOF before starting, so stdin is written
// and then closed — leaving it open is the silent hang described in
// claude-runtime/session.ts.
//
// Claude Code gets no tools for a text answer (one Read for an image, scoped
// to the folder holding it). Codex has no tool switch, so `--sandbox
// read-only` is the containment: it can't write or reach the network.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "../claude-runtime/agents";
import { explainCodexError } from "../claude-runtime/codexEvents";
import { type AgentInstallation, detectAgent } from "../claude-runtime/detect";
import { childEnv } from "../claude-runtime/session";
import { recordUsage } from "./tokenUsage";

/** Generous: CLI start-up plus a long Planner answer from a large model. */
const RUN_TIMEOUT_MS = 8 * 60 * 1000;

/** Every Claude Code tool a text answer has no business using. */
const CLAUDE_DENIED_TOOLS = [
	"Bash",
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookEdit",
	"WebFetch",
	"WebSearch",
	"Task",
	"TodoWrite",
	"Glob",
	"Grep",
	"LS",
];

export interface AgentCliRequest {
	prompt: string;
	systemPrompt?: string;
	/** Claude: always set (old installs default to a retired id). Codex: empty = the CLI's own default. */
	model?: string;
	/** Raw base64 image for vision requests. */
	imageBase64?: string;
	imageExt?: string;
}

// `--version` is cheap but not free, and the preflight check runs before every
// AI feature. A minute is short enough that installing a CLI shows up quickly.
const DETECT_TTL_MS = 60_000;
const detectCache = new Map<AgentId, { at: number; result: Promise<AgentInstallation> }>();

export function detectAgentCached(agent: AgentId): Promise<AgentInstallation> {
	const hit = detectCache.get(agent);
	if (hit && Date.now() - hit.at < DETECT_TTL_MS) return hit.result;
	const result = detectAgent(agent);
	detectCache.set(agent, { at: Date.now(), result });
	return result;
}

export function buildClaudeTextArgs(request: AgentCliRequest, imageFile?: string): string[] {
	const args = ["-p", "--output-format", "json", "--model", request.model || "claude-sonnet-5"];
	if (request.systemPrompt) args.push("--append-system-prompt", request.systemPrompt);
	// An image is the one thing that needs a tool: Read, to look at it.
	const denied = imageFile ? CLAUDE_DENIED_TOOLS : [...CLAUDE_DENIED_TOOLS, "Read"];
	args.push("--disallowedTools", denied.join(","));
	if (imageFile) args.push("--allowedTools", "Read");
	return args;
}

export function buildCodexTextArgs(cwd: string, model?: string, imageFile?: string): string[] {
	const args = [
		"exec",
		"--json",
		"--skip-git-repo-check",
		"--sandbox",
		"read-only",
		"--color",
		"never",
		"--cd",
		cwd,
	];
	// Never pin a model Codex wasn't asked for — see claude-runtime/agents.ts.
	if (model) args.push("--model", model);
	if (imageFile) args.push("--image", imageFile);
	args.push("-");
	return args;
}

/** Codex has no system-prompt flag, so the instructions lead the prompt. */
export function codexPrompt(prompt: string, systemPrompt?: string): string {
	const preamble =
		"Answer the request below directly in your final message. Do not run commands or edit files — everything you need is in this message.";
	return systemPrompt
		? `${preamble}\n\n<instructions>\n${systemPrompt}\n</instructions>\n\n${prompt}`
		: `${preamble}\n\n${prompt}`;
}

/** Pull the answer out of `claude -p --output-format json`. */
export function parseClaudeResult(stdout: string): {
	text?: string;
	error?: string;
	inputTokens?: number;
	outputTokens?: number;
} {
	const line = stdout
		.trim()
		.split("\n")
		.reverse()
		.find((l) => l.trim().startsWith("{"));
	if (!line) return { error: stdout.trim().slice(0, 400) || "Claude Code returned nothing." };
	try {
		const data = JSON.parse(line) as {
			is_error?: boolean;
			subtype?: string;
			result?: string;
			usage?: {
				input_tokens?: number;
				cache_creation_input_tokens?: number;
				cache_read_input_tokens?: number;
				output_tokens?: number;
			};
		};
		const usage = data.usage;
		const tokens = usage
			? {
					inputTokens:
						(usage.input_tokens ?? 0) +
						(usage.cache_creation_input_tokens ?? 0) +
						(usage.cache_read_input_tokens ?? 0),
					outputTokens: usage.output_tokens ?? 0,
				}
			: {};
		if (data.is_error || (data.subtype && data.subtype !== "success")) {
			return { error: data.result || `Claude Code stopped: ${data.subtype}`, ...tokens };
		}
		return { text: (data.result ?? "").trim(), ...tokens };
	} catch {
		return { error: line.slice(0, 400) };
	}
}

/** Pull the final agent message out of `codex exec --json`. */
export function parseCodexResult(stdout: string): {
	text?: string;
	error?: string;
	inputTokens?: number;
	outputTokens?: number;
} {
	let text: string | undefined;
	let error: string | undefined;
	let inputTokens: number | undefined;
	let outputTokens: number | undefined;
	for (const raw of stdout.split("\n")) {
		const line = raw.trim();
		if (!line.startsWith("{")) continue;
		let event: {
			type?: string;
			message?: string;
			item?: { type?: string; text?: string };
			usage?: { input_tokens?: number; output_tokens?: number };
			error?: { message?: string };
		};
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "item.completed" && event.item?.type === "agent_message") {
			text = event.item.text ?? text;
		} else if (event.type === "turn.completed" && event.usage) {
			inputTokens = event.usage.input_tokens;
			outputTokens = event.usage.output_tokens;
		} else if (event.type === "turn.failed") {
			error = event.error?.message ?? error;
		} else if (event.type === "error") {
			error = event.message ?? error;
		}
	}
	if (error) return { error: explainCodexError(unwrapApiError(error)), inputTokens, outputTokens };
	if (!text) return { error: "Codex finished without an answer." };
	return { text: text.trim(), inputTokens, outputTokens };
}

/** Codex wraps the upstream 400 body as a JSON string; surface its message. */
function unwrapApiError(message: string): string {
	try {
		const parsed = JSON.parse(message) as { error?: { message?: string } };
		return parsed.error?.message ?? message;
	} catch {
		return message;
	}
}

function runCli(
	binaryPath: string,
	args: string[],
	cwd: string,
	stdin: string,
	label: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(binaryPath, args, {
			cwd,
			env: childEnv(),
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 3_000).unref?.();
			reject(new Error(`${label} did not answer within ${RUN_TIMEOUT_MS / 60_000} minutes.`));
		}, RUN_TIMEOUT_MS);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-4000);
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(new Error(`Could not start ${label}: ${err.message}`));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		// Write the prompt, then close stdin — the CLI waits for EOF.
		child.stdin.on("error", () => {
			// EPIPE when the CLI exits before reading — the close handler reports why.
		});
		child.stdin.end(stdin);
	});
}

/** Run one prompt through the user's Claude Code or Codex and return the answer. */
export async function agentCliChat(agent: AgentId, request: AgentCliRequest): Promise<string> {
	const label = agent === "claude" ? "Claude Code" : "Codex";
	const install = await detectAgentCached(agent);
	if (!install.installed || !install.binaryPath) {
		detectCache.delete(agent);
		throw new Error(
			`${label} was not found on this machine. Install it (npm install -g ${
				agent === "claude" ? "@anthropic-ai/claude-code" : "@openai/codex"
			}), run \`${agent}\` once in a terminal to sign in, then try again.`,
		);
	}
	if (install.error) throw new Error(install.error);

	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), `guide-studio-${agent}-`));
	try {
		let imageFile: string | undefined;
		if (request.imageBase64) {
			imageFile = path.join(cwd, `image.${request.imageExt ?? "png"}`);
			await fs.writeFile(imageFile, Buffer.from(request.imageBase64, "base64"));
		}

		const startedAt = Date.now();
		let parsed: ReturnType<typeof parseClaudeResult>;
		let model: string;
		if (agent === "claude") {
			model = request.model || "claude-sonnet-5";
			const prompt = imageFile
				? `First use the Read tool on ${path.basename(imageFile)} (in the current folder) to view the image, then answer.\n\n${request.prompt}`
				: request.prompt;
			const run = await runCli(
				install.binaryPath,
				buildClaudeTextArgs({ ...request, model }, imageFile),
				cwd,
				prompt,
				label,
			);
			parsed = parseClaudeResult(run.stdout);
			if (!parsed.text && !parsed.error && run.code !== 0) {
				parsed.error = run.stderr.trim().slice(-400) || `${label} exited with code ${run.code}.`;
			}
		} else {
			model = request.model ?? "";
			const run = await runCli(
				install.binaryPath,
				buildCodexTextArgs(cwd, model, imageFile),
				cwd,
				codexPrompt(request.prompt, request.systemPrompt),
				label,
			);
			parsed = parseCodexResult(run.stdout);
			if (parsed.error === "Codex finished without an answer." && run.stderr.trim()) {
				parsed.error = explainCodexError(run.stderr.trim().slice(-400));
			}
		}

		console.log(
			`[aiService] ${label} ${model || "(default)"} → ${parsed.error ? "error" : "ok"} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
		);
		if (parsed.inputTokens !== undefined || parsed.outputTokens !== undefined) {
			recordUsage(
				agent === "claude" ? "claude-code" : "codex",
				model || "default",
				parsed.inputTokens ?? 0,
				parsed.outputTokens ?? 0,
			);
		}
		if (parsed.error) throw new Error(`${label}: ${parsed.error}`);
		if (!parsed.text) throw new Error(`${label} returned an empty answer.`);
		// Same think-tag strip the API path applies.
		return parsed.text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
	} finally {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {
			// Best effort — the OS clears its temp folder eventually.
		});
	}
}
