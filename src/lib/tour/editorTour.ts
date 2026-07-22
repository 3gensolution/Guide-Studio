import { type Config, type DriveStep, driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./tour.css";
import { markEditorTourSeen } from "./tourState";

/** Imperative hooks the tour uses to reveal panels that are otherwise collapsed. */
export interface EditorTourControls {
	/** Open the AI Tools inspector panel (called when the AI step is reached). */
	openAIPanel: () => void;
}

/** Minimal translator signature — matches `useScopedT("editor")`'s return. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Build and immediately run the first-run editor onboarding tour.
 *
 * Every step anchors to an element that is always present once a video is
 * loaded (tool rail, preview, timeline, the AI-Tools rail button, export
 * button), so we never race React's conditional panel mounting. The AI step
 * additionally opens the AI panel as a visible side effect.
 *
 * @returns the driver instance (already driving), or null if it can't run.
 */
export function runEditorTour(t: Translate, controls: EditorTourControls) {
	const tp = (key: string) => t(`tour.${key}`);

	const steps: DriveStep[] = [
		{
			popover: {
				title: tp("welcome.title"),
				description: tp("welcome.description"),
			},
		},
		{
			element: '[data-tour="tool-rail"]',
			popover: {
				title: tp("toolRail.title"),
				description: tp("toolRail.description"),
				side: "right",
				align: "center",
			},
		},
		{
			element: '[data-tour="preview"]',
			popover: {
				title: tp("preview.title"),
				description: tp("preview.description"),
				side: "top",
				align: "center",
			},
		},
		{
			element: '[data-tour="timeline"]',
			popover: {
				title: tp("timeline.title"),
				description: tp("timeline.description"),
				side: "top",
				align: "center",
			},
		},
		{
			element: '[data-tour="tool-ai"]',
			popover: {
				title: tp("ai.title"),
				description: tp("ai.description"),
				side: "right",
				align: "center",
			},
			onHighlightStarted: () => {
				// Reveal the AI panel so the user sees what the button opens.
				controls.openAIPanel();
			},
		},
		{
			element: '[data-tour="export"]',
			popover: {
				title: tp("export.title"),
				description: tp("export.description"),
				side: "bottom",
				align: "start",
			},
		},
	];

	const config: Config = {
		steps,
		showProgress: true,
		allowClose: true,
		smoothScroll: true,
		stagePadding: 6,
		stageRadius: 10,
		overlayColor: "#0B0C10",
		overlayOpacity: 0.72,
		popoverClass: "guide-tour",
		progressText: tp("progress"),
		nextBtnText: tp("next"),
		prevBtnText: tp("back"),
		doneBtnText: tp("done"),
		// Fires whenever the tour ends — completed, skipped, or ✕ — so we never
		// auto-show it again.
		onDestroyed: () => {
			markEditorTourSeen();
		},
	};

	const driverObj = driver(config);
	driverObj.drive();
	return driverObj;
}
