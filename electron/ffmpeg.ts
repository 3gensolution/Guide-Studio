import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

/**
 * Resolves the path to the FFmpeg binary.
 *
 * Priority:
 * 1. ffmpeg shipped with @remotion/compositor-<platform>-<arch> (always present
 *    — it's a dependency of @remotion/renderer, signed in packaged builds, and
 *    unpacked into app.asar.unpacked by electron-builder via `asarUnpack`)
 * 2. Legacy native/bin/ in dev (kept as fallback for older setups)
 * 3. Legacy extraResources/ffmpeg in prod (never bundled — kept for symmetry)
 * 4. System FFmpeg on PATH
 * 5. null if not found
 */
export async function getFfmpegPath(): Promise<string | null> {
	// Remotion compositor is the canonical source — see findRemotionFfmpeg().
	const remotionPath = findRemotionFfmpeg();
	try {
		await fs.access(remotionPath);
		return remotionPath;
	} catch {
		// Fall through — compositor package missing (very unlikely)
	}

	// Legacy bundled-binary location (kept for backwards compat)
	const bundledPath = getBundledFfmpegPath();
	if (bundledPath) {
		try {
			await fs.access(bundledPath);
			return bundledPath;
		} catch {
			// Bundled binary not found, fall through
		}
	}

	// Check system PATH
	const systemPath = await findSystemFfmpeg();
	if (systemPath) return systemPath;

	return null;
}

/**
 * Resolve ffmpeg from the Remotion compositor package. This is the path used
 * everywhere the app needs ffmpeg (export post-process, music merge, audio
 * extraction, showcase poster). Centralized here so a missing binary can't
 * silently break one feature while another works.
 */
export function findRemotionFfmpeg(): string {
	const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	const libcSuffix =
		process.platform === "win32" ? "-msvc" : process.platform === "linux" ? "-gnu" : "";
	const pkg = `compositor-${process.platform}-${process.arch}${libcSuffix}`;
	const base = app.isPackaged
		? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
		: path.join(app.getAppPath(), "node_modules");
	return path.join(base, "@remotion", pkg, name);
}

function getBundledFfmpegPath(): string | null {
	const platform = process.platform;
	const binaryName = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

	// In development — check native/bin/{platform}/
	if (!app.isPackaged) {
		const devPath = path.join(
			app.getAppPath(),
			"native",
			"bin",
			platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux",
			binaryName,
		);
		return devPath;
	}

	// In packaged app — extraResources
	const resourcesPath = process.resourcesPath;
	return path.join(resourcesPath, "ffmpeg", binaryName);
}

/**
 * Merge a video file with an audio file using ffmpeg.
 * The audio is mixed at the specified volume and trimmed to the video duration.
 */
export async function mergeVideoWithAudio(
	videoPath: string,
	audioPath: string,
	outputPath: string,
	audioVolume = 0.25,
): Promise<{ success: boolean; error?: string }> {
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found" };
	}

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	// Determine audio codec from output extension — WebM needs libopus, MP4 needs AAC
	const isWebm = outputPath.toLowerCase().endsWith(".webm");
	const audioCodec = isWebm ? "libopus" : "aac";
	const audioBitrate = isWebm ? "128k" : "192k";

	const env = getFfmpegEnv(ffmpegPath);

	// Try simple merge first (video likely has no audio from html2canvas export)
	try {
		await execFileAsync(
			ffmpegPath,
			[
				"-i",
				videoPath,
				"-i",
				audioPath,
				"-filter_complex",
				`[1:a]volume=${audioVolume}[aout]`,
				"-map",
				"0:v",
				"-map",
				"[aout]",
				"-c:v",
				"copy",
				"-c:a",
				audioCodec,
				"-b:a",
				audioBitrate,
				"-shortest",
				"-y",
				outputPath,
			],
			{ timeout: 120_000, env },
		);
		return { success: true };
	} catch (err1) {
		console.error("[FFmpeg] Simple merge failed:", err1);
		// Fallback: try with amix in case video has an audio track
		try {
			await execFileAsync(
				ffmpegPath,
				[
					"-i",
					videoPath,
					"-i",
					audioPath,
					"-filter_complex",
					`[1:a]volume=${audioVolume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=3[aout]`,
					"-map",
					"0:v",
					"-map",
					"[aout]",
					"-c:v",
					"copy",
					"-c:a",
					audioCodec,
					"-b:a",
					audioBitrate,
					"-shortest",
					"-y",
					outputPath,
				],
				{ timeout: 120_000, env },
			);
			return { success: true };
		} catch (err2) {
			console.error("[FFmpeg] Amix merge also failed:", err2);
			return { success: false, error: `FFmpeg merge failed: ${err2}` };
		}
	}
}

/**
 * Probe a file with ffmpeg -i to detect whether it has an audio stream.
 * ffmpeg prints stream info to stderr and always exits with code 1 when
 * given no output file, so we parse stderr.
 */
async function probeHasAudio(
	filePath: string,
	ffmpegPath: string,
	execFileAsync: (
		file: string,
		args: string[],
		opts: object,
	) => Promise<{ stdout: string; stderr: string }>,
	env: NodeJS.ProcessEnv,
): Promise<boolean> {
	try {
		await execFileAsync(ffmpegPath, ["-i", filePath, "-hide_banner"], { timeout: 10_000, env });
		return false;
	} catch (err: unknown) {
		const stderr = String((err as { stderr?: string })?.stderr || "");
		return /Stream #\d+:\d+[^:]*: Audio:/i.test(stderr);
	}
}

/**
 * Probe a file with ffmpeg -i for its stream codecs and duration.
 * Like probeHasAudio, parses stderr since ffmpeg exits 1 with no output file.
 */
async function probeStreamInfo(
	filePath: string,
	ffmpegPath: string,
	execFileAsync: (
		file: string,
		args: string[],
		opts: object,
	) => Promise<{ stdout: string; stderr: string }>,
	env: NodeJS.ProcessEnv,
): Promise<{ videoCodec: string | null; audioCodec: string | null; durationMs: number | null }> {
	try {
		await execFileAsync(ffmpegPath, ["-i", filePath, "-hide_banner"], { timeout: 10_000, env });
		return { videoCodec: null, audioCodec: null, durationMs: null };
	} catch (err: unknown) {
		const stderr = String((err as { stderr?: string })?.stderr || "");
		const videoMatch = stderr.match(/Stream #\d+:\d+[^:]*: Video: (\w+)/i);
		const audioMatch = stderr.match(/Stream #\d+:\d+[^:]*: Audio: (\w+)/i);
		const durationMatch = stderr.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
		let durationMs: number | null = null;
		if (durationMatch) {
			const [, h, m, s, cs] = durationMatch;
			durationMs = Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1_000 + Number(cs) * 10;
		}
		return {
			videoCodec: videoMatch ? videoMatch[1].toLowerCase() : null,
			audioCodec: audioMatch ? audioMatch[1].toLowerCase() : null,
			durationMs,
		};
	}
}

// ── Hardware H.264 encoder selection ─────────────────────────────────────
//
// The bundled ffmpeg exposes the OS hardware encoder (VideoToolbox on macOS,
// NVENC/QSV/AMF on Windows) which encodes 3-10x faster than libx264 at
// screen-recording quality. Probed once per app run; null means software.

let cachedHwEncoder: string | null | undefined;

async function pickHwH264Encoder(
	ffmpegPath: string,
	execFileAsync: (
		file: string,
		args: string[],
		opts: object,
	) => Promise<{ stdout: string; stderr: string }>,
	env: NodeJS.ProcessEnv,
): Promise<string | null> {
	if (cachedHwEncoder !== undefined) return cachedHwEncoder;

	const candidates =
		process.platform === "darwin"
			? ["h264_videotoolbox"]
			: process.platform === "win32"
				? ["h264_nvenc", "h264_qsv", "h264_amf"]
				: [];

	if (candidates.length === 0) {
		cachedHwEncoder = null;
		return null;
	}

	try {
		const { stdout } = await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
			timeout: 10_000,
			env,
		});
		cachedHwEncoder = candidates.find((name) => stdout.includes(name)) ?? null;
	} catch {
		cachedHwEncoder = null;
	}

	if (cachedHwEncoder) {
		console.log(`[ffmpeg] Hardware H.264 encoder available: ${cachedHwEncoder}`);
	}
	return cachedHwEncoder;
}

/**
 * Encode args for a given encoder (null = software libx264). Hardware
 * encoders are bitrate-driven (no CRF); 8 Mbps comfortably exceeds
 * screen-recording quality at 1080-1440p.
 */
function buildH264EncodeArgs(encoder: string | null, hasAudio: boolean): string[] {
	const video = encoder
		? [
				"-c:v",
				encoder,
				"-b:v",
				"8M",
				...(encoder === "h264_videotoolbox" ? ["-allow_sw", "1"] : []),
			]
		: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"];

	return [
		...video,
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		...(hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : []),
	];
}

/**
 * Probe a file with ffmpeg -i for its video resolution.
 */
async function probeResolution(
	filePath: string,
	ffmpegPath: string,
	execFileAsync: (
		file: string,
		args: string[],
		opts: object,
	) => Promise<{ stdout: string; stderr: string }>,
	env: NodeJS.ProcessEnv,
): Promise<{ width: number; height: number } | null> {
	try {
		await execFileAsync(ffmpegPath, ["-i", filePath, "-hide_banner"], { timeout: 10_000, env });
		return null;
	} catch (err: unknown) {
		const stderr = String((err as { stderr?: string })?.stderr || "");
		const match = stderr.match(/Stream.*Video:.*?(\d{2,5})x(\d{2,5})/);
		if (match) {
			return { width: parseInt(match[1]), height: parseInt(match[2]) };
		}
		return null;
	}
}

/**
 * Concatenate multiple video files into a single output file.
 * Uses the FFmpeg concat demuxer. Falls back to re-encoding if stream copy fails.
 *
 * Handles inputs with different resolutions and mixed audio (some inputs may
 * lack an audio track — e.g. canvas-rendered intros). Inputs without audio
 * get a synthesised silent track so the main video's audio is preserved.
 */
export async function concatenateVideos(
	inputPaths: string[],
	outputPath: string,
): Promise<{ success: boolean; error?: string }> {
	if (inputPaths.length === 0) {
		return { success: false, error: "No input files provided" };
	}
	if (inputPaths.length === 1) {
		// Single file — just copy it
		await fs.copyFile(inputPaths[0], outputPath);
		return { success: true };
	}

	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found — install FFmpeg to enable intro prepend" };
	}

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	// Verify all input files exist before attempting concat
	for (const inputPath of inputPaths) {
		try {
			await fs.access(inputPath);
		} catch {
			return { success: false, error: `Input file not found: ${inputPath}` };
		}
	}

	// Write a temporary concat list file
	const concatListPath = `${outputPath}.concat.txt`;
	const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
	await fs.writeFile(concatListPath, listContent);

	const env = getFfmpegEnv(ffmpegPath);

	try {
		// Try stream copy first (fastest, same codec/resolution)
		console.log("[ffmpeg] Trying concat with stream copy...");
		await execFileAsync(
			ffmpegPath,
			["-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", "-y", outputPath],
			{ timeout: 300_000, env },
		);
		console.log("[ffmpeg] Stream copy concat succeeded");
		return { success: true };
	} catch (streamCopyErr) {
		console.warn("[ffmpeg] Stream copy failed, trying filter_complex concat:", streamCopyErr);
	} finally {
		await fs.unlink(concatListPath).catch(() => {
			/* intentional noop */
		});
	}

	// Probe each input for audio streams and resolution
	const audioFlags: boolean[] = [];
	const resolutions: ({ width: number; height: number } | null)[] = [];
	for (const inputPath of inputPaths) {
		audioFlags.push(await probeHasAudio(inputPath, ffmpegPath, execFileAsync, env));
		resolutions.push(await probeResolution(inputPath, ffmpegPath, execFileAsync, env));
	}

	const anyHasAudio = audioFlags.some(Boolean);
	const allHaveAudio = audioFlags.every(Boolean);

	// Determine target resolution: use the last input (main video) as reference
	const targetRes = resolutions[resolutions.length - 1] ?? { width: 1920, height: 1080 };
	// Ensure even dimensions
	const tw = Math.floor(targetRes.width / 2) * 2;
	const th = Math.floor(targetRes.height / 2) * 2;

	// Check if resolutions differ — if so we need to scale
	const needsScale = resolutions.some((r) => r && (r.width !== tw || r.height !== th));

	console.log(
		`[ffmpeg] Probed inputs: audio=[${audioFlags.join(",")}], ` +
			`resolutions=[${resolutions.map((r) => (r ? `${r.width}x${r.height}` : "?")).join(",")}], ` +
			`target=${tw}x${th}, needsScale=${needsScale}`,
	);

	// Smart filter_complex concat: handle mixed audio and resolution differences
	if (anyHasAudio) {
		try {
			const inputs: string[] = [];
			const filterSegments: string[] = [];
			const concatInputs: string[] = [];

			for (let i = 0; i < inputPaths.length; i++) {
				inputs.push("-i", inputPaths[i]);
			}

			for (let i = 0; i < inputPaths.length; i++) {
				// Scale video to target resolution if needed
				const videoLabel = needsScale ? `v${i}` : `${i}:v:0`;
				if (needsScale) {
					filterSegments.push(
						`[${i}:v:0]scale=${tw}:${th}:force_original_aspect_ratio=decrease,` +
							`pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`,
					);
				}

				if (audioFlags[i]) {
					concatInputs.push(`[${videoLabel}][${i}:a:0]`);
				} else {
					// Generate a silent audio track for this input
					filterSegments.push(`anullsrc=channel_layout=stereo:sample_rate=48000[silence${i}]`);
					concatInputs.push(`[${videoLabel}][silence${i}]`);
				}
			}

			const concatFilter = `${concatInputs.join("")}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`;
			const filterComplex = [...filterSegments, concatFilter].join(";");

			console.log("[ffmpeg] Trying smart filter_complex concat (mixed audio)...");
			console.log("[ffmpeg] filter_complex:", filterComplex);
			await execFileAsync(
				ffmpegPath,
				[
					...inputs,
					"-filter_complex",
					filterComplex,
					"-map",
					"[outv]",
					"-map",
					"[outa]",
					"-c:v",
					"libx264",
					"-preset",
					"medium",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					"-y",
					outputPath,
				],
				{ timeout: 600_000, env },
			);
			console.log("[ffmpeg] Smart filter_complex concat succeeded");
			return { success: true };
		} catch (smartErr) {
			console.warn("[ffmpeg] Smart filter_complex failed:", smartErr);
		}
	}

	// Fallback: all inputs have audio — try standard filter_complex
	if (allHaveAudio) {
		try {
			const inputs: string[] = [];
			const filterParts: string[] = [];

			for (let i = 0; i < inputPaths.length; i++) {
				inputs.push("-i", inputPaths[i]);
				filterParts.push(`[${i}:v:0][${i}:a:0]`);
			}

			const filterComplex = `${filterParts.join("")}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`;

			console.log("[ffmpeg] Trying filter_complex concat (all have audio)...");
			await execFileAsync(
				ffmpegPath,
				[
					...inputs,
					"-filter_complex",
					filterComplex,
					"-map",
					"[outv]",
					"-map",
					"[outa]",
					"-c:v",
					"libx264",
					"-preset",
					"medium",
					"-c:a",
					"aac",
					"-y",
					outputPath,
				],
				{ timeout: 600_000, env },
			);
			console.log("[ffmpeg] filter_complex concat (all have audio) succeeded");
			return { success: true };
		} catch (filterErr) {
			console.warn("[ffmpeg] filter_complex with audio failed, trying video-only:", filterErr);
		}
	}

	// Final fallback: video-only concat (drops all audio)
	try {
		const inputs: string[] = [];
		const filterParts: string[] = [];

		for (let i = 0; i < inputPaths.length; i++) {
			inputs.push("-i", inputPaths[i]);
			if (needsScale) {
				filterParts.push(
					`[${i}:v:0]scale=${tw}:${th}:force_original_aspect_ratio=decrease,` +
						`pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`,
				);
			}
		}

		const concatInputs = inputPaths.map((_, i) => (needsScale ? `[v${i}]` : `[${i}:v:0]`)).join("");
		const filterComplex = needsScale
			? `${filterParts.join(";")};${concatInputs}concat=n=${inputPaths.length}:v=1:a=0[outv]`
			: `${concatInputs}concat=n=${inputPaths.length}:v=1:a=0[outv]`;

		console.log("[ffmpeg] Trying filter_complex concat (video-only)...");
		await execFileAsync(
			ffmpegPath,
			[
				...inputs,
				"-filter_complex",
				filterComplex,
				"-map",
				"[outv]",
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-an",
				"-y",
				outputPath,
			],
			{ timeout: 600_000, env },
		);
		console.log("[ffmpeg] filter_complex concat (video-only) succeeded");
		return { success: true };
	} catch (videoOnlyErr) {
		console.error("[ffmpeg] All concat methods failed:", videoOnlyErr);
		return { success: false, error: `FFmpeg concat failed: ${videoOnlyErr}` };
	}
}

/**
 * Build an environment object for running the Remotion-bundled FFmpeg.
 * On macOS the dylibs (libavdevice.dylib etc.) sit alongside the binary;
 * DYLD_LIBRARY_PATH must include that directory for dyld to locate them.
 * On Linux the equivalent is LD_LIBRARY_PATH.
 */
export function getFfmpegEnv(ffmpegPath: string): NodeJS.ProcessEnv {
	const ffmpegDir = path.dirname(ffmpegPath);
	const env = { ...process.env };

	if (process.platform === "darwin") {
		env.DYLD_LIBRARY_PATH = ffmpegDir + (env.DYLD_LIBRARY_PATH ? `:${env.DYLD_LIBRARY_PATH}` : "");
	} else if (process.platform === "linux") {
		env.LD_LIBRARY_PATH = ffmpegDir + (env.LD_LIBRARY_PATH ? `:${env.LD_LIBRARY_PATH}` : "");
	}

	return env;
}

/**
 * Quick-trim export: cuts the kept segments from the source video with a
 * single FFmpeg pass. Much faster than the full WebCodecs decode+render+encode
 * pipeline because there is no canvas rendering — FFmpeg decodes and encodes
 * directly.
 *
 * The video is re-encoded (hardware H.264 where available, libx264 fallback)
 * rather than stream-copied: stream copy can only cut at keyframes (screen
 * recordings often have 5-10s GOPs, making trims off by seconds) and would
 * put VP8/VP9 webm streams into an .mp4 container that many players reject.
 * Re-encoding is frame-accurate, always produces a compliant H.264 MP4, and
 * typically shrinks the file.
 */
export async function quickTrimExport(
	inputPath: string,
	outputPath: string,
	segments: Array<{ startMs: number; endMs: number }>,
): Promise<{ success: boolean; error?: string }> {
	const validSegments = segments.filter((seg) => seg.endMs - seg.startMs > 1);
	if (validSegments.length === 0) {
		return { success: false, error: "No segments to export" };
	}

	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found" };
	}

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const env = getFfmpegEnv(ffmpegPath);

	try {
		await fs.access(inputPath);
	} catch {
		return { success: false, error: `Input file not found: ${inputPath}` };
	}

	const hasAudio = await probeHasAudio(inputPath, ffmpegPath, execFileAsync, env);

	const totalKeptMs = validSegments.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
	// Generous timeout: at least 10 minutes, scaled up for long exports.
	const timeout = Math.max(600_000, Math.round(totalKeptMs * 2));

	const runTrim = async (encodeArgs: string[]) => {
		if (validSegments.length === 1) {
			// Single segment: -ss before -i uses fast keyframe seeking, and with
			// re-encoding FFmpeg decodes from the keyframe and discards frames up
			// to the requested start, so the cut is frame-accurate.
			const seg = validSegments[0];
			const startSec = (seg.startMs / 1000).toFixed(3);
			const durationSec = ((seg.endMs - seg.startMs) / 1000).toFixed(3);
			console.log(`[ffmpeg] Quick trim: single segment at ${startSec}s for ${durationSec}s`);

			await execFileAsync(
				ffmpegPath,
				["-ss", startSec, "-i", inputPath, "-t", durationSec, ...encodeArgs, "-y", outputPath],
				{ timeout, env },
			);
		} else {
			// Multiple segments: encode each kept segment on its own (fast -ss
			// keyframe seek, frame-accurate with re-encode), then join losslessly
			// with the concat demuxer. NOTE: the bundled Remotion ffmpeg does not
			// include the setpts/asetpts filters, so the previous single-pass
			// trim+setpts+concat filtergraph fails with "Filter not found" —
			// per-segment encodes with identical parameters concat cleanly with
			// -c copy instead (this is also how CapCut-style editors cut).
			console.log(`[ffmpeg] Quick trim: ${validSegments.length} segments via concat demuxer`);
			const tempDir = app.getPath("temp");
			const stamp = Date.now();
			const segmentPaths = validSegments.map((_, i) =>
				path.join(tempDir, `guide-studio-trim-${stamp}-${i}.mp4`),
			);
			const listPath = path.join(tempDir, `guide-studio-trim-${stamp}-list.txt`);

			try {
				for (let i = 0; i < validSegments.length; i++) {
					const startSec = (validSegments[i].startMs / 1000).toFixed(3);
					const durationSec = ((validSegments[i].endMs - validSegments[i].startMs) / 1000).toFixed(
						3,
					);
					await execFileAsync(
						ffmpegPath,
						[
							"-ss",
							startSec,
							"-i",
							inputPath,
							"-t",
							durationSec,
							...encodeArgs,
							"-y",
							segmentPaths[i],
						],
						{ timeout, env },
					);
				}

				const listBody = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
				await fs.writeFile(listPath, listBody, "utf-8");

				await execFileAsync(
					ffmpegPath,
					[
						"-f",
						"concat",
						"-safe",
						"0",
						"-i",
						listPath,
						"-c",
						"copy",
						"-movflags",
						"+faststart",
						"-y",
						outputPath,
					],
					{ timeout, env },
				);
			} finally {
				await Promise.all(
					[...segmentPaths, listPath].map((p) => fs.unlink(p).catch(() => undefined)),
				);
			}
		}
	};

	// Try the hardware encoder first (3-10x faster); fall back to libx264 if
	// the device is unavailable or the hardware session fails mid-encode.
	const hwEncoder = await pickHwH264Encoder(ffmpegPath, execFileAsync, env);
	try {
		await runTrim(buildH264EncodeArgs(hwEncoder, hasAudio));
		console.log(`[ffmpeg] Quick trim succeeded (${hwEncoder ?? "libx264"})`);
		return { success: true };
	} catch (err) {
		if (!hwEncoder) {
			console.error("[ffmpeg] Quick trim failed:", err);
			return { success: false, error: `Quick trim failed: ${err}` };
		}
		console.warn(`[ffmpeg] Quick trim with ${hwEncoder} failed, retrying with libx264:`, err);
	}

	try {
		await runTrim(buildH264EncodeArgs(null, hasAudio));
		console.log("[ffmpeg] Quick trim succeeded (libx264 fallback)");
		return { success: true };
	} catch (err) {
		console.error("[ffmpeg] Quick trim failed:", err);
		return { success: false, error: `Quick trim failed: ${err}` };
	}
}

export interface FlattenClipSegment {
	sourcePath: string;
	startMs: number;
	endMs: number;
}

/**
 * Flatten a multi-clip timeline into a single intermediate MP4 so the
 * effects/export pipeline (which decodes exactly one source) can run over it.
 *
 * Each segment is cut from its source and normalized to a common resolution,
 * frame rate, and audio format (sources may differ in all three, and some may
 * have no audio track at all — those get synthesized silence so the concat
 * streams match). Normalized segments concat losslessly with the demuxer.
 */
export async function flattenVideoClips(
	segments: FlattenClipSegment[],
): Promise<{ success: boolean; tempPath?: string; error?: string }> {
	const validSegments = segments.filter((seg) => seg.endMs - seg.startMs > 1);
	if (validSegments.length === 0) {
		return { success: false, error: "No clip segments to flatten" };
	}

	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found" };
	}

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const env = getFfmpegEnv(ffmpegPath);

	const uniqueSources = [...new Set(validSegments.map((seg) => seg.sourcePath))];
	for (const sourcePath of uniqueSources) {
		try {
			await fs.access(sourcePath);
		} catch {
			return { success: false, error: `Clip source not found: ${sourcePath}` };
		}
	}

	const audioBySource = new Map<string, boolean>();
	for (const sourcePath of uniqueSources) {
		audioBySource.set(sourcePath, await probeHasAudio(sourcePath, ffmpegPath, execFileAsync, env));
	}
	const anyHasAudio = [...audioBySource.values()].some(Boolean);

	// Target resolution comes from the first segment (the primary recording when
	// present); everything else is letterboxed into it.
	const targetRes = (await probeResolution(
		validSegments[0].sourcePath,
		ffmpegPath,
		execFileAsync,
		env,
	)) ?? {
		width: 1920,
		height: 1080,
	};
	const tw = Math.floor(targetRes.width / 2) * 2;
	const th = Math.floor(targetRes.height / 2) * 2;
	const targetFps = 30;

	const totalMs = validSegments.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
	const timeout = Math.max(600_000, Math.round(totalMs * 3));

	const tempDir = app.getPath("temp");
	const stamp = Date.now();
	const segmentPaths = validSegments.map((_, i) =>
		path.join(tempDir, `guide-studio-flatten-${stamp}-${i}.mp4`),
	);
	const listPath = path.join(tempDir, `guide-studio-flatten-${stamp}-list.txt`);
	const outputPath = path.join(tempDir, `guide-studio-flatten-${stamp}.mp4`);

	// The bundled Remotion ffmpeg ships a stripped filter set (no pad/setsar/
	// fps), so normalization is a plain stretch-scale plus an output `-r` for
	// constant frame rate. Mixed aspect ratios distort rather than letterbox.
	const normalizeFilter = `scale=${tw}:${th}`;

	const encodeSegment = async (
		seg: FlattenClipSegment,
		outPath: string,
		videoEncodeArgs: string[],
	) => {
		const startSec = (seg.startMs / 1000).toFixed(3);
		const durationSec = ((seg.endMs - seg.startMs) / 1000).toFixed(3);
		const hasAudio = audioBySource.get(seg.sourcePath) ?? false;

		const inputArgs = ["-ss", startSec, "-i", seg.sourcePath];
		const mapArgs = ["-map", "0:v:0"];
		if (anyHasAudio) {
			if (hasAudio) {
				mapArgs.push("-map", "0:a:0");
			} else {
				inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
				mapArgs.push("-map", "1:a:0");
			}
		}

		await execFileAsync(
			ffmpegPath,
			[
				...inputArgs,
				"-t",
				durationSec,
				...mapArgs,
				"-vf",
				normalizeFilter,
				"-r",
				String(targetFps),
				...videoEncodeArgs,
				"-pix_fmt",
				"yuv420p",
				// Identical audio params across segments so the concat demuxer can
				// stream-copy the joined file.
				...(anyHasAudio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"] : ["-an"]),
				"-movflags",
				"+faststart",
				"-y",
				outPath,
			],
			{ timeout, env },
		);
	};

	const encodeAllSegments = async (videoEncodeArgs: string[]) => {
		for (let i = 0; i < validSegments.length; i++) {
			await encodeSegment(validSegments[i], segmentPaths[i], videoEncodeArgs);
		}
	};

	const hwEncoder = await pickHwH264Encoder(ffmpegPath, execFileAsync, env);
	const hwVideoArgs = hwEncoder
		? [
				"-c:v",
				hwEncoder,
				"-b:v",
				"8M",
				...(hwEncoder === "h264_videotoolbox" ? ["-allow_sw", "1"] : []),
			]
		: null;
	const swVideoArgs = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];

	try {
		try {
			await encodeAllSegments(hwVideoArgs ?? swVideoArgs);
		} catch (err) {
			if (!hwVideoArgs) throw err;
			console.warn(`[ffmpeg] Flatten with ${hwEncoder} failed, retrying with libx264:`, err);
			await encodeAllSegments(swVideoArgs);
		}

		if (segmentPaths.length === 1) {
			await fs.rename(segmentPaths[0], outputPath);
			return { success: true, tempPath: outputPath };
		}

		const listBody = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
		await fs.writeFile(listPath, listBody, "utf-8");

		try {
			await execFileAsync(
				ffmpegPath,
				[
					"-f",
					"concat",
					"-safe",
					"0",
					"-i",
					listPath,
					"-c",
					"copy",
					"-movflags",
					"+faststart",
					"-y",
					outputPath,
				],
				{ timeout, env },
			);
		} catch (concatErr) {
			// Identically-encoded segments should always stream-copy; if not,
			// concatenateVideos has re-encode fallbacks for mismatched streams.
			console.warn("[ffmpeg] Flatten concat stream-copy failed, re-encoding:", concatErr);
			const fallback = await concatenateVideos(segmentPaths, outputPath);
			if (!fallback.success) {
				return { success: false, error: fallback.error };
			}
		}

		console.log(
			`[ffmpeg] Flattened ${validSegments.length} clip segment(s) → ${outputPath} (${tw}x${th}@${targetFps})`,
		);
		return { success: true, tempPath: outputPath };
	} catch (err) {
		console.error("[ffmpeg] Flatten failed:", err);
		return { success: false, error: `Clip flatten failed: ${err}` };
	} finally {
		await Promise.all([...segmentPaths, listPath].map((p) => fs.unlink(p).catch(() => undefined)));
	}
}

export type SmartAssembleSegment =
	| { kind: "copy"; sourcePath: string; startMs: number; endMs: number }
	| { kind: "rendered"; startMs: number; endMs: number };

export interface SmartAssembleOptions {
	outputPath: string;
	/** Effects-rendered spans, keyframe-aligned at each segment boundary. */
	renderedPath: string;
	/** Delete renderedPath when done (it may live outside the temp dir). */
	cleanupRenderedFile?: boolean;
	width: number;
	height: number;
	fps: number;
	bitrate?: number;
	segments: SmartAssembleSegment[];
}

/**
 * Smart-render assembly: interleave untouched spans cut straight from the
 * source files (fast hardware re-encode, no canvas compositing) with spans
 * from the effects-rendered file (stream-copied at the keyframes the exporter
 * forced), then join with the concat demuxer. Falls back to a re-encode
 * concat if the stream-copy join is rejected.
 */
export async function assembleSmartExport(
	options: SmartAssembleOptions,
): Promise<{ success: boolean; error?: string }> {
	const { outputPath, renderedPath, width, height, fps, bitrate, segments } = options;
	if (segments.length === 0) {
		return { success: false, error: "No segments to assemble" };
	}

	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found" };
	}

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const env = getFfmpegEnv(ffmpegPath);

	const copySources = [
		...new Set(
			segments
				.filter(
					(seg): seg is Extract<SmartAssembleSegment, { kind: "copy" }> => seg.kind === "copy",
				)
				.map((seg) => seg.sourcePath),
		),
	];
	for (const sourcePath of [renderedPath, ...copySources]) {
		try {
			await fs.access(sourcePath);
		} catch {
			return { success: false, error: `Assembly input not found: ${sourcePath}` };
		}
	}

	// The rendered file dictates audio presence: it carries the source audio
	// whenever the source had any, so every joined segment must match it.
	const renderedHasAudio = await probeHasAudio(renderedPath, ffmpegPath, execFileAsync, env);
	const audioBySource = new Map<string, boolean>();
	for (const sourcePath of copySources) {
		audioBySource.set(sourcePath, await probeHasAudio(sourcePath, ffmpegPath, execFileAsync, env));
	}

	const totalMs = segments.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
	const timeout = Math.max(600_000, Math.round(totalMs * 3));

	const tw = Math.floor(width / 2) * 2;
	const th = Math.floor(height / 2) * 2;
	const tempDir = app.getPath("temp");
	const stamp = Date.now();
	const segmentPaths = segments.map((_, i) =>
		path.join(tempDir, `guide-studio-smart-${stamp}-${i}.mp4`),
	);
	const listPath = path.join(tempDir, `guide-studio-smart-${stamp}-list.txt`);
	const halfFrameSec = 0.5 / fps;

	const encodeCopySegment = async (
		seg: Extract<SmartAssembleSegment, { kind: "copy" }>,
		outPath: string,
		videoEncodeArgs: string[],
	) => {
		const startSec = (seg.startMs / 1000).toFixed(3);
		const durationSec = ((seg.endMs - seg.startMs) / 1000).toFixed(3);
		const hasAudio = audioBySource.get(seg.sourcePath) ?? false;

		const inputArgs = ["-ss", startSec, "-i", seg.sourcePath];
		const mapArgs = ["-map", "0:v:0"];
		if (renderedHasAudio) {
			if (hasAudio) {
				mapArgs.push("-map", "0:a:0");
			} else {
				inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
				mapArgs.push("-map", "1:a:0");
			}
		}

		await execFileAsync(
			ffmpegPath,
			[
				...inputArgs,
				"-t",
				durationSec,
				...mapArgs,
				"-vf",
				`scale=${tw}:${th}`,
				"-r",
				String(fps),
				...videoEncodeArgs,
				"-pix_fmt",
				"yuv420p",
				...(renderedHasAudio
					? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
					: ["-an"]),
				"-movflags",
				"+faststart",
				"-y",
				outPath,
			],
			{ timeout, env },
		);
	};

	const cutRenderedSegment = async (
		seg: Extract<SmartAssembleSegment, { kind: "rendered" }>,
		outPath: string,
	) => {
		// -ss before -i with stream copy snaps to the keyframe at or before the
		// seek point; aiming half a frame past the forced keyframe lands on it
		// exactly regardless of float rounding.
		const startSec = (seg.startMs / 1000 + halfFrameSec).toFixed(4);
		const durationSec = ((seg.endMs - seg.startMs) / 1000).toFixed(3);
		await execFileAsync(
			ffmpegPath,
			[
				"-ss",
				startSec,
				"-i",
				renderedPath,
				"-t",
				durationSec,
				"-c",
				"copy",
				"-avoid_negative_ts",
				"make_zero",
				"-y",
				outPath,
			],
			{ timeout, env },
		);
	};

	const hwEncoder = await pickHwH264Encoder(ffmpegPath, execFileAsync, env);
	const videoBitrate = `${Math.max(1, Math.round((bitrate ?? 8_000_000) / 1_000_000))}M`;
	const hwVideoArgs = hwEncoder
		? [
				"-c:v",
				hwEncoder,
				"-b:v",
				videoBitrate,
				...(hwEncoder === "h264_videotoolbox" ? ["-allow_sw", "1"] : []),
			]
		: null;
	const swVideoArgs = ["-c:v", "libx264", "-preset", "veryfast", "-b:v", videoBitrate];

	try {
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			if (seg.kind === "rendered") {
				await cutRenderedSegment(seg, segmentPaths[i]);
				continue;
			}
			try {
				await encodeCopySegment(seg, segmentPaths[i], hwVideoArgs ?? swVideoArgs);
			} catch (err) {
				if (!hwVideoArgs) throw err;
				console.warn(`[ffmpeg] Smart copy segment ${i} failed on ${hwEncoder}, retrying:`, err);
				await encodeCopySegment(seg, segmentPaths[i], swVideoArgs);
			}
		}

		const listBody = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
		await fs.writeFile(listPath, listBody, "utf-8");

		try {
			await execFileAsync(
				ffmpegPath,
				[
					"-f",
					"concat",
					"-safe",
					"0",
					"-i",
					listPath,
					"-c",
					"copy",
					"-movflags",
					"+faststart",
					"-y",
					outputPath,
				],
				{ timeout, env },
			);
		} catch (concatErr) {
			// Mixed WebCodecs/FFmpeg H.264 params can upset stream-copy concat;
			// concatenateVideos re-encodes as a last resort.
			console.warn("[ffmpeg] Smart assembly stream-copy concat failed, re-encoding:", concatErr);
			const fallback = await concatenateVideos(segmentPaths, outputPath);
			if (!fallback.success) {
				return { success: false, error: fallback.error };
			}
		}

		console.log(
			`[ffmpeg] Smart export assembled: ${segments.length} segments (${segments.filter((s) => s.kind === "copy").length} copied, ${segments.filter((s) => s.kind === "rendered").length} rendered) → ${outputPath}`,
		);
		return { success: true };
	} catch (err) {
		console.error("[ffmpeg] Smart assembly failed:", err);
		return { success: false, error: `Smart export assembly failed: ${err}` };
	} finally {
		const cleanupPaths = [...segmentPaths, listPath];
		if (options.cleanupRenderedFile) {
			cleanupPaths.push(renderedPath);
		}
		await Promise.all(cleanupPaths.map((p) => fs.unlink(p).catch(() => undefined)));
	}
}

/**
 * Remux export — the "nothing changed" fast path. When the export has no
 * edits at all, the source's compressed frames are already exactly what the
 * output needs, so re-encoding is pure waste (this is what makes CapCut-style
 * exports feel instant). H.264 sources are rewrapped with `-c:v copy` in
 * seconds regardless of length; VP8/VP9 sources (browser recordings) can't
 * live in an .mp4, so they take one hardware-encoded transcode pass instead.
 */
export async function remuxExport(
	inputPath: string,
	outputPath: string,
): Promise<{ success: boolean; error?: string; mode?: "remux" | "transcode" }> {
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found" };
	}

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const env = getFfmpegEnv(ffmpegPath);

	try {
		await fs.access(inputPath);
	} catch {
		return { success: false, error: `Input file not found: ${inputPath}` };
	}

	const info = await probeStreamInfo(inputPath, ffmpegPath, execFileAsync, env);
	const timeout = Math.max(600_000, Math.round((info.durationMs ?? 0) * 2));

	if (info.videoCodec === "h264") {
		// AAC audio copies straight across; anything else (e.g. Opus) is
		// transcoded to AAC — still near-instant since only audio re-encodes.
		const audioArgs =
			info.audioCodec === "aac"
				? ["-c:a", "copy"]
				: info.audioCodec
					? ["-c:a", "aac", "-b:a", "160k"]
					: ["-an"];

		try {
			console.log("[ffmpeg] Remux export: stream-copying H.264 video");
			await execFileAsync(
				ffmpegPath,
				[
					"-i",
					inputPath,
					"-c:v",
					"copy",
					...audioArgs,
					"-movflags",
					"+faststart",
					"-y",
					outputPath,
				],
				{ timeout, env },
			);
			console.log("[ffmpeg] Remux export succeeded (no re-encode)");
			return { success: true, mode: "remux" };
		} catch (err) {
			console.warn("[ffmpeg] Stream copy failed, falling back to transcode:", err);
		}
	}

	// Non-H.264 source (or copy failed) — single transcode pass, hardware first
	const hasAudio = info.audioCodec !== null;
	const hwEncoder = await pickHwH264Encoder(ffmpegPath, execFileAsync, env);
	for (const encoder of hwEncoder ? [hwEncoder, null] : [null]) {
		try {
			console.log(`[ffmpeg] Remux export: transcoding with ${encoder ?? "libx264"}`);
			await execFileAsync(
				ffmpegPath,
				["-i", inputPath, ...buildH264EncodeArgs(encoder, hasAudio), "-y", outputPath],
				{ timeout, env },
			);
			return { success: true, mode: "transcode" };
		} catch (err) {
			if (encoder === null) {
				console.error("[ffmpeg] Remux export failed:", err);
				return { success: false, error: `Remux export failed: ${err}` };
			}
			console.warn(`[ffmpeg] Transcode with ${encoder} failed, retrying with libx264:`, err);
		}
	}
	return { success: false, error: "Remux export failed" };
}

export type GifOptimizeSizePreset = "small" | "medium" | "large" | "original";

// Palette size per export preset. Screen recordings rarely need the full 256
// colors: at 128 the re-encode of a busy 720p capture measured ~47 dB PSNR
// against the 256-color result (visually identical) while cutting file size
// ~20%. Small targets 480p where quantization noise is even less visible.
const GIF_MAX_COLORS_BY_PRESET: Record<GifOptimizeSizePreset, number> = {
	small: 96,
	medium: 128,
	large: 256,
	original: 256,
};

/**
 * Shrink a GIF in place with a two-pass FFmpeg palette re-encode.
 *
 * gif.js writes every frame as a full image with its own local palette. This
 * pass rebuilds a single palette weighted toward changing regions
 * (palettegen=stats_mode=diff) and re-encodes storing only the rectangle that
 * changed per frame (paletteuse=diff_mode=rectangle) with transparency for
 * unchanged pixels — typically 5-15x smaller for screen recordings. Bayer
 * dithering is used because it is stable across frames, so static areas stay
 * byte-identical and compress away.
 *
 * The result replaces the input only when it is actually smaller.
 */
export async function optimizeGif(
	filePath: string,
	loop = true,
	sizePreset: GifOptimizeSizePreset = "original",
): Promise<{ success: boolean; originalBytes?: number; optimizedBytes?: number; error?: string }> {
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found" };
	}

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const env = getFfmpegEnv(ffmpegPath);

	let originalBytes: number;
	try {
		originalBytes = (await fs.stat(filePath)).size;
	} catch {
		return { success: false, error: `GIF not found: ${filePath}` };
	}

	const maxColors = GIF_MAX_COLORS_BY_PRESET[sizePreset] ?? 256;
	const tempPath = `${filePath}.optimizing.gif`;
	try {
		await execFileAsync(
			ffmpegPath,
			[
				"-i",
				filePath,
				"-filter_complex",
				`split[a][b];[a]palettegen=stats_mode=diff:max_colors=${maxColors}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
				// The gif muxer does not copy the source's Netscape loop
				// extension — re-state it (0 = infinite, -1 = play once).
				"-loop",
				loop ? "0" : "-1",
				"-y",
				tempPath,
			],
			{ timeout: 600_000, env },
		);

		const optimizedBytes = (await fs.stat(tempPath)).size;
		if (optimizedBytes > 0 && optimizedBytes < originalBytes) {
			await fs.rename(tempPath, filePath);
			console.log(
				`[ffmpeg] GIF optimized: ${(originalBytes / 1024 / 1024).toFixed(1)}MB -> ${(optimizedBytes / 1024 / 1024).toFixed(1)}MB`,
			);
			return { success: true, originalBytes, optimizedBytes };
		}

		// Optimized output is not smaller — keep the original.
		await fs.unlink(tempPath).catch(() => {
			/* intentional noop */
		});
		return { success: true, originalBytes, optimizedBytes: originalBytes };
	} catch (err) {
		console.error("[ffmpeg] GIF optimization failed:", err);
		await fs.unlink(tempPath).catch(() => {
			/* intentional noop */
		});
		return { success: false, error: `GIF optimization failed: ${err}` };
	}
}

export interface ConvertVideoToGifOptions {
	fps: number;
	width: number;
	height: number;
	loop: boolean;
	sizePreset?: GifOptimizeSizePreset;
	/** Kept segments in ms (trim cuts already inverted). Omit to keep everything. */
	segments?: Array<{ startMs: number; endMs: number }>;
	/** Fractional crop (0-1 of source dimensions) applied before scaling. */
	crop?: { x: number; y: number; width: number; height: number };
}

/**
 * Convert a video file straight to an optimized GIF, bypassing the canvas
 * compositor entirely — no wallpaper, padding, zoom, cursor, or webcam
 * layers. Because the only changing pixels are the recording itself, the
 * palette diff-encode compresses dramatically better than a composited
 * export (measured ~3-4x smaller on real screen recordings).
 */
export async function convertVideoToGif(
	inputPath: string,
	outputPath: string,
	options: ConvertVideoToGifOptions,
): Promise<{ success: boolean; outputBytes?: number; error?: string }> {
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		return { success: false, error: "FFmpeg not found" };
	}

	const fps = Math.min(50, Math.max(1, Math.round(Number(options.fps) || 15)));
	const width = Math.max(2, Math.round(Number(options.width) || 0));
	const height = Math.max(2, Math.round(Number(options.height) || 0));
	if (!Number.isFinite(width) || !Number.isFinite(height)) {
		return { success: false, error: "Invalid output dimensions" };
	}
	const maxColors = GIF_MAX_COLORS_BY_PRESET[options.sizePreset ?? "original"] ?? 256;

	// Trim segments are pre-cut into a temp MP4 via quickTrimExport rather
	// than a trim+setpts+concat filtergraph: the bundled Remotion ffmpeg has
	// no setpts filter, so the filtergraph route fails with "Filter not found".
	const segments = (options.segments ?? []).filter(
		(s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs,
	);
	let sourcePath = inputPath;
	let tempCutPath: string | null = null;
	if (segments.length > 0) {
		tempCutPath = path.join(app.getPath("temp"), `guide-studio-gif-cut-${Date.now()}.mp4`);
		const cutResult = await quickTrimExport(inputPath, tempCutPath, segments);
		if (!cutResult.success) {
			await fs.unlink(tempCutPath).catch(() => undefined);
			return { success: false, error: cutResult.error || "Failed to cut trim segments" };
		}
		sourcePath = tempCutPath;
	}

	const filterParts: string[] = [];
	const chain: string[] = [];
	const crop = options.crop;
	const isDefaultCrop =
		!crop || (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1);
	if (!isDefaultCrop && crop) {
		const cx = Math.min(1, Math.max(0, crop.x));
		const cy = Math.min(1, Math.max(0, crop.y));
		const cw = Math.min(1 - cx, Math.max(0.01, crop.width));
		const ch = Math.min(1 - cy, Math.max(0.01, crop.height));
		chain.push(
			`crop=iw*${cw.toFixed(4)}:ih*${ch.toFixed(4)}:iw*${cx.toFixed(4)}:ih*${cy.toFixed(4)}`,
		);
	}
	// Frame rate is set with the -r output option instead of the fps filter,
	// which the bundled ffmpeg also lacks. Output -r drops frames after the
	// filtergraph; palettegen sees every source frame, which only makes the
	// palette marginally more informed.
	chain.push(`scale=${width}:${height}:flags=lanczos`);
	chain.push("split[pal_a][pal_b]");
	filterParts.push(`[0:v]${chain.join(",")}`);
	filterParts.push(`[pal_a]palettegen=stats_mode=diff:max_colors=${maxColors}[p]`);
	filterParts.push("[pal_b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle");

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const env = getFfmpegEnv(ffmpegPath);

	try {
		await execFileAsync(
			ffmpegPath,
			[
				"-i",
				sourcePath,
				"-filter_complex",
				filterParts.join(";"),
				"-r",
				String(fps),
				"-loop",
				options.loop ? "0" : "-1",
				"-y",
				outputPath,
			],
			{ timeout: 600_000, env },
		);

		const outputBytes = (await fs.stat(outputPath)).size;
		console.log(
			`[ffmpeg] Direct GIF conversion: ${(outputBytes / 1024 / 1024).toFixed(1)}MB (${width}x${height} @ ${fps}fps, ${maxColors} colors)`,
		);
		return { success: true, outputBytes };
	} catch (err) {
		console.error("[ffmpeg] Direct GIF conversion failed:", err);
		await fs.unlink(outputPath).catch(() => {
			/* intentional noop */
		});
		return { success: false, error: `GIF conversion failed: ${err}` };
	} finally {
		if (tempCutPath) {
			await fs.unlink(tempCutPath).catch(() => undefined);
		}
	}
}

async function findSystemFfmpeg(): Promise<string | null> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const { stdout } = await execFileAsync(cmd, ["ffmpeg"]);
		const ffmpegPath = stdout.trim().split("\n")[0]?.trim();
		if (ffmpegPath) return ffmpegPath;
	} catch {
		// FFmpeg not on PATH
	}

	return null;
}
