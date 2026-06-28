/**
 * Dynamic backpressure management for the export pipeline.
 *
 * Selects queue limits based on hardware concurrency and workload intensity
 * to prevent memory exhaustion on low-end machines while allowing higher
 * throughput on capable hardware.
 */

export type BackpressureProfile = "conservative" | "balanced" | "balanced-plus";

export interface BackpressureLimits {
	maxDecodeQueueSize: number;
	maxPendingFrames: number;
	maxEncodeQueueSize: number;
}

const PROFILES: Record<BackpressureProfile, BackpressureLimits> = {
	conservative: { maxDecodeQueueSize: 6, maxPendingFrames: 12, maxEncodeQueueSize: 48 },
	balanced: { maxDecodeQueueSize: 10, maxPendingFrames: 24, maxEncodeQueueSize: 120 },
	"balanced-plus": { maxDecodeQueueSize: 16, maxPendingFrames: 36, maxEncodeQueueSize: 180 },
};

/**
 * Select a backpressure profile based on hardware concurrency and the
 * workload intensity derived from output resolution and target bitrate.
 *
 * Reference workload: 1920x1080 at 20 Mbps = intensity 1.0.
 */
export function selectBackpressureProfile(
	width: number,
	height: number,
	bitrate: number,
): BackpressureProfile {
	const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
	const pixelArea = width * height;
	const referenceWorkload = 1920 * 1080 * 20_000_000;
	const workloadIntensity = (pixelArea * bitrate) / referenceWorkload;

	if (cores <= 4 || workloadIntensity > 1.5) {
		return "conservative";
	}
	if (cores >= 8 && workloadIntensity < 0.8) {
		return "balanced-plus";
	}
	return "balanced";
}

export function getBackpressureLimits(profile: BackpressureProfile): BackpressureLimits {
	return PROFILES[profile];
}

// ── Lightning pipeline backend routing ──────────────────────────────────────

import type { ExportPipelineModel } from "./types";

/**
 * Returns an ordered list of hardware acceleration preferences based on
 * the selected pipeline model.
 *
 * - **modern** (Lightning): Always tries hardware acceleration first, then
 *   falls back to software. This is the fastest path on systems with capable
 *   GPU encoders.
 * - **legacy**: Uses the platform-specific heuristic (Windows prefers software
 *   first to avoid flaky GPU drivers; other platforms prefer hardware).
 */
export function getEncoderPreferencesForPipeline(
	pipelineModel: ExportPipelineModel,
): HardwareAcceleration[] {
	if (pipelineModel === "modern") {
		return ["prefer-hardware", "prefer-software"];
	}

	// Legacy: platform-based heuristic
	if (typeof navigator !== "undefined" && /\bWindows\b/i.test(navigator.userAgent)) {
		return ["prefer-software", "prefer-hardware"];
	}
	return ["prefer-hardware", "prefer-software"];
}
