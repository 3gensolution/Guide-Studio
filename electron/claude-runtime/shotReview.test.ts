import { describe, expect, it } from "vitest";
import {
	applyShotDurationOverrides,
	applyShotReviewUpdates,
	areAllShotsApproved,
	createPendingShotReviews,
	evaluateShotCraft,
} from "./shotReview";

const limits = { minSeconds: 1.5, maxSeconds: 20 };

describe("shot review contract", () => {
	it("creates a pending decision for every shot", () => {
		expect(createPendingShotReviews(3)).toEqual([
			{ shotIndex: 0, status: "pending" },
			{ shotIndex: 1, status: "pending" },
			{ shotIndex: 2, status: "pending" },
		]);
	});

	it("applies bounded review decisions and rounds timing", () => {
		const reviews = applyShotReviewUpdates(
			createPendingShotReviews(2),
			[
				{ shotIndex: 0, status: "approved", durationSeconds: 3.26 },
				{ shotIndex: 1, status: "rejected", note: "The ending is too generic." },
			],
			2,
			limits,
		);

		expect(reviews).toEqual([
			{ shotIndex: 0, status: "approved", durationSeconds: 3.3 },
			{ shotIndex: 1, status: "rejected", note: "The ending is too generic." },
		]);
		expect(areAllShotsApproved(reviews, 2)).toBe(false);
		expect(
			areAllShotsApproved(
				applyShotReviewUpdates(reviews, [{ shotIndex: 1, status: "approved" }], 2, limits),
				2,
			),
		).toBe(true);
	});

	it("rejects invalid or ambiguous updates", () => {
		expect(() =>
			applyShotReviewUpdates(createPendingShotReviews(2), [{ shotIndex: 2 }], 2, limits),
		).toThrow(/invalid shot/);
		expect(() =>
			applyShotReviewUpdates(
				createPendingShotReviews(2),
				[
					{ shotIndex: 0, status: "approved" },
					{ shotIndex: 0, status: "rejected" },
				],
				2,
				limits,
			),
		).toThrow(/only be reviewed once/);
		expect(() =>
			applyShotReviewUpdates(
				createPendingShotReviews(2),
				[{ shotIndex: 0, durationSeconds: 0.5 }],
				2,
				limits,
			),
		).toThrow(/between 1.5 and 20/);
	});

	it("keeps timing overrides out of the stored plan", () => {
		const shots = [
			{ id: "a", durationSeconds: 4 },
			{ id: "b", durationSeconds: 5 },
		];
		const reviewed = applyShotDurationOverrides(shots, [
			{ shotIndex: 0, status: "approved", durationSeconds: 6 },
			{ shotIndex: 1, status: "pending" },
		]);

		expect(reviewed).toEqual([
			{ id: "a", durationSeconds: 6 },
			{ id: "b", durationSeconds: 5 },
		]);
		expect(shots[0]?.durationSeconds).toBe(4);
	});

	it("surfaces concise craft warnings without rewriting the story", () => {
		const warnings = evaluateShotCraft([
			{
				kind: "card",
				durationSeconds: 2,
				headline:
					"A long opening line with too many words to comfortably read before the viewer can understand the point of the product story and remember why this new experience matters right now",
			},
			{ kind: "card", durationSeconds: 4, headline: "Same line" },
			{ kind: "card", durationSeconds: 4, headline: "Same line" },
			{ kind: "card", durationSeconds: 4 },
		]);

		expect(warnings).toEqual(
			expect.arrayContaining([
				"Shot 1 is copy-heavy for a 2s beat.",
				"Shots 1 and 2 use the same visual beat; consider a contrast cut.",
				"Shots 2 and 3 use the same visual beat; consider a contrast cut.",
				"Shots 2 and 3 repeat the same copy.",
				"The closing shot has no clear takeaway or call to action.",
			]),
		);
	});
});
