// Guide Studio cursor modules
export type { ClickRingState } from "./clickRing";
export { ClickRingAnimation, ClickRingPool } from "./clickRing";
// GuideStudio cursor modules
export type { SmoothedCursorPath, SmoothedCursorPosition } from "./cursorPathSmoothing";
export { getSmoothedCursorPath } from "./cursorPathSmoothing";
export type { RenderCursorOptions } from "./cursorRenderer";
export { loadCursorImage, renderCursor } from "./cursorRenderer";
export type { CursorStyleDefinition, CursorStyleHotspot } from "./cursorStyles";
export { CURSOR_STYLES, getCursorStyle } from "./cursorStyles";
export { CursorSwayInterpolator, computeCursorSway } from "./cursorSway";
export type { CursorTheme, CursorThemeAsset } from "./cursorThemes";
export {
	CURSOR_THEME_IDS,
	CURSOR_THEMES,
	DEFAULT_CURSOR_THEME_ID,
	getCursorTheme,
	normalizeCursorThemeId,
} from "./cursorThemes";
export type { SmoothedCursorFrame, SmoothedPosition } from "./motionSmoothing";
export { CursorSmoother, smoothCursorPath } from "./motionSmoothing";
export type {
	ActiveNativeCursorFrame,
	NativeCursorMotionBlurState,
} from "./nativeCursor";
export {
	createNativeCursorMotionBlurState,
	getNativeCursorClickBounceProgress,
	getNativeCursorClickBounceScale,
	getNativeCursorDisplayMetrics,
	getNativeCursorMotionBlurPx,
	hasNativeCursorRecordingData,
	projectNativeCursorToLocal,
	projectNativeCursorToStage,
	resetNativeCursorMotionBlurState,
	resolveActiveNativeCursorFrame,
	resolveInterpolatedNativeCursorFrame,
	resolveNativeCursorRenderAsset,
	resolvePrettyNativeCursorAsset,
} from "./nativeCursor";
