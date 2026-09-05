// ── Codex session runner ─────────────────────────────────────────────────
//
// The Codex half of the agent contract. It produces the same result shape as
// `runClaude` and reuses the same process plumbing; only the argument list
// and the stream parser are its own.
//
// Two things about this run are worth stating, because they are the places
// Codex genuinely differs from Claude Code rather than merely spelling a flag
// differently:
//
// **The sandbox is the tool policy.** Codex has no allow/deny tool list — it
// does its work by running shell commands, so denying the shell would deny
// the run. `--sandbox workspace-write` is the equivalent guarantee: writes
// are confined to the working directory and network access is off. With
// `--cd` pointed at the session folder, the reachable surface ends up the
// same as Claude's file-tool sandbox, arrived at from the other direction.
// The agent *can* run commands inside that folder, which Claude's run cannot;
// the creator window says so rather than leaving it to be discovered.
//
// **The model is not pinned by default.** This is the opposite of the Claude
// rule and for the same underlying reason — a model id that the far side does
// not recognise fails the whole run. Codex model ids are tied to both the CLI
// version and the ChatGPT plan, so any id we hard-code here is wrong for
// somebody: an older CLI rejects a new id, and a plan without access rejects
// it too (both observed, both a bare 400). Passing no `--model` asks the CLI
// for the default that matches the account it is signed into, which is the
// only choice that stays correct as either side moves.

import { consumeCodexChunk, explainCodexError } from "./codexEvents";
import type { ClaudeActivity } from "./events";
import { DEFAULT_TIMEOUT_MS, type RunClaudeResult, runAgentProcess } from "./session";
import type { WorkspacePaths } from "./workspace";

export interface RunCodexOptions {
	binaryPath: string;
	workspace: WorkspacePaths;
	prompt: string;
	/** Empty or omitted leaves the choice to the CLI, which is the default. */
	model?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	onActivity?: (activity: ClaudeActivity) => void;
}

/** Build the argument list. Pure, so the shape is unit-testable. */
export function buildCodexArgs(prompt: string, workspaceRoot: string, model?: string): string[] {
	return [
		"exec",
		// One JSON envelope per line, the same streaming contract the activity
		// feed already consumes for Claude.
		"--json",
		// Writes confined to the working directory, network off. In `exec` there
		// is no one to answer an approval prompt, so the sandbox has to be the
		// thing that holds.
		"--sandbox",
		"workspace-write",
		"--cd",
		workspaceRoot,
		// A session workspace is a plain directory under userData. Without this
		// Codex refuses to run outside a git repo.
		"--skip-git-repo-check",
		...(model ? ["--model", model] : []),
		prompt,
	];
}

export async function runCodex(options: RunCodexOptions): Promise<RunClaudeResult> {
	return await runAgentProcess({
		agent: "codex",
		binaryPath: options.binaryPath,
		args: buildCodexArgs(options.prompt, options.workspace.root, options.model),
		cwd: options.workspace.root,
		consume: consumeCodexChunk,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		explainError: explainCodexError,
		...(options.signal ? { signal: options.signal } : {}),
		...(options.onActivity ? { onActivity: options.onActivity } : {}),
	});
}
