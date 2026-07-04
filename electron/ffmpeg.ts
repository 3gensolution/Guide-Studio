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
 * The video is re-encoded (libx264 veryfast + AAC) rather than stream-copied:
 * stream copy can only cut at keyframes (screen recordings often have 5-10s
 * GOPs, making trims off by seconds) and would put VP8/VP9 webm streams into
 * an .mp4 container that many players reject. Re-encoding is frame-accurate,
 * always produces a compliant H.264 MP4, and typically shrinks the file.
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

	const encodeArgs = [
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-crf",
		"23",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		...(hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : []),
	];

	const totalKeptMs = validSegments.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
	// Generous timeout: at least 10 minutes, scaled up for long exports.
	const timeout = Math.max(600_000, Math.round(totalKeptMs * 2));

	try {
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
			// Multiple segments: cut and join in one pass with trim/concat filters.
			// Frame-accurate and avoids temp files and concat-demuxer timestamp
			// discontinuities.
			const filterParts: string[] = [];
			const concatInputs: string[] = [];
			for (let i = 0; i < validSegments.length; i++) {
				const startSec = (validSegments[i].startMs / 1000).toFixed(3);
				const endSec = (validSegments[i].endMs / 1000).toFixed(3);
				filterParts.push(`[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS[v${i}]`);
				concatInputs.push(`[v${i}]`);
				if (hasAudio) {
					filterParts.push(
						`[0:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS[a${i}]`,
					);
					concatInputs[concatInputs.length - 1] += `[a${i}]`;
				}
			}
			const concatOut = hasAudio ? "[outv][outa]" : "[outv]";
			filterParts.push(
				`${concatInputs.join("")}concat=n=${validSegments.length}:v=1:a=${hasAudio ? 1 : 0}${concatOut}`,
			);

			console.log(`[ffmpeg] Quick trim: ${validSegments.length} segments via concat filter`);
			await execFileAsync(
				ffmpegPath,
				[
					"-i",
					inputPath,
					"-filter_complex",
					filterParts.join(";"),
					"-map",
					"[outv]",
					...(hasAudio ? ["-map", "[outa]"] : []),
					...encodeArgs,
					"-y",
					outputPath,
				],
				{ timeout, env },
			);
		}

		console.log("[ffmpeg] Quick trim succeeded");
		return { success: true };
	} catch (err) {
		console.error("[ffmpeg] Quick trim failed:", err);
		return { success: false, error: `Quick trim failed: ${err}` };
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
