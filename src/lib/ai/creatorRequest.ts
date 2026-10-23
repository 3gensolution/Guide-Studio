import type { MediaContextAsset } from "./mediaContext";

/** Resolve only against registered assets in main; renderer metadata is advisory. */
export function resolveCreatorRequest(
	request: string,
	assets: Pick<MediaContextAsset, "kind">[],
): string {
	if (request.trim()) return request.trim();
	if (!assets.some((asset) => asset.kind === "video")) {
		throw new Error("Describe the video you want or attach a video to start.");
	}
	return [
		"Create a polished product explainer from the supplied video, with no additional brief.",
		"Inspect the full visual sequence, readable on-screen text and available speech before choosing the story.",
		"Treat the supplied video as raw screen footage: infer the demonstrated workflow and its visible benefit; build a concise hook, real product proof and a clear ending.",
		"Author a new promo with editable scenes, headlines and motion graphics rather than replaying the entire recording with a title on top.",
		"Use only claims, names and copy supported by the supplied media. Do not invent metrics, capabilities, testimonials or a call to action.",
		"Use real footage for product proof, with readable crops, animated framing, concise headlines and purposeful transitions. Match visible brand colours; use restrained gradients, rounded cards and soft shadows where appropriate.",
		"If no separate logo is supplied, use a clean source crop or the existing closing footage; do not draw an invented brand mark.",
		"Keep speech intelligible and use subtle sound effects. Keep the requested output format and target length.",
	].join(" ");
}
