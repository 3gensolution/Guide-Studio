import { describe, expect, it, vi } from "vitest";

import {
	advanceFinalizationProgress,
	type FinalizationProgressWatchdog,
	getExportFinalizationIdleTimeoutMs,
	getExportFinalizationTimeoutMs,
	INITIAL_FINALIZATION_PROGRESS_STATE,
	withFinalizationTimeout,
} from "./finalizationTimeout";

describe("finalizationTimeout", () => {
	it("keeps non-audio finalization on the existing 10 minute timeout", () => {
		expect(getExportFinalizationTimeoutMs({ workload: "default" })).toBe(600_000);
		expect(
			getExportFinalizationTimeoutMs({
				workload: "default",
				effectiveDurationSec: 7_200,
			}),
		).toBe(600_000);
	});

	it("gives audio finalization more headroom on longer exports", () => {
		expect(
			getExportFinalizationTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 1_200,
			}),
		).toBe(1_200_000);
		expect(
			getExportFinalizationTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 2_700,
			}),
		).toBe(1_950_000);
	});

	it("caps adaptive audio timeout growth", () => {
		expect(
			getExportFinalizationTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 10_800,
			}),
		).toBe(2_700_000);
	});

	it("falls back to the base timeout for invalid audio durations", () => {
		expect(
			getExportFinalizationTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 0,
			}),
		).toBe(600_000);
		expect(
			getExportFinalizationTimeoutMs({
				workload: "audio",
				effectiveDurationSec: Number.NaN,
			}),
		).toBe(600_000);
	});

	it("derives a bounded idle watchdog window from the total timeout", () => {
		expect(
			getExportFinalizationIdleTimeoutMs({
				workload: "default",
			}),
		).toBe(150_000);
		expect(
			getExportFinalizationIdleTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 1_200,
			}),
		).toBe(300_000);
		expect(
			getExportFinalizationIdleTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 2_700,
			}),
		).toBe(300_000);
		expect(
			getExportFinalizationIdleTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 0,
			}),
		).toBe(150_000);
		expect(
			getExportFinalizationIdleTimeoutMs({
				workload: "audio",
				effectiveDurationSec: Number.NaN,
			}),
		).toBe(150_000);
	});

	it("rejects when a progress-aware finalization stage stops reporting progress", async () => {
		vi.useFakeTimers();

		try {
			const idleTimeoutMs = getExportFinalizationIdleTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 1_200,
			});

			const pendingStage = withFinalizationTimeout({
				promise: new Promise<never>(() => {}),
				stage: "audio processing",
				workload: "audio",
				effectiveDurationSec: 1_200,
				progressAware: true,
			});

			const rejection = pendingStage.then(
				() => null,
				(error) => (error instanceof Error ? error.message : String(error)),
			);

			await vi.advanceTimersByTimeAsync(idleTimeoutMs + 1);

			await expect(rejection).resolves.toContain("without observable progress");
		} finally {
			vi.useRealTimers();
		}
	});

	it("resets the idle watchdog when finalization progress continues", async () => {
		vi.useFakeTimers();

		try {
			const idleTimeoutMs = getExportFinalizationIdleTimeoutMs({
				workload: "audio",
				effectiveDurationSec: 1_200,
			});
			let watchdog: FinalizationProgressWatchdog | null = null;
			const pendingStage = withFinalizationTimeout({
				promise: new Promise<never>(() => {}),
				stage: "audio processing",
				workload: "audio",
				effectiveDurationSec: 1_200,
				progressAware: true,
				onWatchdogChanged: (nextWatchdog) => {
					watchdog = nextWatchdog;
				},
			});
			const rejection = pendingStage.then(
				() => null,
				(error) => (error instanceof Error ? error.message : String(error)),
			);

			await vi.advanceTimersByTimeAsync(idleTimeoutMs - 1_000);
			expect(watchdog).not.toBeNull();

			watchdog?.refreshProgress();
			await vi.advanceTimersByTimeAsync(idleTimeoutMs - 1_000);

			const pendingSentinel = Symbol("pending");
			await expect(Promise.race([rejection, Promise.resolve(pendingSentinel)])).resolves.toBe(
				pendingSentinel,
			);

			await vi.advanceTimersByTimeAsync(1_001);
			await expect(rejection).resolves.toContain("without observable progress");
		} finally {
			vi.useRealTimers();
		}
	});

	it("only marks finalization as progressed when normalized progress increases", () => {
		const initial = advanceFinalizationProgress({
			renderProgress: 99,
			audioProgress: 0.5,
			state: INITIAL_FINALIZATION_PROGRESS_STATE,
		});
		expect(initial.progressed).toBe(true);
		expect(initial.lastRenderProgress).toBe(99);
		expect(initial.lastAudioProgress).toBe(0.5);

		const repeated = advanceFinalizationProgress({
			renderProgress: 99,
			audioProgress: 0.5,
			state: initial,
		});
		expect(repeated.progressed).toBe(false);

		const advanced = advanceFinalizationProgress({
			renderProgress: 100,
			audioProgress: 0.5,
			state: repeated,
		});
		expect(advanced.progressed).toBe(true);
		expect(advanced.lastRenderProgress).toBe(100);
		expect(advanced.lastAudioProgress).toBe(0.5);
	});

	it("ignores non-finite render progress without poisoning later updates", () => {
		const invalid = advanceFinalizationProgress({
			renderProgress: Number.NaN,
			audioProgress: 0.25,
			state: INITIAL_FINALIZATION_PROGRESS_STATE,
		});
		expect(invalid.progressed).toBe(true);
		expect(invalid.lastRenderProgress).toBe(-1);
		expect(invalid.lastAudioProgress).toBe(0.25);

		const recovered = advanceFinalizationProgress({
			renderProgress: 99,
			audioProgress: 0.25,
			state: invalid,
		});
		expect(recovered.progressed).toBe(true);
		expect(recovered.lastRenderProgress).toBe(99);
		expect(recovered.lastAudioProgress).toBe(0.25);
	});
});
