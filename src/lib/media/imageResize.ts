/**
 * Downscale + compress an uploaded image before it is stored as an inline
 * base64 data URL in editor state.
 *
 * Storing the raw file (via `FileReader.readAsDataURL`) means a single phone
 * photo can become a 15–25 MB string that lives in the editor history, is
 * re-serialized on save, and — most visibly — is decoded on the main thread
 * every time its annotation is painted. That decode blocks the renderer long
 * enough to freeze the UI and stall the OS mouse cursor. Rescaling to a sane
 * maximum dimension keeps annotations sharp while shrinking the payload by
 * one to two orders of magnitude.
 */

export interface DownscaleOptions {
	/** Longest-edge cap in CSS pixels. Images already within this are left alone. */
	maxDimension?: number;
	/** Quality for lossy re-encodes (0–1). Ignored for lossless output. */
	quality?: number;
}

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.85;

/** Formats we never rasterize: SVG is vector (tiny) and GIF may be animated. */
function isPassthroughType(type: string): boolean {
	return type === "image/svg+xml" || type === "image/gif";
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
		reader.readAsDataURL(file);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Failed to decode image"));
		img.src = src;
	});
}

/**
 * Read `file` and return a data URL scaled so its longest edge is at most
 * `maxDimension`. Images already within bounds, and formats we don't rasterize
 * (SVG/GIF), are returned as their original data URL. On any failure we fall
 * back to the untouched data URL so uploads never silently break.
 */
export async function fileToDownscaledDataUrl(
	file: File,
	options: DownscaleOptions = {},
): Promise<string> {
	const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
	const quality = options.quality ?? DEFAULT_QUALITY;

	const originalDataUrl = await readFileAsDataUrl(file);

	if (isPassthroughType(file.type)) {
		return originalDataUrl;
	}

	try {
		const img = await loadImage(originalDataUrl);
		const { naturalWidth: width, naturalHeight: height } = img;

		if (!width || !height) return originalDataUrl;

		const longestEdge = Math.max(width, height);
		if (longestEdge <= maxDimension) {
			return originalDataUrl;
		}

		const scale = maxDimension / longestEdge;
		const targetWidth = Math.round(width * scale);
		const targetHeight = Math.round(height * scale);

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return originalDataUrl;

		ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

		// PNG preserves transparency; other raster sources compress far better as JPEG.
		const hasAlpha = file.type === "image/png" || file.type === "image/webp";
		const outputType = hasAlpha ? "image/png" : "image/jpeg";
		const resized = canvas.toDataURL(outputType, quality);

		// Guard against pathological cases where re-encoding grows the payload.
		return resized.length < originalDataUrl.length ? resized : originalDataUrl;
	} catch {
		return originalDataUrl;
	}
}
