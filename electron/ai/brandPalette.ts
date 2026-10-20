import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { MotionBrandPalette } from "../../src/lib/remotion/MotionGraphicsComposition";
import { getFfmpegEnv, getFfmpegPath } from "../ffmpeg";

const execFile = promisify(execFileCallback);

export interface RgbaSample {
	r: number;
	g: number;
	b: number;
	a: number;
}

const FALLBACK_PALETTE: MotionBrandPalette = {
	// A neutral light field is the safe no-reference default. Dark treatment is
	// chosen only when supplied media actually supports it; an arbitrary navy
	// canvas makes every unbranded cut look like the same template.
	background: "#F5F7FB",
	surface: "#FFFFFF",
	primary: "#5B5CE2",
	secondary: "#0EA5E9",
	highlight: "#C7D2FE",
	text: "#111827",
	mutedText: "#475569",
	mode: "light",
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function toHex(value: number): string {
	return Math.round(clamp(value, 0, 255))
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function luminance(sample: Pick<RgbaSample, "r" | "g" | "b">): number {
	const linear = (value: number) => {
		const normalized = value / 255;
		return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(sample.r) + 0.7152 * linear(sample.g) + 0.0722 * linear(sample.b);
}

function saturation(sample: Pick<RgbaSample, "r" | "g" | "b">): number {
	const max = Math.max(sample.r, sample.g, sample.b) / 255;
	const min = Math.min(sample.r, sample.g, sample.b) / 255;
	return max === 0 ? 0 : (max - min) / max;
}

function blendHex(first: string, second: string, amount: number): string {
	const parse = (value: string) => [
		Number.parseInt(value.slice(1, 3), 16),
		Number.parseInt(value.slice(3, 5), 16),
		Number.parseInt(value.slice(5, 7), 16),
	];
	const [ar, ag, ab] = parse(first);
	const [br, bg, bb] = parse(second);
	return rgbToHex(ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount);
}

interface ColorBin {
	count: number;
	r: number;
	g: number;
	b: number;
	averageSaturation: number;
}

/**
 * Derive a restrained art-direction palette from supplied media. The
 * algorithm deliberately ignores tiny noise and near-black/near-white
 * chroma when choosing accents, while retaining light brand backgrounds such
 * as a logo supplied on white paper.
 */
export function createBrandPalette(samples: readonly RgbaSample[]): MotionBrandPalette {
	const visible = samples.filter((sample) => sample.a >= 24);
	if (visible.length === 0) return FALLBACK_PALETTE;

	let lightNeutral = 0;
	let darkNeutral = 0;
	let totalLuminance = 0;
	const bins = new Map<number, ColorBin>();
	for (const sample of visible) {
		const light = luminance(sample);
		const chroma = saturation(sample);
		totalLuminance += light;
		if (light >= 0.84 && chroma <= 0.18) lightNeutral += 1;
		if (light <= 0.16 && chroma <= 0.18) darkNeutral += 1;

		const r = Math.round(sample.r / 16) * 16;
		const g = Math.round(sample.g / 16) * 16;
		const b = Math.round(sample.b / 16) * 16;
		const key = (r << 16) | (g << 8) | b;
		const current = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0, averageSaturation: 0 };
		current.count += 1;
		current.r += sample.r;
		current.g += sample.g;
		current.b += sample.b;
		current.averageSaturation += chroma;
		bins.set(key, current);
	}

	const meanLuminance = totalLuminance / visible.length;
	const lightRatio = lightNeutral / visible.length;
	const darkRatio = darkNeutral / visible.length;
	const mode: MotionBrandPalette["mode"] =
		lightRatio >= 0.22 || (meanLuminance >= 0.58 && lightRatio >= 0.1)
			? "light"
			: darkRatio >= 0.22 || meanLuminance < 0.46
				? "dark"
				: "light";

	const candidates = [...bins.values()]
		.map((bin) => ({
			...bin,
			r: bin.r / bin.count,
			g: bin.g / bin.count,
			b: bin.b / bin.count,
			averageSaturation: bin.averageSaturation / bin.count,
		}))
		.filter(
			(bin) => bin.averageSaturation >= 0.28 && luminance(bin) >= 0.1 && luminance(bin) <= 0.92,
		)
		.sort((a, b) => b.count * (0.5 + b.averageSaturation) - a.count * (0.5 + a.averageSaturation));

	const primary = candidates[0]
		? rgbToHex(candidates[0].r, candidates[0].g, candidates[0].b)
		: FALLBACK_PALETTE.primary;
	const secondaryCandidate = candidates.find((candidate) => {
		const primaryDistance =
			Math.abs(candidate.r - (candidates[0]?.r ?? 129)) +
			Math.abs(candidate.g - (candidates[0]?.g ?? 140)) +
			Math.abs(candidate.b - (candidates[0]?.b ?? 248));
		return primaryDistance > 80;
	});
	const secondary = secondaryCandidate
		? rgbToHex(secondaryCandidate.r, secondaryCandidate.g, secondaryCandidate.b)
		: FALLBACK_PALETTE.secondary;

	const background = mode === "light" ? "#F5F7FB" : "#0B1020";
	const surface = mode === "light" ? "#FFFFFF" : "#121A31";
	const text = mode === "light" ? "#111827" : "#F8FAFC";
	const mutedText = mode === "light" ? "#475569" : "#CBD5E1";

	return {
		background,
		surface,
		primary,
		secondary,
		highlight: blendHex(primary, mode === "light" ? "#FFFFFF" : "#FFFFFF", 0.48),
		text,
		mutedText,
		mode,
	};
}

export function defaultBrandPalette(): MotionBrandPalette {
	return { ...FALLBACK_PALETTE };
}

/** Extract a small bounded RGBA sample through the app's trusted FFmpeg binary. */
export async function extractBrandPaletteFromFile(
	filePath: string,
	kind: "image" | "video",
): Promise<MotionBrandPalette | undefined> {
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) return undefined;
	try {
		const result = await execFile(
			ffmpegPath,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				...(kind === "video" ? ["-ss", "0.8"] : []),
				"-i",
				filePath,
				"-vf",
				"scale=64:64:force_original_aspect_ratio=decrease,pad=64:64:(ow-iw)/2:(oh-ih)/2:color=black@0",
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"pipe:1",
			],
			{
				env: getFfmpegEnv(ffmpegPath),
				timeout: 20_000,
				maxBuffer: 64 * 64 * 4 + 1024,
				encoding: "buffer",
			},
		);
		const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
		const samples: RgbaSample[] = [];
		for (let index = 0; index + 3 < bytes.length; index += 4) {
			samples.push({
				r: bytes[index] ?? 0,
				g: bytes[index + 1] ?? 0,
				b: bytes[index + 2] ?? 0,
				a: bytes[index + 3] ?? 0,
			});
		}
		return samples.length ? createBrandPalette(samples) : undefined;
	} catch {
		return undefined;
	}
}
