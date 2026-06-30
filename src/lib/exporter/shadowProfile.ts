export interface ShadowLayerProfile {
	offsetScale: number;
	alphaScale: number;
	blurScale: number;
}

export const VIDEO_SHADOW_LAYER_PROFILES: ReadonlyArray<ShadowLayerProfile> = Object.freeze([
	{ offsetScale: 12, alphaScale: 0.7, blurScale: 48 },
	{ offsetScale: 4, alphaScale: 0.5, blurScale: 16 },
	{ offsetScale: 2, alphaScale: 0.3, blurScale: 8 },
]);

export const WEBCAM_SHADOW_LAYER_PROFILES: ReadonlyArray<ShadowLayerProfile> = Object.freeze([
	{ offsetScale: 0.06, alphaScale: 1, blurScale: 0.22 },
]);

export function getShadowFilterPadding(blur: number, offsetY: number): number {
	return Math.ceil(Math.max(0, blur * 2 + Math.abs(offsetY)));
}
