/**
 * Renders an intro directly from IntroConfig (no template system).
 *
 * Exports:
 * - `drawIntroFrame` — draw a single frame (used by preview + export)
 * - `renderIntroToBlob` — encode to MP4 blob
 * - `loadIntroImages` — pre-load image data URLs into drawable elements
 */
import { VideoMuxer } from "@/lib/exporter/muxer";
import type {
	IntroAnimationStyle,
	IntroConfig,
	IntroImageEntry,
	IntroTextPosition,
} from "./introTypes";

const INTRO_WIDTH = 1920;
const INTRO_HEIGHT = 1080;
const INTRO_FPS = 30;
const INTRO_BITRATE = 8_000_000;
const INTRO_CODEC = "avc1.640033";

type AnyCanvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* ── Background palette ─────────────────────────────────────────────── */

const BACKGROUNDS: Record<
	string,
	{ type: "solid"; color: string } | { type: "gradient"; from: string; to: string }
> = {
	"brand-dark": { type: "solid", color: "#171412" },
	navy: { type: "solid", color: "#0f172a" },
	"deep-purple": { type: "solid", color: "#1e1033" },
	charcoal: { type: "solid", color: "#292524" },
	slate: { type: "solid", color: "#1e293b" },
	"gradient-blue": { type: "gradient", from: "#0f172a", to: "#1e3a5f" },
	"gradient-green": { type: "gradient", from: "#0f172a", to: "#064e3b" },
	"gradient-purple": { type: "gradient", from: "#1e1033", to: "#312e81" },
};

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/* ── Helpers ─────────────────────────────────────────────────────────── */

function hexToRgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16) || 0;
	const g = parseInt(hex.slice(3, 5), 16) || 0;
	const b = parseInt(hex.slice(5, 7), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

/** Ease-out cubic for smoother animations. */
function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

/** Simple seeded pseudo-random for deterministic glitch. */
function seededRandom(seed: number): number {
	const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
	return x - Math.floor(x);
}

/* ── Text position mapping ───────────────────────────────────────────── */

function getTextAnchor(
	position: IntroTextPosition,
	w: number,
	h: number,
	scale: number,
): { x: number; y: number; align: CanvasTextAlign } {
	const pad = 80 * scale;
	switch (position) {
		case "top":
			return { x: w / 2, y: pad + 60 * scale, align: "center" };
		case "bottom":
			return { x: w / 2, y: h - pad - 60 * scale, align: "center" };
		case "top-left":
			return { x: pad, y: pad + 60 * scale, align: "left" };
		case "top-right":
			return { x: w - pad, y: pad + 60 * scale, align: "right" };
		case "bottom-left":
			return { x: pad, y: h - pad - 60 * scale, align: "left" };
		case "bottom-right":
			return { x: w - pad, y: h - pad - 60 * scale, align: "right" };
		case "center":
		default:
			return { x: w / 2, y: h / 2, align: "center" };
	}
}

/* ── Animation engine ────────────────────────────────────────────────── */

interface AnimationTransform {
	alpha: number;
	translateX: number;
	translateY: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	blur: number;
}

function computeAnimation(
	style: IntroAnimationStyle,
	progress: number,
	fadeInPct: number,
	fadeOutPct: number,
	scale: number,
): AnimationTransform {
	// Base fade envelope
	const fadeIn = clamp(progress / fadeInPct, 0, 1);
	const fadeOut = clamp((1 - progress) / fadeOutPct, 0, 1);
	const easedIn = easeOutCubic(fadeIn);
	const alpha = easedIn * fadeOut;

	const result: AnimationTransform = {
		alpha,
		translateX: 0,
		translateY: 0,
		scaleX: 1,
		scaleY: 1,
		rotation: 0,
		blur: 0,
	};

	switch (style) {
		case "fade":
			// Pure opacity — already handled by alpha envelope
			break;

		case "slide-up":
			result.translateY = (1 - easedIn) * 80 * scale;
			break;

		case "slide-down":
			result.translateY = -(1 - easedIn) * 80 * scale;
			break;

		case "slide-left":
			result.translateX = (1 - easedIn) * 120 * scale;
			break;

		case "slide-right":
			result.translateX = -(1 - easedIn) * 120 * scale;
			break;

		case "scale":
			result.scaleX = result.scaleY = 0.3 + 0.7 * easedIn;
			break;

		case "rotate":
			result.rotation = (1 - easedIn) * -Math.PI * 0.15;
			result.scaleX = result.scaleY = 0.6 + 0.4 * easedIn;
			break;

		case "blur":
			result.blur = (1 - easedIn) * 20 * scale;
			break;

		case "typewriter":
		case "glitch":
		case "particle":
			// These are handled specially in the draw function
			break;
	}

	return result;
}

/* ── Image loading ───────────────────────────────────────────────────── */

type LoadedImages = Map<string, HTMLImageElement | ImageBitmap>;

/**
 * Pre-load all images from an IntroConfig.
 * Works in both window (HTMLImageElement) and worker (ImageBitmap via OffscreenCanvas) contexts.
 */
export async function loadIntroImages(config: IntroConfig): Promise<LoadedImages> {
	const map: LoadedImages = new Map();
	const entries: { id: string; url: string }[] = [];

	if (config.customBackgroundImage) {
		entries.push({ id: "__bg__", url: config.customBackgroundImage });
	}
	for (const img of config.images) {
		entries.push({ id: img.id, url: img.dataUrl });
	}

	await Promise.all(
		entries.map(
			({ id, url }) =>
				new Promise<void>((resolve) => {
					if (typeof HTMLImageElement !== "undefined") {
						const el = new Image();
						el.onload = () => {
							map.set(id, el);
							resolve();
						};
						el.onerror = () => resolve(); // skip broken images
						el.src = url;
					} else {
						// OffscreenCanvas context (worker): use fetch + createImageBitmap
						fetch(url)
							.then((r) => r.blob())
							.then((b) => createImageBitmap(b))
							.then((bmp) => {
								map.set(id, bmp);
								resolve();
							})
							.catch(() => resolve());
					}
				}),
		),
	);

	return map;
}

/* ── Image position mapping ──────────────────────────────────────────── */

function getImagePosition(
	entry: IntroImageEntry,
	w: number,
	h: number,
	imgW: number,
	imgH: number,
): { x: number; y: number; drawW: number; drawH: number } {
	const drawW = imgW * entry.scale;
	const drawH = imgH * entry.scale;
	const pad = 40;

	let x: number;
	let y: number;

	switch (entry.position) {
		case "top-left":
			x = pad;
			y = pad;
			break;
		case "top":
			x = (w - drawW) / 2;
			y = pad;
			break;
		case "top-right":
			x = w - drawW - pad;
			y = pad;
			break;
		case "bottom-left":
			x = pad;
			y = h - drawH - pad;
			break;
		case "bottom":
			x = (w - drawW) / 2;
			y = h - drawH - pad;
			break;
		case "bottom-right":
			x = w - drawW - pad;
			y = h - drawH - pad;
			break;
		case "center":
		default:
			x = (w - drawW) / 2;
			y = (h - drawH) / 2;
			break;
	}

	return { x, y, drawW, drawH };
}

/* ── Main draw function ──────────────────────────────────────────────── */

/**
 * Draw a single intro frame. `progress` is 0..1 across the intro duration.
 */
export function drawIntroFrame(
	ctx: AnyCanvas2DContext,
	w: number,
	h: number,
	config: IntroConfig,
	progress: number,
	loadedImages?: LoadedImages,
): void {
	const scale = h / 1080;

	// ── Background ──────────────────────────────────────────────────
	const bg = BACKGROUNDS[config.backgroundColor] || BACKGROUNDS["brand-dark"];
	if (bg.type === "gradient") {
		const grad = ctx.createLinearGradient(0, 0, w, h);
		grad.addColorStop(0, bg.from);
		grad.addColorStop(1, bg.to);
		ctx.fillStyle = grad;
	} else {
		ctx.fillStyle = bg.color;
	}
	ctx.fillRect(0, 0, w, h);

	// ── Custom background image ─────────────────────────────────────
	if (config.customBackgroundImage && loadedImages?.has("__bg__")) {
		const bgImg = loadedImages.get("__bg__")!;
		// Cover fit
		const imgAspect = bgImg.width / bgImg.height;
		const canvasAspect = w / h;
		let drawW: number;
		let drawH: number;
		if (imgAspect > canvasAspect) {
			drawH = h;
			drawW = h * imgAspect;
		} else {
			drawW = w;
			drawH = w / imgAspect;
		}
		ctx.drawImage(bgImg as CanvasImageSource, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
	}

	// ── Accent glow ─────────────────────────────────────────────────
	const glowRadius = Math.min(w, h) * 0.6;
	const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, glowRadius);
	glow.addColorStop(0, hexToRgba(config.accentColor, 0.12));
	glow.addColorStop(1, hexToRgba(config.accentColor, 0));
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, w, h);

	// ── Background/decoration images (drawn before text) ────────────
	if (loadedImages) {
		for (const entry of config.images) {
			if (entry.role === "background") {
				const img = loadedImages.get(entry.id);
				if (!img) continue;
				const pos = getImagePosition(entry, w, h, img.width * scale, img.height * scale);
				ctx.globalAlpha = entry.opacity;
				ctx.drawImage(img as CanvasImageSource, pos.x, pos.y, pos.drawW, pos.drawH);
				ctx.globalAlpha = 1;
			}
		}
	}

	// ── Compute text position ───────────────────────────────────────
	const anchor = getTextAnchor(config.textPosition, w, h, scale);
	const titleFontSize = Math.max(12, Math.round(72 * scale * config.titleSize));
	const subtitleFontSize = Math.max(10, Math.round(32 * scale * config.subtitleSize));

	// Stagger: subtitle animation starts later
	const staggerFrac = config.animationStagger / config.durationMs;
	const titleProgress = progress;
	const subtitleProgress = clamp((progress - staggerFrac) / (1 - staggerFrac), 0, 1);

	// ── Draw title ──────────────────────────────────────────────────
	drawAnimatedText(
		ctx,
		config.title,
		anchor.x,
		anchor.y - 30 * scale,
		titleFontSize,
		`bold ${titleFontSize}px ${FONT_FAMILY}`,
		`rgba(255, 255, 255, `,
		0.95,
		config.titleAnimation,
		titleProgress,
		config.fadeInPercent,
		config.fadeOutPercent,
		scale,
		w,
		anchor.align,
	);

	// ── Draw subtitle ───────────────────────────────────────────────
	drawAnimatedText(
		ctx,
		config.subtitle,
		anchor.x,
		anchor.y + 40 * scale,
		subtitleFontSize,
		`400 ${subtitleFontSize}px ${FONT_FAMILY}`,
		`rgba(255, 255, 255, `,
		0.6,
		config.subtitleAnimation,
		subtitleProgress,
		config.fadeInPercent,
		config.fadeOutPercent,
		scale,
		w,
		anchor.align,
	);

	// ── Accent underline beneath title ──────────────────────────────
	const titleAnim = computeAnimation(
		config.titleAnimation,
		titleProgress,
		config.fadeInPercent,
		config.fadeOutPercent,
		scale,
	);
	const lineAlpha = titleAnim.alpha;
	const lineEased = easeOutCubic(clamp(titleProgress / config.fadeInPercent, 0, 1));
	const lineWidth =
		Math.min(config.title.length * 28 * scale * config.titleSize, w * 0.4) * lineEased;
	const lineY = anchor.y - 30 * scale + titleFontSize * 0.4 + titleAnim.translateY;

	ctx.strokeStyle = hexToRgba(config.accentColor, lineAlpha * 0.7);
	ctx.lineWidth = Math.max(1, 3 * scale);
	ctx.beginPath();
	if (anchor.align === "center") {
		ctx.moveTo(anchor.x - lineWidth / 2, lineY);
		ctx.lineTo(anchor.x + lineWidth / 2, lineY);
	} else if (anchor.align === "left") {
		ctx.moveTo(anchor.x, lineY);
		ctx.lineTo(anchor.x + lineWidth, lineY);
	} else {
		ctx.moveTo(anchor.x - lineWidth, lineY);
		ctx.lineTo(anchor.x, lineY);
	}
	ctx.stroke();

	// ── Logo and decoration images (drawn after text) ───────────────
	if (loadedImages) {
		for (const entry of config.images) {
			if (entry.role === "logo" || entry.role === "decoration") {
				const img = loadedImages.get(entry.id);
				if (!img) continue;
				const pos = getImagePosition(entry, w, h, img.width * scale, img.height * scale);
				// Fade images with overall progress
				const imgFadeIn = clamp(progress / config.fadeInPercent, 0, 1);
				const imgFadeOut = clamp((1 - progress) / config.fadeOutPercent, 0, 1);
				ctx.globalAlpha = entry.opacity * easeOutCubic(imgFadeIn) * imgFadeOut;
				ctx.drawImage(img as CanvasImageSource, pos.x, pos.y, pos.drawW, pos.drawH);
				ctx.globalAlpha = 1;
			}
		}
	}
}

/* ── Animated text drawing ───────────────────────────────────────────── */

function drawAnimatedText(
	ctx: AnyCanvas2DContext,
	text: string,
	x: number,
	y: number,
	fontSize: number,
	font: string,
	colorPrefix: string,
	maxOpacity: number,
	style: IntroAnimationStyle,
	progress: number,
	fadeInPct: number,
	fadeOutPct: number,
	scale: number,
	canvasWidth: number,
	align: CanvasTextAlign,
): void {
	if (!text) return;

	const anim = computeAnimation(style, progress, fadeInPct, fadeOutPct, scale);

	ctx.textAlign = align;
	ctx.textBaseline = "middle";
	ctx.font = font;

	// ── Typewriter: character-by-character reveal ────────────────────
	if (style === "typewriter") {
		const revealProgress = clamp(progress / fadeInPct, 0, 1);
		const charsToShow = Math.floor(revealProgress * text.length);
		const fadeOut = clamp((1 - progress) / fadeOutPct, 0, 1);
		const visibleText = text.substring(0, charsToShow);

		ctx.fillStyle = `${colorPrefix}${maxOpacity * fadeOut})`;
		ctx.fillText(visibleText, x, y, canvasWidth * 0.8);

		// Blinking cursor
		if (charsToShow < text.length && Math.floor(progress * 20) % 2 === 0) {
			const measured = ctx.measureText(visibleText);
			let cursorX: number;
			if (align === "center") {
				cursorX =
					x +
					measured.width / 2 -
					ctx.measureText(text.substring(0, charsToShow)).width / 2 +
					measured.width;
			} else if (align === "left") {
				cursorX = x + measured.width;
			} else {
				cursorX = x;
			}
			// Simplified cursor placement
			cursorX = x + (align === "center" ? 0 : 0);
			const cursorMeasure = ctx.measureText(visibleText);
			if (align === "center") {
				cursorX = x - cursorMeasure.width / 2 + cursorMeasure.width + 2;
			} else if (align === "left") {
				cursorX = x + cursorMeasure.width + 2;
			} else {
				cursorX = x + 2;
			}
			ctx.fillRect(cursorX, y - fontSize * 0.4, 2 * scale, fontSize * 0.8);
		}
		return;
	}

	// ── Glitch: RGB split + jitter ──────────────────────────────────
	if (style === "glitch") {
		const fadeIn = clamp(progress / fadeInPct, 0, 1);
		const fadeOut = clamp((1 - progress) / fadeOutPct, 0, 1);
		const alpha = easeOutCubic(fadeIn) * fadeOut;
		const glitchIntensity = (1 - easeOutCubic(fadeIn)) * 15 * scale;
		const seed = Math.floor(progress * 100);

		// Red channel offset
		const rOff = (seededRandom(seed) - 0.5) * glitchIntensity * 2;
		ctx.fillStyle = `rgba(255, 50, 50, ${alpha * maxOpacity * 0.7})`;
		ctx.fillText(text, x + rOff, y, canvasWidth * 0.8);

		// Blue channel offset
		const bOff = (seededRandom(seed + 1) - 0.5) * glitchIntensity * 2;
		ctx.fillStyle = `rgba(50, 50, 255, ${alpha * maxOpacity * 0.7})`;
		ctx.fillText(text, x + bOff, y, canvasWidth * 0.8);

		// Main white text
		const jitterY = (seededRandom(seed + 2) - 0.5) * glitchIntensity;
		ctx.fillStyle = `${colorPrefix}${alpha * maxOpacity})`;
		ctx.fillText(text, x, y + jitterY, canvasWidth * 0.8);
		return;
	}

	// ── Particle: dots converge to text position ────────────────────
	if (style === "particle") {
		const fadeIn = clamp(progress / fadeInPct, 0, 1);
		const fadeOut = clamp((1 - progress) / fadeOutPct, 0, 1);
		const easedIn = easeOutCubic(fadeIn);

		// Measure text for particle placement
		const metrics = ctx.measureText(text);
		const textWidth = Math.min(metrics.width, canvasWidth * 0.8);
		let startX: number;
		if (align === "center") startX = x - textWidth / 2;
		else if (align === "right") startX = x - textWidth;
		else startX = x;

		const particleCount = Math.min(text.length * 4, 80);

		if (easedIn < 0.95) {
			// Draw particles converging
			for (let i = 0; i < particleCount; i++) {
				const seed = i * 7.31;
				const targetX = startX + (i / particleCount) * textWidth;
				const targetY = y;
				const startPX = targetX + (seededRandom(seed) - 0.5) * 400 * scale;
				const startPY = targetY + (seededRandom(seed + 1) - 0.5) * 400 * scale;
				const px = startPX + (targetX - startPX) * easedIn;
				const py = startPY + (targetY - startPY) * easedIn;
				const size = (1.5 + seededRandom(seed + 2) * 2) * scale;
				ctx.fillStyle = `${colorPrefix}${easedIn * maxOpacity * fadeOut * 0.8})`;
				ctx.beginPath();
				ctx.arc(px, py, size, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// Fade in text as particles converge
		if (easedIn > 0.5) {
			const textAlpha = clamp((easedIn - 0.5) * 2, 0, 1);
			ctx.fillStyle = `${colorPrefix}${textAlpha * maxOpacity * fadeOut})`;
			ctx.fillText(text, x, y, canvasWidth * 0.8);
		}
		return;
	}

	// ── Standard transform-based animations ─────────────────────────
	ctx.save();
	ctx.translate(x + anim.translateX, y + anim.translateY);

	if (anim.rotation !== 0) {
		ctx.rotate(anim.rotation);
	}
	if (anim.scaleX !== 1 || anim.scaleY !== 1) {
		ctx.scale(anim.scaleX, anim.scaleY);
	}

	// Apply blur via filter if supported
	if (style === "blur" && anim.blur > 0.5) {
		try {
			(ctx as CanvasRenderingContext2D).filter = `blur(${anim.blur}px)`;
		} catch {
			// OffscreenCanvas may not support filter — degrade gracefully
		}
	}

	ctx.fillStyle = `${colorPrefix}${anim.alpha * maxOpacity})`;
	// Draw at origin since we translated to position
	ctx.textAlign = "center";
	ctx.fillText(text, 0, 0, canvasWidth * 0.8);

	// Reset filter
	if (style === "blur") {
		try {
			(ctx as CanvasRenderingContext2D).filter = "none";
		} catch {
			// ignore
		}
	}

	ctx.restore();
}

/* ── MP4 export ──────────────────────────────────────────────────────── */

/**
 * Render an IntroConfig to an MP4 Blob.
 */
export async function renderIntroToBlob(
	config: IntroConfig,
	width = INTRO_WIDTH,
	height = INTRO_HEIGHT,
): Promise<Blob> {
	const durationMs = config.durationMs;
	const totalFrames = Math.ceil((durationMs / 1000) * INTRO_FPS);
	const frameDurationUs = 1_000_000 / INTRO_FPS;

	const w = Math.floor(width / 2) * 2;
	const h = Math.floor(height / 2) * 2;

	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Failed to create OffscreenCanvas 2D context");

	// Pre-load images for offscreen rendering
	const loadedImages = await loadIntroImages(config);

	const muxer = new VideoMuxer(
		{ width: w, height: h, frameRate: INTRO_FPS, bitrate: INTRO_BITRATE, codec: INTRO_CODEC },
		false,
	);
	await muxer.initialize();

	let videoDescription: Uint8Array | undefined;
	const muxingPromises: Promise<void>[] = [];

	const encoder = new VideoEncoder({
		output: (chunk, meta) => {
			if (meta?.decoderConfig?.description && !videoDescription) {
				const desc = meta.decoderConfig.description;
				if (desc instanceof ArrayBuffer || desc instanceof SharedArrayBuffer) {
					videoDescription = new Uint8Array(desc);
				} else if (ArrayBuffer.isView(desc)) {
					videoDescription = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
				}
			}

			const isFirst = !videoDescription || muxingPromises.length === 0;
			const p = (async () => {
				if (isFirst && videoDescription) {
					await muxer.addVideoChunk(chunk, {
						decoderConfig: {
							codec: INTRO_CODEC,
							codedWidth: w,
							codedHeight: h,
							description: videoDescription,
							colorSpace: {
								primaries: "bt709",
								transfer: "iec61966-2-1",
								matrix: "rgb",
								fullRange: true,
							},
						},
					});
				} else {
					await muxer.addVideoChunk(chunk, meta);
				}
			})();
			muxingPromises.push(p);
		},
		error: (e) => {
			throw new Error(`Intro video encoder error: ${e.message}`);
		},
	});

	const encoderConfig: VideoEncoderConfig = {
		codec: INTRO_CODEC,
		width: w,
		height: h,
		bitrate: INTRO_BITRATE,
		framerate: INTRO_FPS,
		latencyMode: "quality",
		bitrateMode: "variable",
	};

	const support = await VideoEncoder.isConfigSupported(encoderConfig);
	if (!support.supported) {
		throw new Error("H.264 video encoding is not supported on this system");
	}
	encoder.configure(encoderConfig);

	for (let i = 0; i < totalFrames; i++) {
		const progress = totalFrames > 1 ? i / (totalFrames - 1) : 0;
		drawIntroFrame(ctx, w, h, config, progress, loadedImages);

		const timestamp = i * frameDurationUs;
		const frame = new VideoFrame(canvas, { timestamp, duration: frameDurationUs });
		encoder.encode(frame, { keyFrame: i % 90 === 0 });
		frame.close();

		while (encoder.encodeQueueSize > 10) {
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
	}

	await encoder.flush();
	encoder.close();
	await Promise.all(muxingPromises);

	return muxer.finalize();
}
