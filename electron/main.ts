import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	protocol,
	session,
	shell,
	systemPreferences,
	Tray,
} from "electron";
import { ShortcutBinding } from "../src/lib/shortcuts";
import {
	loadAndRegisterGlobalShortcut,
	registerOpenAppShortcut,
	unregisterAllGlobalShortcuts,
} from "./globalShortcut";
import { mainT, setMainLocale } from "./i18n";
import { registerAIHandlers } from "./ipc/aiHandlers";
import { registerCaptureHandlers } from "./ipc/captureHandlers";
import { registerDemoHandlers } from "./ipc/demoHandlers";
import { registerExportHandlers } from "./ipc/exportHandlers";
import { registerFfmpegHandlers } from "./ipc/ffmpegHandlers";
import { getSelectedDesktopSource, registerIpcHandlers } from "./ipc/handlers";
import { registerProjectHandlers } from "./ipc/projectHandlers";
import { registerSettingsHandlers } from "./ipc/settingsHandlers";
import { registerShowcaseHandlers } from "./ipc/showcaseHandlers";
import { registerStudioCacheHandlers } from "./ipc/studioCacheHandlers";
import { registerUpdaterHandlers } from "./ipc/updaterHandlers";
import { registerWhisperHandlers } from "./ipc/whisperHandlers";
import { registerYouTubeHandlers } from "./ipc/youtubeHandlers";
import { getCachedSetting, loadSettings, setSetting } from "./settings";
import { checkForUpdates, setUpdateChannel, type UpdateChannel } from "./updater";
import {
	createCountdownOverlayWindow,
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
} from "./windows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use Screen & System Audio Recording permissions instead of the CoreAudio Tap API on macOS.
// Tap needs NSAudioCaptureUsageDescription in the parent app's Info.plist, which breaks when
// running from a terminal/IDE during dev.
if (process.platform === "darwin") {
	app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

// Wayland support for screen capture and window management on Wayland compositors.
if (process.platform === "linux") {
	const isWayland =
		process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY !== undefined;
	if (isWayland) {
		app.commandLine.appendSwitch("ozone-platform", "wayland");
		// Enable WebRTCPipeWireCapturer for screen capture on Wayland
		app.commandLine.appendSwitch("enable-features", "WaylandWindowDrag,WebRTCPipeWireCapturer");
	}
}

// Dev-mode only: expose Chrome DevTools Protocol on :9222 so an external CLI
// driver can trigger the bench harness via Runtime.evaluate without needing a
// human at devtools. Safe to leave enabled in dev because localhost only;
// absolutely must not run in packaged builds.
if (!app.isPackaged) {
	app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

export const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// ── Multi-window state ────────────────────────────────────────────────
//
// `editorWindows` is the canonical set of open editor windows. Use the
// helpers (`getFocusedEditorWindow`, `getFirstEditorWindow`,
// `getEditorWindowFromEvent`) to find the right window in any handler --
// never reach for a global "main" reference because there isn't one.
//
// Use cases that drive multi-window:
//   1. Agency / freelancer multi-client -- Window A on Brand A, Window B on
//      Brand B, generate in parallel.
//   2. Dogfood recording -- Window A runs the AI Generator while Window B
//      records it via desktopCapturer to produce a demo of the tool.
const editorWindows = new Set<BrowserWindow>();

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let countdownOverlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let selectedSourceName = "";
const isMac = process.platform === "darwin";
const trayIconSize = isMac ? 16 : 24;

// Tray Icons
const defaultTrayIcon = getTrayIcon("guide-logo.png", trayIconSize);
const recordingTrayIcon = getTrayIcon("rec-button.png", trayIconSize);

/** Returns the focused editor window, or any open editor as a fallback,
 *  or null if there are none. Prefer this over reaching for a "main"
 *  window because the user may have several windows open. */
function getFocusedEditorWindow(): BrowserWindow | null {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused && editorWindows.has(focused) && !focused.isDestroyed()) {
		return focused;
	}
	for (const win of editorWindows) {
		if (!win.isDestroyed()) return win;
	}
	// Fall back to mainWindow (HUD overlay) if no editor windows exist
	if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
	return null;
}

/** Returns the first open editor window, or null if there are none. */
function getFirstEditorWindow(): BrowserWindow | null {
	for (const win of editorWindows) {
		if (!win.isDestroyed()) return win;
	}
	return null;
}

function createWindow() {
	mainWindow = createHudOverlayWindow();
}

function showMainWindow() {
	// First try to show an existing editor window
	const existing = getFocusedEditorWindow();
	if (existing && existing !== mainWindow) {
		if (existing.isMinimized()) existing.restore();
		existing.show();
		existing.focus();
		return;
	}

	// Fall back to HUD overlay window
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.show();
		mainWindow.focus();
		return;
	}

	createWindow();
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as" | "menu-new-project",
) {
	let targetWindow: BrowserWindow | null = BrowserWindow.getFocusedWindow();
	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		targetWindow = getFirstEditorWindow();
	}

	if (!targetWindow) {
		// No editor open at all -- spawn one and forward the action once it loads
		const newWin = createEditorWindowWrapper();
		if (!newWin) return;
		newWin.webContents.once("did-finish-load", () => {
			if (!newWin.isDestroyed()) newWin.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

/** Build a list of menu items, one per open editor window, that focus
 *  that window when clicked. Lets the user jump between windows from
 *  the Window menu without alt-tabbing. */
function buildOpenWindowMenuItems(): Electron.MenuItemConstructorOptions[] {
	const items: Electron.MenuItemConstructorOptions[] = [];
	let index = 1;
	for (const win of editorWindows) {
		if (win.isDestroyed()) continue;
		const title = win.getTitle() || `Window ${index}`;
		items.push({
			label: `${index}. ${title}`,
			click: () => {
				if (!win.isDestroyed()) {
					if (win.isMinimized()) win.restore();
					win.show();
					win.focus();
				}
			},
		});
		index++;
	}
	if (items.length === 0) {
		items.push({ label: "(no editor windows)", enabled: false });
	}
	return items;
}

function triggerManualUpdateCheck() {
	checkForUpdates({ manual: true }).catch(() => {
		/* intentional no-op */
	});
}

function handleChannelSelect(channel: UpdateChannel) {
	const isPro = getCachedSetting("licenseTier") === "pro";
	if (channel === "beta" && !isPro) {
		dialog
			.showMessageBox({
				type: "info",
				title: "Pro Feature",
				message: "Beta releases are a Pro feature.",
				detail:
					"Pro subscribers get early access to new features through the Beta channel. " +
					"Upgrade to Pro from Settings to opt in.",
				buttons: ["OK", "Learn More"],
				defaultId: 0,
			})
			.then((result) => {
				if (result.response === 1) {
					shell.openExternal("https://guidestudio.app/pro");
				}
			});
		// Rebuild menu so the checkmark stays on "Stable".
		setupApplicationMenu();
		return;
	}
	setUpdateChannel(channel);
	setSetting("updateChannel", channel).catch(() => {
		/* intentional no-op */
	});
	setupApplicationMenu();
}

function setupApplicationMenu() {
	const template: Electron.MenuItemConstructorOptions[] = [];
	const currentChannel: UpdateChannel = getCachedSetting("updateChannel") ?? "latest";

	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{
					role: "about",
					label: mainT("common", "actions.about") || "About Guide Studio",
				},
				{
					label: "Check for Updates\u2026",
					click: triggerManualUpdateCheck,
				},
				{ type: "separator" },
				{
					role: "services",
					label: mainT("common", "actions.services") || "Services",
				},
				{ type: "separator" },
				{
					role: "hide",
					label: mainT("common", "actions.hide") || "Hide Guide Studio",
				},
				{
					role: "hideOthers",
					label: mainT("common", "actions.hideOthers") || "Hide Others",
				},
				{
					role: "unhide",
					label: mainT("common", "actions.unhide") || "Show All",
				},
				{ type: "separator" },
				{ role: "quit", label: mainT("common", "actions.quit") || "Quit" },
			],
		});
	}

	template.push(
		{
			label: mainT("common", "actions.file") || "File",
			submenu: [
				{
					label: "New Window",
					accelerator: "CmdOrCtrl+Shift+T",
					click: () => {
						createEditorWindowWrapper();
					},
				},
				{
					label: "Open Window for Recording\u2026",
					click: () => {
						const target = getFocusedEditorWindow();
						if (target) target.webContents.send("menu-open-window-for-recording");
					},
				},
				{ type: "separator" },
				{
					label: mainT("dialogs", "unsavedChanges.newProject") || "New Project",
					accelerator: "CmdOrCtrl+N",
					click: () => sendEditorMenuAction("menu-new-project"),
				},
				{
					label: "Create Video",
					accelerator: "CmdOrCtrl+Shift+N",
					click: () => {
						const target = getFocusedEditorWindow();
						if (target) target.webContents.send("menu-create-video");
					},
				},
				{ type: "separator" },
				{
					label: "Open Video File\u2026",
					click: () => {
						const target = getFocusedEditorWindow();
						if (target) target.webContents.send("menu-open-video");
					},
				},
				{
					label: mainT("dialogs", "unsavedChanges.loadProject") || "Load Project\u2026",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: "Recent Projects\u2026",
					click: () => {
						const target = getFocusedEditorWindow();
						if (target) target.webContents.send("menu-recent-projects");
					},
				},
				{ type: "separator" },
				{
					label: mainT("dialogs", "unsavedChanges.saveProject") || "Save Project\u2026",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProjectAs") || "Save Project As\u2026",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac
					? []
					: [
							{ type: "separator" as const },
							{
								role: "quit" as const,
								label: mainT("common", "actions.quit") || "Quit",
							},
						]),
			],
		},
		{
			label: mainT("common", "actions.edit") || "Edit",
			submenu: [
				{ role: "undo", label: mainT("common", "actions.undo") || "Undo" },
				{ role: "redo", label: mainT("common", "actions.redo") || "Redo" },
				{ type: "separator" },
				{ role: "cut", label: mainT("common", "actions.cut") || "Cut" },
				{ role: "copy", label: mainT("common", "actions.copy") || "Copy" },
				{ role: "paste", label: mainT("common", "actions.paste") || "Paste" },
				{
					role: "selectAll",
					label: mainT("common", "actions.selectAll") || "Select All",
				},
			],
		},
		{
			label: mainT("common", "actions.view") || "View",
			submenu: [
				{
					role: "reload",
					label: mainT("common", "actions.reload") || "Reload",
				},
				{
					role: "forceReload",
					label: mainT("common", "actions.forceReload") || "Force Reload",
				},
				{
					role: "toggleDevTools",
					label: mainT("common", "actions.toggleDevTools") || "Toggle Developer Tools",
				},
				{ type: "separator" },
				{
					role: "resetZoom",
					label: mainT("common", "actions.actualSize") || "Actual Size",
				},
				{
					role: "zoomIn",
					label: mainT("common", "actions.zoomIn") || "Zoom In",
				},
				{
					role: "zoomOut",
					label: mainT("common", "actions.zoomOut") || "Zoom Out",
				},
				{ type: "separator" },
				{
					role: "togglefullscreen",
					label: mainT("common", "actions.toggleFullScreen") || "Toggle Full Screen",
				},
			],
		},
		{
			label: mainT("common", "actions.window") || "Window",
			submenu: [
				{
					label: "New Window",
					accelerator: "CmdOrCtrl+Shift+T",
					click: () => {
						createEditorWindowWrapper();
					},
				},
				{ type: "separator" as const },
				...(isMac
					? ([
							{
								role: "minimize",
								label: mainT("common", "actions.minimize") || "Minimize",
							},
							{ role: "zoom" },
							{ type: "separator" },
							{ role: "front" },
						] as Electron.MenuItemConstructorOptions[])
					: ([
							{
								role: "minimize",
								label: mainT("common", "actions.minimize") || "Minimize",
							},
							{
								role: "close",
								label: mainT("common", "actions.close") || "Close",
							},
						] as Electron.MenuItemConstructorOptions[])),
				{ type: "separator" as const },
				...buildOpenWindowMenuItems(),
			],
		},
		{
			label: "Help",
			submenu: [
				// On macOS, Check for Updates lives in the app menu per Apple HIG.
				// On Windows/Linux, it's here.
				...(!isMac
					? ([
							{
								label: "Check for Updates\u2026",
								click: triggerManualUpdateCheck,
							},
							{ type: "separator" as const },
						] as Electron.MenuItemConstructorOptions[])
					: []),
				{
					label: "Release Channel",
					submenu: [
						{
							label: "Stable",
							type: "radio",
							checked: currentChannel === "latest",
							click: () => handleChannelSelect("latest"),
						},
						{
							label: getCachedSetting("licenseTier") === "pro" ? "Beta" : "Beta (Pro)",
							type: "radio",
							checked: currentChannel === "beta",
							click: () => handleChannelSelect("beta"),
						},
					],
				},
				{ type: "separator" },
				{
					label: "Documentation",
					click: () => shell.openExternal("https://guidestudio.app/docs"),
				},
				{
					label: "Report a Bug",
					click: () => shell.openExternal("https://guidestudio.app/support"),
				},
				{ type: "separator" },
				{ role: "toggleDevTools" },
				{
					label: "Restart Guide Studio",
					click: () => {
						app.relaunch();
						app.exit(0);
					},
				},
				...(!isMac
					? ([
							{ type: "separator" as const },
							{
								label: "About Guide Studio",
								click: () => {
									dialog
										.showMessageBox({
											type: "info",
											title: "About Guide Studio",
											message: "Guide Studio",
											detail:
												"AI-powered screen recording and editing.\n\n" +
												`Version ${app.getVersion()}\n` +
												"https://guidestudio.app",
											buttons: ["OK", "Visit Website"],
											defaultId: 0,
										})
										.then((result) => {
											if (result.response === 1) {
												shell.openExternal("https://guidestudio.app");
											}
										});
								},
							},
						] as Electron.MenuItemConstructorOptions[])
					: []),
			],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createTray() {
	tray = new Tray(defaultTrayIcon);
	tray.on("click", () => {
		showMainWindow();
	});
	tray.on("double-click", () => {
		showMainWindow();
	});
}

function getTrayIcon(filename: string, size: number) {
	return nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename))
		.resize({
			width: size,
			height: size,
			quality: "best",
		});
}

/**
 * Restart / reload the app.
 *
 * Behavior depends on environment:
 * - **Production**: full app restart via `app.relaunch() + app.exit()`.
 *   Picks up everything (main, preload, renderer).
 * - **Dev**: hard-reload the renderer only. A true relaunch is impossible
 *   in dev because vite-plugin-electron kills the Vite dev server when
 *   Electron exits, and the new Electron process has nothing to connect
 *   to (black screen). Instead we reload the renderer (which picks up
 *   the latest bundle + Vite HMR) and tell the user how to restart main
 *   process changes.
 *
 * If the editor has unsaved changes, prompts the user first.
 */
function restartApp() {
	const isDev = !app.isPackaged;

	if (isDev) {
		for (const win of editorWindows) {
			if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
		}
		console.log(
			"[Tray] Dev mode reload -- renderer refreshed. Main process unchanged. " +
				"Save a main process file to trigger auto-restart, or quit fully to relaunch.",
		);
		return;
	}

	// Production: full app relaunch
	if (anyEditorHasUnsavedChanges()) {
		const target = getFocusedEditorWindow();
		if (target) {
			const choice = dialog.showMessageBoxSync(target, {
				type: "warning",
				buttons: ["Restart Anyway", "Cancel"],
				defaultId: 1,
				cancelId: 1,
				title: "Restart Guide Studio",
				message: "You have unsaved changes that will be lost.",
				detail: "Restart and discard changes?",
			});
			if (choice !== 0) return;
		}
	}
	isForceClosing = true;
	app.relaunch();
	app.exit(0);
}

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
	const trayToolTip = recording
		? mainT("common", "actions.recordingStatus", {
				source: selectedSourceName,
			}) || `Recording: ${selectedSourceName}`
		: "Guide Studio";
	const menuTemplate = recording
		? [
				{
					label: mainT("common", "actions.stopRecording") || "Stop Recording",
					click: () => {
						// Tell every editor window to stop -- only the one that's
						// actually recording will respond.
						for (const win of editorWindows) {
							if (!win.isDestroyed()) {
								win.webContents.send("stop-recording-from-tray");
							}
						}
						// Also notify the HUD overlay window
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: "New Window",
					click: () => {
						createEditorWindowWrapper();
					},
				},
				{
					label: mainT("common", "actions.open") || "Open",
					click: () => {
						showMainWindow();
					},
				},
				{
					// In dev, label as "Reload Window" since true restart breaks
					// vite-plugin-electron's parent process. In prod, "Restart" does
					// a real app.relaunch() + app.exit().
					label: !app.isPackaged ? "Reload Window" : "Restart",
					click: () => {
						restartApp();
					},
				},
				{ type: "separator" as const },
				{
					label: mainT("common", "actions.quit") || "Quit",
					click: () => {
						app.quit();
					},
				},
			];
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

// Per-window unsaved-changes tracking. Keyed by webContents.id so each
// editor window's dirty state is independent. The renderer sends an IPC
// event whenever its dirty bit changes; we look up the sender to know
// which window the event came from.
const editorUnsavedChanges = new Map<number, boolean>();
let editorHasUnsavedChanges = false;
let isForceClosing = false;

function anyEditorHasUnsavedChanges(): boolean {
	for (const [id, dirty] of editorUnsavedChanges) {
		if (dirty) {
			const win = BrowserWindow.fromId(id);
			if (win && !win.isDestroyed()) return true;
		}
	}
	return editorHasUnsavedChanges;
}

ipcMain.on("set-has-unsaved-changes", (event, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
	const win = BrowserWindow.fromWebContents(event.sender);
	if (win) {
		editorUnsavedChanges.set(win.id, hasChanges);
	}
});

// Per-window title update from the renderer.
ipcMain.on("set-window-title", (event, title: string) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || win.isDestroyed()) return;
	const safe = (title || "").trim();
	const finalTitle = safe ? `Guide Studio \u2014 ${safe}` : "Guide Studio";
	win.setTitle(finalTitle);
	setupApplicationMenu();
});

// Notify a target editor window that it's being recorded by another window.
ipcMain.handle("set-capture-target-mode", (_event, sourceId: string, recording: boolean) => {
	for (const win of editorWindows) {
		if (win.isDestroyed()) continue;
		if (win.getMediaSourceId() === sourceId) {
			win.webContents.send("capture-mode-changed", { recording });
			return { success: true, targetId: win.id };
		}
	}
	return { success: false, error: "Source ID does not match any editor window" };
});

// One-click "Open Window for Recording" -- creates a fresh editor window
// (the target) and tells the requesting window to open its source picker
// pre-targeted at the new window.
ipcMain.handle("open-window-for-recording", async (event) => {
	const requester = BrowserWindow.fromWebContents(event.sender);
	if (!requester || requester.isDestroyed()) {
		return { success: false, error: "No requesting window" };
	}
	const target = createEditorWindowWrapper();

	if (!target.webContents.isLoading()) {
		fireOpenSourcePicker();
	} else {
		target.webContents.once("did-finish-load", fireOpenSourcePicker);
	}

	function fireOpenSourcePicker() {
		if (!requester || requester.isDestroyed() || target.isDestroyed()) return;
		const targetSourceId = target.getMediaSourceId();
		offsetWindow(target, requester);
		requester.webContents.send("open-source-picker", {
			preferredSourceId: targetSourceId,
			targetWindowTitle: target.getTitle(),
		});
	}

	return { success: true, targetWindowId: target.id };
});

/** Offset a newly-created window so it doesn't sit directly on top of an
 *  existing one. Cascades by ~40px down-and-right from the reference. */
function offsetWindow(target: BrowserWindow, reference: BrowserWindow) {
	if (target.isDestroyed() || reference.isDestroyed()) return;
	const [refX, refY] = reference.getPosition();
	target.setPosition(refX + 40, refY + 40, true);
}

function forceCloseEditorWindow(windowToClose: BrowserWindow | null) {
	if (!windowToClose || windowToClose.isDestroyed()) return;

	isForceClosing = true;
	setImmediate(() => {
		try {
			if (!windowToClose.isDestroyed()) {
				windowToClose.close();
			}
		} finally {
			isForceClosing = false;
		}
	});
}

/** Create a new editor window. Multi-window safe -- does NOT close any
 *  existing windows. Returns the new window so callers can wait for
 *  did-finish-load if they need to forward an action to it. */
function createEditorWindowWrapper(): BrowserWindow {
	const win = createEditorWindow();
	editorWindows.add(win);
	editorUnsavedChanges.set(win.id, false);

	win.on("close", (event) => {
		if (isForceClosing) return;
		const isDirty = editorUnsavedChanges.get(win.id) ?? false;
		if (!isDirty) return;

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(win, {
			type: "warning",
			buttons: [
				mainT("dialogs", "unsavedChanges.saveAndClose"),
				mainT("dialogs", "unsavedChanges.discardAndClose"),
				mainT("common", "actions.cancel"),
			],
			defaultId: 0,
			cancelId: 2,
			title: mainT("dialogs", "unsavedChanges.title"),
			message: mainT("dialogs", "unsavedChanges.message"),
			detail: mainT("dialogs", "unsavedChanges.detail"),
		});

		if (win.isDestroyed()) return;

		if (choice === 0) {
			win.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", (_, shouldClose: boolean) => {
				if (!shouldClose) return;
				forceCloseEditorWindow(win);
			});
		} else if (choice === 1) {
			forceCloseEditorWindow(win);
		}
	});

	win.on("closed", () => {
		editorWindows.delete(win);
		editorUnsavedChanges.delete(win.id);
		setupApplicationMenu();
	});

	setupApplicationMenu();
	return win;
}

function switchToHudWrapper() {
	if (mainWindow) {
		isForceClosing = true;
		mainWindow.close();
		isForceClosing = false;
		mainWindow = null;
	}
	showMainWindow();
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

function createCountdownOverlayWindowWrapper() {
	if (countdownOverlayWindow && !countdownOverlayWindow.isDestroyed()) {
		return countdownOverlayWindow;
	}

	countdownOverlayWindow = createCountdownOverlayWindow();
	countdownOverlayWindow.on("closed", () => {
		countdownOverlayWindow = null;
	});
	return countdownOverlayWindow;
}

// Closing every window quits the app (tray goes too). The in-app "Return to Recorder"
// button covers the editor-to-HUD round-trip, so closing the last window means "I'm done".
app.on("window-all-closed", () => {
	app.quit();
});

app.on("activate", () => {
	// On macOS, re-open a window when the dock icon is clicked and none are open.
	const hasVisibleWindow = BrowserWindow.getAllWindows().some((window) => {
		if (window.isDestroyed() || !window.isVisible()) {
			return false;
		}

		const url = window.webContents.getURL();
		const isCountdownOverlayWindow = url.includes("windowType=countdown-overlay");
		return !isCountdownOverlayWindow;
	});
	if (!hasVisibleWindow) {
		showMainWindow();
	}
});

app.on("will-quit", () => {
	unregisterAllGlobalShortcuts();
});

// ── Pro auth via deep link protocol ──────────────────────────────────
import { handleProAuthDeepLink, registerProAuthProtocol } from "./pro/proAuth";

// Register the protocol before app is ready
registerProAuthProtocol();

// macOS: handle deep link when app is already running
app.on("open-url", (event, url) => {
	event.preventDefault();
	handleProAuthDeepLink(url);
});

// Windows/Linux: second instance receives the deep link URL in argv
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const deepLink = argv.find((arg) => arg.startsWith("guidestudio://"));
		if (deepLink) {
			handleProAuthDeepLink(deepLink);
		}
		// Focus an existing editor window
		const win = getFocusedEditorWindow() ?? getFirstEditorWindow();
		if (win) {
			if (win.isMinimized()) win.restore();
			win.focus();
		}
	});
}

// Register studio:// protocol for secure local file access (replaces webSecurity: false)
protocol.registerSchemesAsPrivileged([
	{
		scheme: "studio",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			stream: true,
			bypassCSP: true,
		},
	},
]);

// ── Main app ready ───────────────────────────────────────────────────
app.whenReady().then(async () => {
	// Force "regular" activation policy so the Dock icon appears. The HUD overlay
	// (transparent, frameless, skipTaskbar) is the first window, and AppKit would
	// otherwise classify us as an accessory app.
	if (process.platform === "darwin") {
		app.dock?.show();
	}

	// Handle studio:// protocol -- serves local files securely with Range
	// support so Remotion can seek into long media (TTS narration, music,
	// recordings). Without 206 Partial Content, audio elements stutter and
	// stop because they can't jump to a specific position.
	protocol.handle("studio", async (request) => {
		// studio://file/C:/path/to/file.webm -> C:/path/to/file.webm
		const rawUrl = request.url;
		const filePath = decodeURIComponent(rawUrl.replace("studio://file/", "").replace(/#.*$/, ""));
		console.log("[studio://] request.url:", rawUrl, "-> filePath:", filePath);

		const mimeFor = (p: string): string => {
			const ext = path.extname(p).toLowerCase();
			switch (ext) {
				case ".mp3":
					return "audio/mpeg";
				case ".wav":
					return "audio/wav";
				case ".ogg":
					return "audio/ogg";
				case ".m4a":
					return "audio/mp4";
				case ".webm":
					return "video/webm";
				case ".mp4":
					return "video/mp4";
				case ".mov":
					return "video/quicktime";
				case ".png":
					return "image/png";
				case ".jpg":
				case ".jpeg":
					return "image/jpeg";
				case ".gif":
					return "image/gif";
				case ".webp":
					return "image/webp";
				case ".json":
					return "application/json";
				default:
					return "application/octet-stream";
			}
		};

		try {
			const stat = await fs.stat(filePath);
			const fileSize = stat.size;
			const mimeType = mimeFor(filePath);
			const rangeHeader = request.headers.get("range");

			if (rangeHeader) {
				const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
				if (match) {
					const start = match[1] ? parseInt(match[1], 10) : 0;
					const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
					if (
						Number.isNaN(start) ||
						Number.isNaN(end) ||
						start < 0 ||
						end >= fileSize ||
						start > end
					) {
						return new Response("Invalid range", {
							status: 416,
							headers: { "Content-Range": `bytes */${fileSize}` },
						});
					}
					const chunkSize = end - start + 1;
					const handle = await fs.open(filePath, "r");
					try {
						const buffer = Buffer.alloc(chunkSize);
						await handle.read(buffer, 0, chunkSize, start);
						return new Response(buffer, {
							status: 206,
							headers: {
								"Content-Type": mimeType,
								"Content-Length": String(chunkSize),
								"Content-Range": `bytes ${start}-${end}/${fileSize}`,
								"Accept-Ranges": "bytes",
								"Cache-Control": "no-cache",
							},
						});
					} finally {
						await handle.close();
					}
				}
			}

			// No Range header -- return the full file but advertise byte ranges
			const data = await fs.readFile(filePath);
			return new Response(data, {
				status: 200,
				headers: {
					"Content-Type": mimeType,
					"Content-Length": String(fileSize),
					"Accept-Ranges": "bytes",
					"Cache-Control": "no-cache",
				},
			});
		} catch (err) {
			console.error("[studio://] failed to serve", filePath, err);
			return new Response("Not found", { status: 404 });
		}
	});

	// Permission handlers -- merged superset from both repos
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = [
			"media",
			"audioCapture",
			"microphone",
			"videoCapture",
			"camera",
			"screen",
			"display-capture",
		];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = [
			"media",
			"audioCapture",
			"microphone",
			"videoCapture",
			"camera",
			"screen",
			"display-capture",
		];
		callback(allowed.includes(permission));
	});

	// Display media request handler (source selector flow)
	session.defaultSession.setDisplayMediaRequestHandler(
		(request, callback) => {
			const source = getSelectedDesktopSource();
			if (!request.videoRequested || !source) {
				callback({});
				return;
			}

			callback({
				video: source,
				...(request.audioRequested && process.platform === "win32" ? { audio: "loopback" } : {}),
			});
		},
		{ useSystemPicker: false },
	);

	// Request mic permission now. Screen Recording is requested lazily from the
	// source-picker action so its prompt isn't hidden behind the selector window.
	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	}

	ipcMain.on("hud-overlay-close", () => {
		app.quit();
	});

	ipcMain.handle("set-locale", (_, locale: string) => {
		setMainLocale(locale);
		setupApplicationMenu();
		updateTrayMenu();
	});

	ipcMain.handle("update-global-shortcut", (_, binding: ShortcutBinding) => {
		const success = registerOpenAppShortcut(binding, showMainWindow);
		return { success };
	});

	// Prime the settings cache before the initial menu builds -- the Release
	// Channel submenu reads the stored channel + license tier synchronously.
	await loadSettings();

	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	await ensureRecordingsDir();

	// ── Register all IPC handler modules ──────────────────────────────

	// Native capture IPC handlers
	registerCaptureHandlers();

	// AI handlers (generate, narrate, etc.)
	registerAIHandlers();

	// Demo handlers
	registerDemoHandlers(getFocusedEditorWindow);

	// Core IPC handlers (sources, recording, file ops, etc.)
	// Uses the 8-param signature that supports HUD overlay,
	// countdown overlay, and source selector windows.
	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		createCountdownOverlayWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		() => countdownOverlayWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (!recording) {
				showMainWindow();
			}
		},
		switchToHudWrapper,
	);

	// Settings handlers
	registerSettingsHandlers();

	// Studio cache handlers
	registerStudioCacheHandlers();

	// Export handlers (Remotion export support)
	registerExportHandlers(getFocusedEditorWindow);

	// YouTube auth & upload handlers
	registerYouTubeHandlers(getFocusedEditorWindow);

	// Showcase handlers
	registerShowcaseHandlers(getFocusedEditorWindow);

	// FFmpeg path setup handlers
	registerFfmpegHandlers();

	// Auto-updater handlers
	await registerUpdaterHandlers();

	// Project file handlers
	registerProjectHandlers();

	// Whisper / caption IPC handlers
	registerWhisperHandlers(getFocusedEditorWindow);

	// Global shortcuts
	await loadAndRegisterGlobalShortcut(showMainWindow);

	// Create the initial HUD overlay window
	createWindow();
});
