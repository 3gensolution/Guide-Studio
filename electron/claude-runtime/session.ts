// ── Claude session runner ────────────────────────────────────────────────
//
// Spawns the user's Claude Code in headless mode against a session workspace
// and streams its activity back. Guide Studio is the orchestrator here: it
// owns the brief, the sandbox, the tool allowlist, and the validation of what
// comes back. Claude owns the thinking.
//
// The run is deliberately constrained:
//   * cwd and `--add-dir` are the session folder, so file tools cannot reach
//     the user's projects
//   * Bash, WebSearch, WebFetch, and Task are denied outright
//   * `--model` is always explicit, because older Claude Code builds default
//     to a retired model id and fail the request with a 404
//   * a wall-clock timeout kills a run that stops making progress

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { augmentedPathEnv } from "./detect";
import { type ClaudeActivity, consumeChunk } from "./events";
import type { WorkspacePaths } from "./workspace";

/** File tools only, scoped to the session folder. */
export const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"] as const;
export const DENIED_TOOLS = ["Bash", "WebSearch", "WebFetch", "Task", "NotebookEdit"] as const;

export const DEFAULT_MODEL = "claude-opus-5";
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface RunClaudeOptions {
	binaryPath: string;
	workspace: WorkspacePaths;
	prompt: string;
	model?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	onActivity?: (activity: ClaudeActivity) => void;
}

export interface RunClaudeResult {
	ok: boolean;
	exitCode: number | null;
	/** Claude's own closing summary, when the run reached a result envelope. */
	summary?: string;
	costUsd?: number;
	durationMs?: number;
	error?: string;
	cancelled: boolean;
	timedOut: boolean;
}

/** Build the argument list. Pure, so the shape is unit-testable. */
export function buildArgs(prompt: string, workspaceRoot: string, model: string): string[] {
	return [
		"-p",
		prompt,
		"--output-format",
		"stream-json",
		// stream-json in print mode only emits the full envelope stream with
		// --verbose; without it the CLI collapses the run to a final message.
		"--verbose",
		"--model",
		model,
		// File writes are the whole point of the run, and the tool allowlist is
		// what actually constrains it — prompting per edit would just stall.
		"--permission-mode",
		"acceptEdits",
		"--allowedTools",
		...ALLOWED_TOOLS,
		"--disallowedTools",
		...DENIED_TOOLS,
		"--add-dir",
		workspaceRoot,
	];
}

/**
 * The child's environment. Claude Code authenticates as the user, so their
 * environment is inherited wholesale — with two corrections: PATH is widened
 * for GUI launches, and ELECTRON_RUN_AS_NODE is stripped so the CLI's own
 * node resolution is not hijacked by our process.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...base };
	delete env.ELECTRON_RUN_AS_NODE;
	env.PATH = augmentedPathEnv(process.platform, os.homedir(), base.PATH);
	return env;
}

export async function runClaude(options: RunClaudeOptions): Promise<RunClaudeResult> {
	const model = options.model ?? DEFAULT_MODEL;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const args = buildArgs(options.prompt, options.workspace.root, model);

	return await new Promise<RunClaudeResult>((resolve) => {
		const child = spawn(options.binaryPath, args, {
			cwd: options.workspace.root,
			env: childEnv(),
			windowsHide: true,
			// stdin MUST be closed, not piped. In print mode Claude Code reads
			// stdin for piped input and waits for EOF before it starts; Node's
			// default "pipe" stdin never closes on its own, so the run hangs
			// silently — no output, no error, until the timeout fires.
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdoutBuffer = "";
		let stderrTail = "";
		let summary: string | undefined;
		let costUsd: number | undefined;
		let durationMs: number | undefined;
		let sawFailure = false;
		let cancelled = false;
		let timedOut = false;
		let settled = false;

		const finish = (result: RunClaudeResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};

		const stop = () => {
			// SIGTERM first; the CLI flushes its result envelope on it. The kill
			// below is the backstop for a process that ignores it.
			child.kill("SIGTERM");
			setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, 3_000).unref?.();
		};

		const timer = setTimeout(() => {
			timedOut = true;
			stop();
		}, timeoutMs);

		const onAbort = () => {
			cancelled = true;
			stop();
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			const { activities, buffer } = consumeChunk(stdoutBuffer, chunk);
			stdoutBuffer = buffer;
			for (const activity of activities) {
				if (activity.kind === "finished") {
					summary = activity.summary;
					costUsd = activity.costUsd;
					durationMs = activity.durationMs;
					if (!activity.ok) sawFailure = true;
				}
				options.onActivity?.(activity);
			}
		});

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderrTail = (stderrTail + chunk).slice(-2000);
			const text = chunk.trim();
			if (text) options.onActivity?.({ kind: "log", text: text.slice(0, 500) });
		});

		child.on("error", (error) => {
			finish({
				ok: false,
				exitCode: null,
				error: `Could not start Claude Code: ${error.message}`,
				cancelled,
				timedOut,
			});
		});

		child.on("close", (code) => {
			// A trailing line with no newline still carries the result envelope.
			if (stdoutBuffer.trim()) {
				const { activities } = consumeChunk(stdoutBuffer, "\n");
				for (const activity of activities) {
					if (activity.kind === "finished") {
						summary = activity.summary;
						costUsd = activity.costUsd;
						if (!activity.ok) sawFailure = true;
					}
					options.onActivity?.(activity);
				}
			}

			const ok = code === 0 && !sawFailure && !cancelled && !timedOut;
			finish({
				ok,
				exitCode: code,
				...(summary ? { summary } : {}),
				...(costUsd !== undefined ? { costUsd } : {}),
				...(durationMs !== undefined ? { durationMs } : {}),
				...(ok
					? {}
					: {
							error: timedOut
								? `Claude Code did not finish within ${Math.round(timeoutMs / 60000)} minutes.`
								: cancelled
									? "Cancelled."
									: (summary ?? stderrTail.trim() ?? `Claude Code exited with code ${code}.`),
						}),
				cancelled,
				timedOut,
			});
		});
	});
}

/** Read the storyboard Claude was asked to write. Missing file is a normal failure. */
export function readStoryboardFile(paths: WorkspacePaths): { raw?: unknown; error?: string } {
	if (!fs.existsSync(paths.storyboardPath)) {
		return { error: "Claude finished without writing output/storyboard.json." };
	}
	let text: string;
	try {
		text = fs.readFileSync(paths.storyboardPath, "utf8");
	} catch (error) {
		return { error: error instanceof Error ? error.message : "Could not read the storyboard." };
	}
	if (!text.trim()) return { error: "The storyboard file was empty." };
	return { raw: text };
}
