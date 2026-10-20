// ── Shot review contract ─────────────────────────────────────────────────
//
// This module is deliberately independent of Electron and Remotion. It is the
// small, testable contract shared by the session orchestrator and the review
// UI: every renderable shot has an explicit decision, timing overrides are
// bounded, and craft warnings remain advisory rather than silently changing
// the user's story.

export type ShotReviewStatus = "pending" | "approved" | "rejected";

export interface ShotReview {
	shotIndex: number;
	status: ShotReviewStatus;
	durationSeconds?: number;
	note?: string;
}

export interface ShotReviewUpdate {
	shotIndex: number;
	status?: ShotReviewStatus;
	durationSeconds?: number;
	note?: string;
}

export interface ShotReviewDurationLimits {
	minSeconds: number;
	maxSeconds: number;
}

export interface ReviewableShot {
	kind?: string;
	durationSeconds: number;
	logoAssetId?: string;
	headline?: string;
	text?: string;
	subhead?: string;
	bullets?: string[];
}

const MAX_REVIEW_NOTE_LENGTH = 280;

export function createPendingShotReviews(count: number): ShotReview[] {
	if (!Number.isInteger(count) || count < 0 || count > 100) {
		throw new Error("A video must contain a valid number of shots.");
	}
	return Array.from({ length: count }, (_, shotIndex) => ({
		shotIndex,
		status: "pending" as const,
	}));
}

export function applyShotReviewUpdates(
	current: ShotReview[] | undefined,
	updates: unknown,
	shotCount: number,
	limits: ShotReviewDurationLimits,
): ShotReview[] {
	if (!Number.isInteger(shotCount) || shotCount < 1 || shotCount > 100) {
		throw new Error("This video has no reviewable shots.");
	}
	if (!Array.isArray(updates) || updates.length < 1 || updates.length > shotCount) {
		throw new Error("Provide one or more valid shot review updates.");
	}
	if (
		!Number.isFinite(limits.minSeconds) ||
		!Number.isFinite(limits.maxSeconds) ||
		limits.minSeconds <= 0 ||
		limits.maxSeconds < limits.minSeconds
	) {
		throw new Error("Shot timing limits are invalid.");
	}

	const next = (current?.length === shotCount ? current : createPendingShotReviews(shotCount)).map(
		(review) => ({ ...review }),
	);
	const seen = new Set<number>();

	for (const candidate of updates) {
		if (!isRecord(candidate)) throw new Error("Each shot review must be an object.");
		const shotIndex = candidate.shotIndex;
		if (
			typeof shotIndex !== "number" ||
			!Number.isInteger(shotIndex) ||
			shotIndex < 0 ||
			shotIndex >= shotCount
		) {
			throw new Error("A shot review referenced an invalid shot.");
		}
		if (seen.has(shotIndex)) throw new Error("A shot may only be reviewed once per update.");
		seen.add(shotIndex);

		const status = candidate.status;
		if (
			status !== undefined &&
			status !== "pending" &&
			status !== "approved" &&
			status !== "rejected"
		) {
			throw new Error("A shot review has an invalid status.");
		}

		const durationSeconds = candidate.durationSeconds;
		if (durationSeconds !== undefined) {
			if (
				typeof durationSeconds !== "number" ||
				!Number.isFinite(durationSeconds) ||
				durationSeconds < limits.minSeconds ||
				durationSeconds > limits.maxSeconds
			) {
				throw new Error(
					`Shot timing must be between ${limits.minSeconds} and ${limits.maxSeconds} seconds.`,
				);
			}
		}

		const note = candidate.note;
		if (
			note !== undefined &&
			(typeof note !== "string" || note.trim().length > MAX_REVIEW_NOTE_LENGTH)
		) {
			throw new Error(`Shot notes must be ${MAX_REVIEW_NOTE_LENGTH} characters or fewer.`);
		}

		const existing = next[shotIndex];
		if (!existing) throw new Error("That shot no longer exists.");
		next[shotIndex] = {
			...existing,
			...(status ? { status } : {}),
			...(durationSeconds !== undefined
				? { durationSeconds: Math.round(durationSeconds * 10) / 10 }
				: {}),
			...(note !== undefined ? { note: note.trim().slice(0, MAX_REVIEW_NOTE_LENGTH) } : {}),
		};
	}

	return next;
}

export function areAllShotsApproved(reviews: ShotReview[] | undefined, shotCount: number): boolean {
	return (
		Number.isInteger(shotCount) &&
		shotCount > 0 &&
		reviews?.length === shotCount &&
		reviews.every((review, index) => review.shotIndex === index && review.status === "approved")
	);
}

export function applyShotDurationOverrides<T extends { durationSeconds: number }>(
	shots: T[],
	reviews: ShotReview[] | undefined,
): T[] {
	return shots.map((shot, shotIndex) => {
		const override = reviews?.[shotIndex]?.durationSeconds;
		return override === undefined ? { ...shot } : { ...shot, durationSeconds: override };
	});
}

/**
 * Advisory checks for the kind of review a senior product storyteller makes
 * before approving a cut. They never rewrite copy or block a deliberate
 * decision; they surface likely pacing, hierarchy, and repetition problems.
 */
export function evaluateShotCraft(shots: ReviewableShot[]): string[] {
	if (shots.length === 0) return ["The story has no shots."];

	const warnings: string[] = [];
	const first = shots[0];
	const last = shots[shots.length - 1];
	const copy = (shot: ReviewableShot) =>
		[
			shot.headline,
			shot.text,
			shot.subhead,
			shot.logoAssetId ? "logo reveal" : undefined,
			...(shot.bullets ?? []),
		]
			.filter(Boolean)
			.join(" ")
			.trim();

	if (!first || !copy(first)) warnings.push("The opening shot has no clear primary line.");
	if (!last || !copy(last))
		warnings.push("The closing shot has no clear takeaway or call to action.");

	for (let index = 0; index < shots.length; index += 1) {
		const shot = shots[index];
		if (!shot) continue;
		const words = copy(shot).split(/\s+/).filter(Boolean).length;
		if (words > 24 && shot.durationSeconds < 3) {
			warnings.push(`Shot ${index + 1} is copy-heavy for a ${shot.durationSeconds}s beat.`);
		}
		if ((shot.bullets?.length ?? 0) > 3) {
			warnings.push(`Shot ${index + 1} has more than three bullets; simplify the hierarchy.`);
		}
		if (index > 0 && shot.kind && shot.kind === shots[index - 1]?.kind) {
			warnings.push(
				`Shots ${index} and ${index + 1} use the same visual beat; consider a contrast cut.`,
			);
		}
	}

	const normalizedCopy = shots.map((shot) => copy(shot).toLowerCase());
	for (let index = 1; index < normalizedCopy.length; index += 1) {
		if (normalizedCopy[index] && normalizedCopy[index] === normalizedCopy[index - 1]) {
			warnings.push(`Shots ${index} and ${index + 1} repeat the same copy.`);
		}
	}

	return [...new Set(warnings)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
