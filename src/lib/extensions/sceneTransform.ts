export interface SceneTransform {
	scale: number;
	x: number;
	y: number;
}

export function applyCanvasSceneTransform(
	ctx: CanvasRenderingContext2D,
	transform: SceneTransform | null | undefined,
): void {
	if (!transform) {
		return;
	}

	ctx.translate(transform.x, transform.y);
	ctx.scale(transform.scale, transform.scale);
}
