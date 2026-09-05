// ── Coding agents Guide Studio can drive ─────────────────────────────────
//
// The AI Video Creator never talks to a model API. It drives a CLI the user
// already installed and signed into, so the account, the quota, and the
// privacy posture are all theirs. Two are supported:
//
//   claude — Claude Code, on their Claude subscription
//   codex  — OpenAI Codex CLI, on their ChatGPT sign-in
//
// Everything downstream (workspace, brief, storyboard validation, render) is
// shared. Only three things actually differ per agent, and they all live in
// this file plus the two `codex*` modules beside it:
//
//   1. where the binary is installed and what `--version` prints
//   2. the argument list for a headless run
//   3. the shape of the streamed events we turn into the activity feed
//
// A fourth difference is worth stating plainly because it is a real change in
// what the run can do: Claude Code is given file tools only, with Bash denied.
// Codex has no such switch — it works *through* a shell — so it is confined
// instead by `--sandbox workspace-write`, which limits writes to the session
// folder and turns the network off. Both end up unable to touch anything
// outside the workspace; they get there by different means.

export type AgentId = "claude" | "codex";

export interface AgentModel {
	/** The value passed to `--model`. Empty string means "let the CLI decide". */
	id: string;
	label: string;
	hint?: string;
}

export interface AgentDescriptor {
	id: AgentId;
	/** Product name, as the user knows it. */
	label: string;
	/** Which sign-in pays for the run. Shown so nobody is surprised by a bill. */
	account: string;
	installCommand: string;
	/** The command that completes the login, run once in a terminal. */
	signInCommand: string;
	models: AgentModel[];
	/** The model chosen when the user has expressed no preference. */
	defaultModel: string;
	/** One line under the model picker explaining what the run costs and where. */
	note: string;
}

export const AGENTS: Record<AgentId, AgentDescriptor> = {
	claude: {
		id: "claude",
		label: "Claude Code",
		account: "Claude subscription",
		installCommand: "npm install -g @anthropic-ai/claude-code",
		signInCommand: "claude",
		// Pinned deliberately: older Claude Code builds default to a retired
		// model id and fail every request with a 404, so we always pass --model.
		models: [
			{ id: "claude-opus-5", label: "Opus 5", hint: "Most capable" },
			{ id: "claude-sonnet-5", label: "Sonnet 5", hint: "Faster, cheaper" },
		],
		defaultModel: "claude-opus-5",
		note: "Runs on your Claude subscription, through your own install.",
	},
	codex: {
		id: "codex",
		label: "Codex",
		account: "ChatGPT sign-in",
		installCommand: "npm install -g @openai/codex",
		signInCommand: "codex",
		// The opposite call to Claude's, for a reason we measured: Codex model
		// ids are tied to both the CLI version and the ChatGPT plan, and pinning
		// one that either side does not recognise fails the whole run with a
		// 400. An unpinned run asks the CLI for its own default, which is the
		// only id guaranteed to match the account it is signed into. Users who
		// want a specific model set it in `~/.codex/config.toml`, where it
		// survives CLI upgrades.
		models: [{ id: "", label: "Auto", hint: "Your Codex default" }],
		defaultModel: "",
		note: "Runs on your ChatGPT sign-in. Codex picks the model your plan allows — pin one in ~/.codex/config.toml if you need to.",
	},
};

export const AGENT_IDS: AgentId[] = ["claude", "codex"];

export function isAgentId(value: unknown): value is AgentId {
	return value === "claude" || value === "codex";
}

/** Narrow an untrusted value from IPC to an agent, defaulting to Claude. */
export function toAgentId(value: unknown): AgentId {
	return isAgentId(value) ? value : "claude";
}

export function agentLabel(agent: AgentId): string {
	return AGENTS[agent].label;
}
