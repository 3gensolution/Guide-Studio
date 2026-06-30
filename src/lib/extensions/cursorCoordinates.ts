interface CursorLike {
	cx: number;
	cy: number;
	interactionType?: string;
}

export interface SmoothedCursorSnapshot {
	cx: number;
	cy: number;
	trail: Array<{ cx: number; cy: number }>;
}

interface MaskRectLike {
	x: number;
	y: number;
	width: number;
	height: number;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0.5;
	}

	return Math.min(1, Math.max(0, value));
}

export function mapCursorToCanvasNormalized<T extends CursorLike>(
	cursor: T | null,
	params: {
		maskRect?: MaskRectLike | null;
		canvasWidth: number;
		canvasHeight: number;
	},
): T | null {
	if (!cursor) {
		return null;
	}

	const { maskRect, canvasWidth, canvasHeight } = params;
	if (
		!maskRect ||
		maskRect.width <= 0 ||
		maskRect.height <= 0 ||
		canvasWidth <= 0 ||
		canvasHeight <= 0
	) {
		return {
			...cursor,
			cx: clamp01(cursor.cx),
			cy: clamp01(cursor.cy),
		};
	}

	const pixelX = maskRect.x + clamp01(cursor.cx) * maskRect.width;
	const pixelY = maskRect.y + clamp01(cursor.cy) * maskRect.height;

	return {
		...cursor,
		cx: clamp01(pixelX / canvasWidth),
		cy: clamp01(pixelY / canvasHeight),
	};
}

export function mapSmoothedCursorToCanvasNormalized(
	cursor: SmoothedCursorSnapshot | null,
	params: {
		maskRect?: MaskRectLike | null;
		canvasWidth: number;
		canvasHeight: number;
	},
): SmoothedCursorSnapshot | null {
	if (!cursor) {
		return null;
	}

	const mappedCursor = mapCursorToCanvasNormalized({ cx: cursor.cx, cy: cursor.cy }, params);
	if (!mappedCursor) {
		return null;
	}

	return {
		cx: mappedCursor.cx,
		cy: mappedCursor.cy,
		trail: cursor.trail
			.map((point) => mapCursorToCanvasNormalized(point, params))
			.filter((point): point is { cx: number; cy: number } => point !== null),
	};
}
