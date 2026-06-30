import { describe, expect, it } from "vitest";

import { getOrderedSupportedMp4EncoderCandidates } from "./mp4Support";

describe("getOrderedSupportedMp4EncoderCandidates", () => {
	it("keeps hardware candidates ahead of a preferred software hint", () => {
		const candidates = getOrderedSupportedMp4EncoderCandidates({
			codec: "avc1.640033",
			preferredEncoderPath: {
				codec: "avc1.640033",
				hardwareAcceleration: "prefer-software",
			},
		});

		expect(candidates[0]).toEqual({
			codec: "avc1.640033",
			hardwareAcceleration: "prefer-hardware",
		});
		expect(candidates[1]).toEqual({
			codec: "avc1.4d4033",
			hardwareAcceleration: "prefer-hardware",
		});
		expect(candidates).toContainEqual({
			codec: "avc1.640033",
			hardwareAcceleration: "prefer-software",
		});
		expect(
			candidates.findIndex((candidate) => {
				return (
					candidate.codec === "avc1.640033" && candidate.hardwareAcceleration === "prefer-software"
				);
			}),
		).toBeGreaterThan(
			candidates.findIndex((candidate) => {
				return (
					candidate.codec === "avc1.42001f" && candidate.hardwareAcceleration === "prefer-hardware"
				);
			}),
		);
	});

	it("preserves a preferred hardware path at the front of the list", () => {
		const candidates = getOrderedSupportedMp4EncoderCandidates({
			codec: "avc1.640033",
			preferredEncoderPath: {
				codec: "avc1.4d401f",
				hardwareAcceleration: "prefer-hardware",
			},
		});

		expect(candidates[0]).toEqual({
			codec: "avc1.4d401f",
			hardwareAcceleration: "prefer-hardware",
		});
	});
});
