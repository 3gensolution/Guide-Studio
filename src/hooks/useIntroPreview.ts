/**
 * Drives a requestAnimationFrame loop to render the intro animation
 * on a visible <canvas> element. Config changes update the next frame
 * without restarting the animation loop.
 */
import { type RefObject, useEffect, useRef } from "react";
import { drawIntroFrame, loadIntroImages } from "@/lib/intro/introRenderer";
import type { IntroConfig } from "@/lib/intro/introTypes";

export function useIntroPreview(
	canvasRef: RefObject<HTMLCanvasElement | null>,
	config: IntroConfig | null,
	width: number,
	height: number,
): void {
	// Store config in a ref so the animation loop reads the latest
	// values without needing to restart when fields change.
	const configRef = useRef<IntroConfig | null>(null);
	const imagesRef = useRef<Map<string, HTMLImageElement | ImageBitmap>>(new Map());

	// Keep config ref in sync
	useEffect(() => {
		configRef.current = config;
	}, [config]);

	// Pre-load images when they change
	useEffect(() => {
		if (!config) return;

		let cancelled = false;
		const imageKeys = [
			config.customBackgroundImage || "",
			...config.images.map((i) => `${i.id}:${i.dataUrl.slice(0, 50)}`),
		].join("|");

		// Only reload if image data actually changed
		loadIntroImages(config).then((loaded) => {
			if (!cancelled) {
				imagesRef.current = loaded;
			}
		});

		// Use imageKeys to avoid lint warning — it's the dependency trigger
		void imageKeys;

		return () => {
			cancelled = true;
		};
	}, [config?.customBackgroundImage, config?.images, config]);

	// Animation loop
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !config) return;

		canvas.width = width;
		canvas.height = height;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const start = performance.now();
		let rafId = 0;

		function animate(now: number) {
			const currentConfig = configRef.current;
			if (!currentConfig) return;

			const durationMs = currentConfig.durationMs;
			const elapsed = now - start;
			const progress = (elapsed % durationMs) / durationMs;
			drawIntroFrame(ctx!, width, height, currentConfig, progress, imagesRef.current);
			rafId = requestAnimationFrame(animate);
		}

		rafId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(rafId);
	}, [canvasRef, config, width, height]);
}
