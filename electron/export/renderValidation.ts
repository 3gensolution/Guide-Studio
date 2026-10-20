import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { parseMediaContextProbe } from "../../src/lib/ai/mediaContext";
import { getFfmpegEnv, getFfmpegPath } from "../ffmpeg";

const execFile = promisify(execFileCallback);

export interface RenderValidationExpectation {
	width: number;
	height: number;
	fps: number;
	durationSeconds: number;
	requireAudio?: boolean;
	integratedLufsRange?: readonly [number, number];
}

export interface RenderValidationResult {
	width: number;
	height: number;
	durationSeconds: number;
	frameRate?: number;
	hasAudio?: boolean;
	integratedLufs?: number;
}

/** Parse integrated loudness from FFmpeg's ebur128 or loudnorm summary. */
export function parseIntegratedLufs(output: string): number | undefined {
	const matches = [
		...output.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS\b/gi),
		...output.matchAll(/\bInput Integrated:\s*(-?\d+(?:\.\d+)?)\s*LUFS\b/gi),
	];
	const value = matches.at(-1)?.[1];
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Pure metadata gate used by both runtime validation and unit tests. */
export function validateRenderedVideoMetadata(
	probe: ReturnType<typeof parseMediaContextProbe>,
	expected: RenderValidationExpectation,
): string | undefined {
	if (probe.width === undefined || probe.height === undefined) {
		return "The rendered file has no readable video dimensions.";
	}
	if (probe.width !== expected.width || probe.height !== expected.height) {
		return `The rendered dimensions were ${probe.width}×${probe.height}; expected ${expected.width}×${expected.height}.`;
	}
	if (probe.durationSeconds === undefined || probe.durationSeconds <= 0) {
		return "The rendered file has no readable duration.";
	}
	const durationTolerance = Math.max(0.5, 2 / Math.max(expected.fps, 1));
	if (Math.abs(probe.durationSeconds - expected.durationSeconds) > durationTolerance) {
		return `The rendered duration was ${probe.durationSeconds.toFixed(2)}s; expected approximately ${expected.durationSeconds.toFixed(2)}s.`;
	}
	if (
		probe.frameRate !== undefined &&
		Math.abs(probe.frameRate - expected.fps) > Math.max(0.25, expected.fps * 0.02)
	) {
		return `The rendered frame rate was ${probe.frameRate.toFixed(2)}fps; expected ${expected.fps}fps.`;
	}
	return undefined;
}

/**
 * Validate the actual output after Remotion finishes. The source path is
 * supplied by the trusted session workspace, and FFmpeg is invoked with an
 * argument array so filenames never become shell syntax.
 */
export async function validateRenderedVideo(
	outputPath: string,
	expected: RenderValidationExpectation,
): Promise<RenderValidationResult> {
	const file = await fs.stat(outputPath).catch(() => undefined);
	if (!file?.isFile() || file.size <= 0) {
		throw new Error("The renderer did not produce a readable MP4 file.");
	}

	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath)
		throw new Error("FFmpeg is unavailable, so the rendered MP4 could not be validated.");
	const env = getFfmpegEnv(ffmpegPath);

	let probeOutput = "";
	try {
		const result = await execFile(ffmpegPath, ["-hide_banner", "-i", outputPath], {
			env,
			timeout: 20_000,
			maxBuffer: 2 * 1024 * 1024,
		});
		probeOutput = `${result.stdout}\n${result.stderr}`;
	} catch (error) {
		const processError = error as { stdout?: string; stderr?: string };
		probeOutput = `${processError.stdout ?? ""}\n${processError.stderr ?? ""}`;
	}

	const probe = parseMediaContextProbe(probeOutput);
	const metadataError = validateRenderedVideoMetadata(probe, expected);
	if (metadataError) throw new Error(metadataError);
	if (expected.requireAudio && probe.hasAudio !== true) {
		throw new Error("The finished production video has no audio stream.");
	}

	try {
		await execFile(
			ffmpegPath,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				outputPath,
				"-map",
				"0:v:0",
				"-frames:v",
				"1",
				// Remotion's bundled FFmpeg intentionally omits wrapped_avframe.
				// Without an explicit encoder, the null muxer asks for that default
				// and the validation step rejects an otherwise valid MP4.
				"-c:v",
				"rawvideo",
				"-f",
				"null",
				"-",
			],
			{ env, timeout: 30_000, maxBuffer: 512 * 1024 },
		);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "The rendered video could not be decoded.";
		throw new Error(`The rendered MP4 failed its decode check: ${message}`);
	}

	let integratedLufs: number | undefined;
	if (expected.requireAudio && expected.integratedLufsRange) {
		try {
			const loudness = await execFile(
				ffmpegPath,
				[
					"-hide_banner",
					"-i",
					outputPath,
					"-vn",
					"-filter_complex",
					"[0:a:0]loudnorm=I=-16:print_format=summary[loudness]",
					"-map",
					"[loudness]",
					"-c:a",
					"pcm_s16le",
					"-f",
					"null",
					"-",
				],
				{ env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
			);
			integratedLufs = parseIntegratedLufs(`${loudness.stdout}\n${loudness.stderr}`);
		} catch (error) {
			const processError = error as { stdout?: string; stderr?: string };
			integratedLufs = parseIntegratedLufs(
				`${processError.stdout ?? ""}\n${processError.stderr ?? ""}`,
			);
		}
		if (integratedLufs === undefined) {
			throw new Error("The finished production audio loudness could not be measured.");
		}
		const [minimum, maximum] = expected.integratedLufsRange;
		if (integratedLufs < minimum || integratedLufs > maximum) {
			throw new Error(
				`Integrated loudness was ${integratedLufs.toFixed(1)} LUFS; expected ${minimum} to ${maximum} LUFS.`,
			);
		}
	}

	return {
		width: probe.width!,
		height: probe.height!,
		durationSeconds: probe.durationSeconds!,
		...(probe.frameRate !== undefined ? { frameRate: probe.frameRate } : {}),
		...(probe.hasAudio !== undefined ? { hasAudio: probe.hasAudio } : {}),
		...(integratedLufs !== undefined ? { integratedLufs } : {}),
	};
}
