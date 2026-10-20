// ── AI Video Creator IPC ─────────────────────────────────────────────────
//
// The renderer never sees a binary path, a workspace path, or a child
// process — it sends a request and receives sessions. Everything that can
// touch the filesystem or spawn an agent CLI stays in main.
//
// The channel names still say "claude" because they are the feature's names,
// not the vendor's, and renaming a wire protocol nothing else could see would
// only churn every call site. Detection is the exception: `agent-detect`
// answers for every supported CLI at once, which is what the window needs to
// offer the ones that are ready and explain how to get the others, and it
// replaced a Claude-only channel that nothing calls any more.

import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { toAgentId } from "../claude-runtime/agents";
import { CREATIVE_SKILL_IDS, type CreativeSkillId } from "../claude-runtime/creativeSkills";
import {
	type CreatorFinishingInput,
	type CreatorSession,
	cancelSession,
	clearSessionMedia,
	createSessionInterchange,
	createSessionMaster,
	discardSession,
	getSession,
	initializeCreatorStore,
	listSessions,
	planStoryboard,
	previewStoryboard,
	renderStoryboard,
	reviewSessionShots,
	setSessionFinishing,
} from "../claude-runtime/creator";
import { detectAgents } from "../claude-runtime/detect";
import type { ClaudeActivity } from "../claude-runtime/events";
import { VIDEO_SKILLS } from "../claude-runtime/skills";

/** Sessions live under userData so a workspace survives a crash mid-run. */
function baseDir() {
	return path.join(app.getPath("userData"), "claude-runtime");
}

function broadcast(channel: string, payload: unknown) {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(channel, payload);
	}
}

function fail(error: unknown) {
	return { success: false as const, error: error instanceof Error ? error.message : String(error) };
}

function ok(session: CreatorSession) {
	return { success: true as const, session };
}

export function registerClaudeHandlers(): void {
	initializeCreatorStore(baseDir());
	// ── Setup ──
	ipcMain.handle("agent-detect", async () => {
		try {
			return { success: true, agents: await detectAgents() };
		} catch (error) {
			return fail(error);
		}
	});

	ipcMain.handle("claude-skills", () => ({
		success: true,
		skills: VIDEO_SKILLS.map(({ id, name, description }) => ({ id, name, description })),
		creativeSkills: CREATIVE_SKILL_IDS,
	}));

	// ── Stage 1: plan ──
	ipcMain.handle(
		"claude-plan",
		async (
			_event,
			input: {
				request: string;
				agent?: "claude" | "codex";
				format?: "landscape" | "vertical" | "square";
				targetSeconds?: number;
				model?: string;
				look?: "motion" | "cards" | "whiteboard";
				creativeSkill?: CreativeSkillId;
				visualSource?: "stock" | "generated";
				referenceAssetIds?: string[];
			},
		) => {
			if (!input?.request?.trim()) {
				return { success: false, error: "Describe the video you want first." };
			}
			try {
				// The agent decides which binary gets spawned, so it is narrowed
				// here rather than trusted from the renderer.
				const plan = { ...input, agent: toAgentId(input.agent) };
				const session = await planStoryboard(baseDir(), plan, (activity: ClaudeActivity) => {
					broadcast("claude-activity", activity);
				});
				return ok(session);
			} catch (error) {
				return fail(error);
			}
		},
	);

	// ── Stage 2: preview stills ──
	ipcMain.handle("claude-preview", async (_event, sessionId: string) => {
		try {
			return ok(await previewStoryboard(sessionId));
		} catch (error) {
			return fail(error);
		}
	});

	// ── Stage 2.5: human shot review ──
	ipcMain.handle("claude-review-shots", async (_event, sessionId: string, updates: unknown) => {
		if (typeof sessionId !== "string" || sessionId.length > 100) {
			return { success: false, error: "That session id is invalid." };
		}
		try {
			return ok(reviewSessionShots(sessionId, updates));
		} catch (error) {
			return fail(error);
		}
	});

	// ── Stage 2.75: production finishing ──
	ipcMain.handle("claude-set-finishing", async (_event, sessionId: string, input: unknown) => {
		if (typeof sessionId !== "string" || sessionId.length > 100) {
			return { success: false, error: "That session id is invalid." };
		}
		try {
			return ok(setSessionFinishing(sessionId, input as CreatorFinishingInput));
		} catch (error) {
			return fail(error);
		}
	});

	// ── Stage 3: render ──
	ipcMain.handle("claude-render", async (_event, sessionId: string) => {
		try {
			const session = await renderStoryboard(sessionId, (percent) => {
				broadcast("claude-render-progress", { sessionId, percent });
			});
			return ok(session);
		} catch (error) {
			return fail(error);
		}
	});

	ipcMain.handle("claude-create-master", async (_event, sessionId: string) => {
		try {
			return ok(await createSessionMaster(sessionId));
		} catch (error) {
			return fail(error);
		}
	});

	ipcMain.handle("claude-create-interchange", async (_event, sessionId: string) => {
		try {
			return ok(createSessionInterchange(sessionId));
		} catch (error) {
			return fail(error);
		}
	});

	// ── Session management ──
	ipcMain.handle("claude-session", (_event, sessionId: string) => {
		const session = getSession(sessionId);
		return session
			? ok(session)
			: { success: false, error: "That session is no longer available." };
	});

	ipcMain.handle("claude-sessions", () => ({ success: true, sessions: listSessions() }));

	ipcMain.handle("claude-cancel", (_event, sessionId: string) => ({
		success: cancelSession(sessionId),
	}));

	ipcMain.handle("claude-discard", (_event, sessionId: string) => {
		discardSession(sessionId);
		return { success: true };
	});

	ipcMain.handle("claude-clear-media", (_event, sessionId: string) => {
		try {
			return ok(clearSessionMedia(sessionId));
		} catch (error) {
			return fail(error);
		}
	});
}
