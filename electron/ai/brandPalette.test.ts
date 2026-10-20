import { describe, expect, it } from "vitest";
import { createBrandPalette } from "./brandPalette";

describe("createBrandPalette", () => {
	it("recognizes a light logo canvas and preserves saturated brand colors", () => {
		const samples = [
			...Array.from({ length: 80 }, () => ({ r: 255, g: 255, b: 255, a: 255 })),
			...Array.from({ length: 12 }, () => ({ r: 185, g: 40, b: 220, a: 255 })),
			...Array.from({ length: 8 }, () => ({ r: 25, g: 160, b: 240, a: 255 })),
		];

		const palette = createBrandPalette(samples);

		expect(palette.mode).toBe("light");
		expect(palette.background).toBe("#F5F7FB");
		expect(["#B928DC", "#1AA0F0"]).toContain(palette.primary);
		expect(palette.text).toBe("#111827");
	});

	it("keeps a dark visual reference premium without falling back to flat black", () => {
		const palette = createBrandPalette(
			Array.from({ length: 100 }, (_, index) => ({
				r: 8 + (index % 3) * 8,
				g: 14 + (index % 4) * 7,
				b: 32 + (index % 5) * 10,
				a: 255,
			})),
		);

		expect(palette.mode).toBe("dark");
		expect(palette.background).toBe("#0B1020");
		expect(palette.background).not.toBe("#000000");
		expect(palette.text).toBe("#F8FAFC");
	});
});
