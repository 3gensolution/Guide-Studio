import { lazy, Suspense, useEffect, useState } from "react";
import guideLogo from "@/assets/guide-logo.svg";
import { BackendProvider } from "@/contexts/BackendContext";
import { applyThemeVariables } from "@/lib/theme";
import { BenchRenderPage } from "./components/BenchRenderPage";
import { CountdownOverlay } from "./components/launch/CountdownOverlay.tsx";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import { RecordingBar } from "./components/recording/RecordingBar";
import { WebcamPreviewWindow } from "./components/recording/WebcamPreviewWindow";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { UpdateToast } from "./components/ui/UpdateToast";
import { useScopedT } from "./contexts/I18nContext";
import { ShortcutsProvider } from "./contexts/ShortcutsContext";
import { loadAllCustomFonts } from "./lib/customFonts";

const VideoEditor = lazy(() => import("./components/video-editor/VideoEditor"));
const ShortcutsConfigDialog = lazy(() =>
	import("./components/video-editor/ShortcutsConfigDialog").then((module) => ({
		default: module.ShortcutsConfigDialog,
	})),
);

/** Window types that should render with a fully transparent background. */
const TRANSPARENT_WINDOW_TYPES = new Set([
	"hud-overlay",
	"source-selector",
	"countdown-overlay",
	"recording-bar",
	"webcam-preview",
]);

export default function App() {
	const [windowType, setWindowType] = useState(
		() => new URLSearchParams(window.location.search).get("windowType") || "",
	);
	const tEditor = useScopedT("editor");

	// Apply theme variables on mount
	useEffect(() => {
		applyThemeVariables();
	}, []);

	useEffect(() => {
		const type = new URLSearchParams(window.location.search).get("windowType") || "";
		if (type !== windowType) {
			setWindowType(type);
		}

		if (TRANSPARENT_WINDOW_TYPES.has(type)) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		// HUD is a fixed-size BrowserWindow; pin the document shell and hide overflow
		// so the renderer can't introduce scrollbars (see issue #305).
		if (type === "hud-overlay") {
			document.documentElement.style.height = "100%";
			document.documentElement.style.overflow = "hidden";
			document.body.style.height = "100%";
			document.body.style.margin = "0";
			document.body.style.overflow = "hidden";
			const root = document.getElementById("root");
			root?.style.setProperty("height", "100%");
			root?.style.setProperty("min-height", "0");
			root?.style.setProperty("overflow", "hidden");
		}
	}, [windowType]);

	useEffect(() => {
		// Load custom fonts on app initialization
		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
	}, []);

	// Clean-capture mode -- when this window is being recorded by another
	// editor, the main process fires `capture-mode-changed`. We toggle a
	// `recording-target` body class so dev-only UI (toasts, popovers, dev
	// overlays, the update toast) can hide via CSS.
	useEffect(() => {
		if (!window.electronAPI?.onCaptureModeChanged) return;
		const cleanup = window.electronAPI.onCaptureModeChanged(
			({ recording }: { recording: boolean }) => {
				document.body.classList.toggle("recording-target", recording);
			},
		);
		return cleanup;
	}, []);

	const content = (() => {
		switch (windowType) {
			case "hud-overlay":
				return <LaunchWindow />;
			case "source-selector":
				return <SourceSelector />;
			case "countdown-overlay":
				return <CountdownOverlay />;
			case "recording-bar":
				return <RecordingBar />;
			case "webcam-preview":
				return <WebcamPreviewWindow />;
			case "bench-render":
				return <BenchRenderPage />;
			case "editor":
			default:
				return (
					<ShortcutsProvider>
						<Suspense
							fallback={
								<div className="flex flex-col items-center justify-center gap-4 h-screen bg-[#1C1917]">
									<img src={guideLogo} alt="Guide Studio" className="w-12 h-12 animate-pulse" />
									<div className="flex items-center gap-2">
										<div
											className="w-1.5 h-1.5 rounded-full bg-[#A855F7] animate-bounce"
											style={{ animationDelay: "0ms" }}
										/>
										<div
											className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-bounce"
											style={{ animationDelay: "150ms" }}
										/>
										<div
											className="w-1.5 h-1.5 rounded-full bg-[#22D3EE] animate-bounce"
											style={{ animationDelay: "300ms" }}
										/>
									</div>
									<span className="text-white/50 text-sm">{tEditor("loadingEditor")}</span>
								</div>
							}
						>
							<VideoEditor />
							<ShortcutsConfigDialog />
						</Suspense>
					</ShortcutsProvider>
				);
		}
	})();

	return (
		<BackendProvider>
			<TooltipProvider>
				{content}
				{windowType !== "recording-bar" && windowType !== "webcam-preview" && <UpdateToast />}
				<Toaster theme="dark" className="pointer-events-auto" />
			</TooltipProvider>
		</BackendProvider>
	);
}
