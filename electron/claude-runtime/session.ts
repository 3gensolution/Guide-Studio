// ── Agent session runner ─────────────────────────────────────────────────
//
// Spawns an agent CLI in headless mode against a session workspace and
// streams its activity back. Guide Studio is the orchestrator here: it owns
// the brief, the sandbox, the tool policy, and the validation of what comes
// back. The agent owns the thinking.
//
// `runAgentProcess` is the part both agents share — spawn, stream, timeout,
// cancel, settle — parameterised by the two things that actually differ: the
// argument list and the line parser. Claude's run is below; Codex's lives in
// `codexSession.ts`.
//
// The Claude run is deliberately constrained:
//   * cwd and `--add-dir` are the session folder, so file tools cannot reach
//     the user's projects
//   * Bash, WebSearch, WebFetch, and Task are denied outright
//   * `--model` is always explicit, because older Claude Code builds default
//     to a retired model id and fail the request with a 404
//   * a wall-clock timeout kills a run that stops making progress

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { type AgentId, agentLabel } from "./agents";
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

/** What a parser does with a chunk: emit activities, keep the partial line. */
export type ChunkConsumer = (
	buffer: string,
	chunk: string,
) => { activities: ClaudeActivity[]; buffer: string };

export interface RunAgentProcessOptions {
	agent: AgentId;
	binaryPath: string;
	args: string[];
	cwd: string;
	consume: ChunkConsumer;
	timeoutMs: number;
	signal?: AbortSignal;
	onActivity?: (activity: ClaudeActivity) => void;
	/** Last chance to make a raw CLI failure actionable. */
	explainError?: (message: string | undefined) => string | undefined;
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

/**
 * Spawn an agent CLI, stream its stdout through `consume`, and settle once it
 * closes, is cancelled, or runs out of wall clock. Everything agent-specific
 * arrives as an argument; nothing in here knows which CLI it is running.
 */
export async function runAgentProcess(options: RunAgentProcessOptions): Promise<RunClaudeResult> {
	const label = agentLabel(options.agent);

	return await new Promise<RunClaudeResult>((resolve) => {
		const child = spawn(options.binaryPath, options.args, {
			cwd: options.cwd,
			env: childEnv(),
			windowsHide: true,
			// stdin MUST be closed, not piped. In headless mode both CLIs read
			// stdin for piped input and wait for EOF before they start; Node's
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
		}, options.timeoutMs);

		const onAbort = () => {
			cancelled = true;
			stop();
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		const absorb = (activities: ClaudeActivity[]) => {
			for (const activity of activities) {
				if (activity.kind === "finished") {
					summary = activity.summary;
					if (activity.costUsd !== undefined) costUsd = activity.costUsd;
					if (activity.durationMs !== undefined) durationMs = activity.durationMs;
					if (!activity.ok) sawFailure = true;
				}
				options.onActivity?.(activity);
			}
		};

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			const { activities, buffer } = options.consume(stdoutBuffer, chunk);
			stdoutBuffer = buffer;
			absorb(activities);
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
				error: `Could not start ${label}: ${error.message}`,
				cancelled,
				timedOut,
			});
		});

		child.on("close", (code) => {
			// A trailing line with no newline still carries the result envelope.
			if (stdoutBuffer.trim()) {
				absorb(options.consume(stdoutBuffer, "\n").activities);
			}

			const ok = code === 0 && !sawFailure && !cancelled && !timedOut;
			const rawError = timedOut
				? `${label} did not finish within ${Math.round(options.timeoutMs / 60000)} minutes.`
				: cancelled
					? "Cancelled."
					: summary || stderrTail.trim() || `${label} exited with code ${code}.`;
			finish({
				ok,
				exitCode: code,
				...(summary ? { summary } : {}),
				...(costUsd !== undefined ? { costUsd } : {}),
				...(durationMs !== undefined ? { durationMs } : {}),
				...(ok ? {} : { error: options.explainError?.(rawError) ?? rawError }),
				cancelled,
				timedOut,
			});
		});
	});
}

export async function runClaude(options: RunClaudeOptions): Promise<RunClaudeResult> {
	const model = options.model || DEFAULT_MODEL;
	return await runAgentProcess({
		agent: "claude",
		binaryPath: options.binaryPath,
		args: buildArgs(options.prompt, options.workspace.root, model),
		cwd: options.workspace.root,
		consume: consumeChunk,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		...(options.signal ? { signal: options.signal } : {}),
		...(options.onActivity ? { onActivity: options.onActivity } : {}),
	});
}

/** Read the storyboard the agent was asked to write. Missing file is a normal failure. */
export function readStoryboardFile(
	paths: WorkspacePaths,
	agent: AgentId = "claude",
): { raw?: unknown; error?: string } {
	if (!fs.existsSync(paths.storyboardPath)) {
		return { error: `${agentLabel(agent)} finished without writing output/storyboard.json.` };
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
