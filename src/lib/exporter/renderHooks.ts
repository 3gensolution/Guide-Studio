/**
 * Extension render hook system.
 *
 * Provides a registry that extensions can use to inject custom rendering logic
 * at specific phases of the frame rendering pipeline. Hooks are async-safe and
 * include pixel analysis helpers for color-aware effects.
 */

export type RenderPhase =
	| "post-video"
	| "post-zoom"
	| "post-cursor"
	| "post-annotations"
	| "pre-final"
	| "final";

export interface RenderHookContext {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	width: number;
	height: number;
	timeMs: number;
	frameIndex: number;
	/** Lazily computed full pixel data for the current canvas state. */
	getPixelData: () => ImageData;
	/** Sample the average color in a circular region. */
	getAverageColor: (
		x: number,
		y: number,
		radius: number,
	) => { r: number; g: number; b: number; a: number };
}

export type RenderHookFn = (context: RenderHookContext) => void | Promise<void>;

export class RenderHookRegistry {
	private hooks = new Map<RenderPhase, RenderHookFn[]>();

	/**
	 * Register a hook for a specific render phase.
	 * Returns an unregister function.
	 */
	register(phase: RenderPhase, hook: RenderHookFn): () => void {
		if (!this.hooks.has(phase)) {
			this.hooks.set(phase, []);
		}
		this.hooks.get(phase)!.push(hook);

		return () => {
			const list = this.hooks.get(phase);
			if (list) {
				const idx = list.indexOf(hook);
				if (idx >= 0) list.splice(idx, 1);
			}
		};
	}

	/** Execute all hooks registered for the given phase. */
	async execute(phase: RenderPhase, context: RenderHookContext): Promise<void> {
		const list = this.hooks.get(phase);
		if (!list || list.length === 0) return;

		for (const hook of list) {
			await hook(context);
		}
	}

	/** Returns true if any hooks are registered. */
	hasHooks(): boolean {
		for (const list of this.hooks.values()) {
			if (list.length > 0) return true;
		}
		return false;
	}

	/** Remove all registered hooks. */
	clear(): void {
		this.hooks.clear();
	}
}

/**
 * Build a lazy RenderHookContext from a canvas.
 * Pixel analysis helpers are computed on demand to avoid overhead when unused.
 */
export function buildRenderHookContext(
	canvas: HTMLCanvasElement,
	timeMs: number,
	frameIndex: number,
): RenderHookContext {
	const ctx = canvas.getContext("2d")!;
	let cachedPixelData: ImageData | null = null;

	const getPixelData = (): ImageData => {
		if (!cachedPixelData) {
			cachedPixelData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		}
		return cachedPixelData;
	};

	const getAverageColor = (
		x: number,
		y: number,
		radius: number,
	): { r: number; g: number; b: number; a: number } => {
		const data = getPixelData();
		const { width, height } = data;
		let rSum = 0,
			gSum = 0,
			bSum = 0,
			aSum = 0,
			count = 0;

		const x0 = Math.max(0, Math.floor(x - radius));
		const y0 = Math.max(0, Math.floor(y - radius));
		const x1 = Math.min(width - 1, Math.ceil(x + radius));
		const y1 = Math.min(height - 1, Math.ceil(y + radius));
		const r2 = radius * radius;

		for (let py = y0; py <= y1; py++) {
			for (let px = x0; px <= x1; px++) {
				if ((px - x) * (px - x) + (py - y) * (py - y) > r2) continue;
				const idx = (py * width + px) * 4;
				rSum += data.data[idx];
				gSum += data.data[idx + 1];
				bSum += data.data[idx + 2];
				aSum += data.data[idx + 3];
				count++;
			}
		}

		if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };
		return {
			r: Math.round(rSum / count),
			g: Math.round(gSum / count),
			b: Math.round(bSum / count),
			a: Math.round(aSum / count),
		};
	};

	return {
		canvas,
		ctx,
		width: canvas.width,
		height: canvas.height,
		timeMs,
		frameIndex,
		getPixelData,
		getAverageColor,
	};
}
