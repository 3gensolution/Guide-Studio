export type FinalizationTimeoutWorkload = "default" | "audio";
export type FinalizationProgressWatchdog = {
	refreshProgress: () => void;
};
export type FinalizationProgressState = {
	lastRenderProgress: number;
	lastAudioProgress: number;
};

const BASE_FINALIZATION_TIMEOUT_MS = 10 * 60_000;
const AUDIO_TIMEOUT_HEADROOM_PER_OUTPUT_SECOND_MS = 500;
const MAX_AUDIO_FINALIZATION_TIMEOUT_MS = 45 * 60_000;
const MIN_PROGRESS_IDLE_TIMEOUT_MS = 90_000;
const MAX_PROGRESS_IDLE_TIMEOUT_MS = 5 * 60_000;
const PROGRESS_IDLE_TIMEOUT_FRACTION = 0.25;

export const INITIAL_FINALIZATION_PROGRESS_STATE: FinalizationProgressState = {
	lastRenderProgress: -1,
	lastAudioProgress: -1,
};

export function getExportFinalizationTimeoutMs({
	effectiveDurationSec,
	workload = "default",
}: {
	effectiveDurationSec?: number | null;
	workload?: FinalizationTimeoutWorkload;
}): number {
	if (workload !== "audio") {
		return BASE_FINALIZATION_TIMEOUT_MS;
	}

	const safeEffectiveDurationSec =
		typeof effectiveDurationSec === "number" ? effectiveDurationSec : Number.NaN;
	if (!Number.isFinite(safeEffectiveDurationSec) || safeEffectiveDurationSec <= 0) {
		return BASE_FINALIZATION_TIMEOUT_MS;
	}

	// Audio finalization work scales with the output timeline, so long exports need
	// more headroom without making unrelated finalization hangs wait longer.
	const adaptiveTimeoutMs =
		BASE_FINALIZATION_TIMEOUT_MS +
		safeEffectiveDurationSec * AUDIO_TIMEOUT_HEADROOM_PER_OUTPUT_SECOND_MS;

	return Math.min(adaptiveTimeoutMs, MAX_AUDIO_FINALIZATION_TIMEOUT_MS);
}

export function getExportFinalizationIdleTimeoutMs({
	effectiveDurationSec,
	workload = "default",
}: {
	effectiveDurationSec?: number | null;
	workload?: FinalizationTimeoutWorkload;
}): number {
	const totalTimeoutMs = getExportFinalizationTimeoutMs({
		effectiveDurationSec,
		workload,
	});

	return Math.min(
		Math.max(
			Math.floor(totalTimeoutMs * PROGRESS_IDLE_TIMEOUT_FRACTION),
			MIN_PROGRESS_IDLE_TIMEOUT_MS,
		),
		MAX_PROGRESS_IDLE_TIMEOUT_MS,
	);
}

export function advanceFinalizationProgress({
	renderProgress,
	audioProgress,
	state,
}: {
	renderProgress: number;
	audioProgress?: number;
	state: FinalizationProgressState;
}): FinalizationProgressState & { progressed: boolean } {
	const normalizedRenderProgress =
		typeof renderProgress === "number" && Number.isFinite(renderProgress)
			? Math.max(0, Math.min(renderProgress, 100))
			: null;
	const normalizedAudioProgress =
		typeof audioProgress === "number" && Number.isFinite(audioProgress)
			? Math.max(0, Math.min(audioProgress, 1))
			: null;
	const nextRenderProgress =
		normalizedRenderProgress === null
			? state.lastRenderProgress
			: Math.max(state.lastRenderProgress, normalizedRenderProgress);
	const nextAudioProgress =
		normalizedAudioProgress === null
			? state.lastAudioProgress
			: Math.max(state.lastAudioProgress, normalizedAudioProgress);

	return {
		progressed:
			nextRenderProgress > state.lastRenderProgress || nextAudioProgress > state.lastAudioProgress,
		lastRenderProgress: nextRenderProgress,
		lastAudioProgress: nextAudioProgress,
	};
}

export async function withFinalizationTimeout<T>({
	promise,
	stage,
	effectiveDurationSec,
	workload = "default",
	progressAware = false,
	onWatchdogChanged,
}: {
	promise: Promise<T>;
	stage: string;
	effectiveDurationSec?: number | null;
	workload?: FinalizationTimeoutWorkload;
	progressAware?: boolean;
	onWatchdogChanged?: (watchdog: FinalizationProgressWatchdog | null) => void;
}): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutMs = getExportFinalizationTimeoutMs({
		effectiveDurationSec,
		workload,
	});
	const idleTimeoutMs = progressAware
		? getExportFinalizationIdleTimeoutMs({
				effectiveDurationSec,
				workload,
			})
		: null;
	const hasIdleWatchdog =
		progressAware &&
		typeof idleTimeoutMs === "number" &&
		Number.isFinite(idleTimeoutMs) &&
		idleTimeoutMs >= 0;
	const resolvedIdleTimeoutMs = hasIdleWatchdog ? idleTimeoutMs : null;
	const watchdog: FinalizationProgressWatchdog | null = hasIdleWatchdog
		? {
				refreshProgress: () => undefined,
			}
		: null;

	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				const rejectWithMessage = (message: string) => {
					reject(new Error(message));
				};
				if (watchdog && resolvedIdleTimeoutMs !== null) {
					const refreshProgress = () => {
						if (idleTimeoutId) {
							clearTimeout(idleTimeoutId);
						}
						idleTimeoutId = setTimeout(() => {
							rejectWithMessage(
								`Export timed out during ${stage} after ${Math.ceil(resolvedIdleTimeoutMs / 1000)} seconds without observable progress`,
							);
						}, resolvedIdleTimeoutMs);
					};
					watchdog.refreshProgress = refreshProgress;
					onWatchdogChanged?.(watchdog);
					refreshProgress();
				}
				timeoutId = setTimeout(() => {
					rejectWithMessage(
						`Export timed out during ${stage} after ${Math.ceil(timeoutMs / 60_000)} minutes`,
					);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (idleTimeoutId) {
			clearTimeout(idleTimeoutId);
		}
		onWatchdogChanged?.(null);
	}
}
