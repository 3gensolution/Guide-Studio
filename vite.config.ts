import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		react(),
		electron({
			main: {
				entry: "electron/main.ts",
				onstart({ startup }) {
					const env = { ...process.env };
					delete env.ELECTRON_RUN_AS_NODE;
					return startup(["."], { env });
				},
				vite: {
					build: {
						rollupOptions: {
							external: [
								"playwright-core",
								"@remotion/bundler",
								"@remotion/renderer",
								"@remotion/cli",
								"googleapis",
							],
						},
					},
				},
			},
			preload: {
				input: path.join(__dirname, "electron/preload.ts"),
			},
			renderer: process.env.NODE_ENV === "test" ? undefined : {},
		}),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			// @xenova/transformers: env.js statically imports fs/path/url; onnx.js imports
			// onnxruntime-node (must not be bundled in the renderer — it requires fs).
			fs: path.resolve(__dirname, "src/lib/vite-stubs/empty-node-module.ts"),
			path: path.resolve(__dirname, "src/lib/vite-stubs/empty-node-module.ts"),
			url: path.resolve(__dirname, "src/lib/vite-stubs/empty-node-module.ts"),
			"onnxruntime-node": path.resolve(__dirname, "src/lib/vite-stubs/onnxruntime-node-stub.ts"),
		},
	},
	optimizeDeps: {
		exclude: ["@xenova/transformers"],
	},
	// The captioning worker dynamically imports @xenova/transformers, which makes the
	// worker bundle code-split — unsupported by the default "iife" worker format.
	worker: {
		format: "es",
	},
	build: {
		target: "esnext",
		minify: "terser",
		terserOptions: {
			compress: {
				// KEEP_CONSOLE=1 preserves logs for debugging built apps (e2e runs).
				drop_console: !process.env.KEEP_CONSOLE,
				drop_debugger: true,
				pure_funcs: process.env.KEEP_CONSOLE ? [] : ["console.log", "console.debug"],
			},
		},
		rollupOptions: {
			output: {
				manualChunks: {
					pixi: ["pixi.js"],
					"react-vendor": ["react", "react-dom"],
					remotion: ["remotion", "@remotion/player"],
					"video-processing": ["mediabunny", "mp4box", "@fix-webm-duration/fix"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
	server: {
		port: 5174,
	},
});
