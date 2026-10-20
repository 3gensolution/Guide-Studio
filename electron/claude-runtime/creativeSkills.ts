// ── Creative video skills ─────────────────────────────────────────────────
//
// A creative skill is an art-direction profile, not a renderer. Skills share
// the same validated media context, scene contract, timeline, preview, and
// export pipeline. They only change the story grammar and visual priorities.

export const CREATIVE_SKILL_IDS = [
	"explainer-motion",
	"product-launch",
	"product-update",
	"brand-reveal",
] as const;

export type CreativeSkillId = (typeof CREATIVE_SKILL_IDS)[number];

export interface CreativeSkillProfile {
	id: CreativeSkillId;
	name: string;
	description: string;
	opening: string;
	middle: string;
	closing: string;
	visualRules: readonly string[];
	preferredMotion: readonly string[];
	minimumVisualScenes: number;
	requireSourceVideo: boolean;
	requireLogoReveal: boolean;
}

export const CREATIVE_SKILLS: readonly CreativeSkillProfile[] = [
	{
		id: "explainer-motion",
		name: "Explainer motion",
		description:
			"A problem-to-solution story using footage, layered visuals, and purposeful motion.",
		opening: "Open on the user's problem with an immediate visual hook, not a product title card.",
		middle:
			"Use real product footage or supplied visuals as proof; connect beats with kinetic type and graphic transitions.",
		closing: "Resolve with the product outcome, then a restrained logo and call to action.",
		visualRules: [
			"Use at least one real supplied visual in the first half when media is available.",
			"Do not let two text-only scenes appear consecutively.",
			"Use text to clarify the visual, never as a substitute for the visual.",
		],
		preferredMotion: ["push-in", "drift", "parallax", "kinetic-type", "masked-wipe", "match-cut"],
		minimumVisualScenes: 2,
		requireSourceVideo: false,
		requireLogoReveal: true,
	},
	{
		id: "product-launch",
		name: "Product launch",
		description:
			"A premium launch film with a deliberate hook, visual proof, brand world, thesis, and resolved lockup.",
		opening:
			"Create anticipation with a short visual hook or product detail before naming the product; do not open on a generic title card when supplied media exists.",
		middle:
			"Build from product proof into a wider brand world, varying full-frame footage, image composition, collage, and concise kinetic type.",
		closing:
			"Resolve the thesis, then end on a memorable supplied-logo lockup with the tagline below it and generous breathing room.",
		visualRules: [
			"Prioritize the supplied product footage and brand references over generic stock.",
			"Keep claims factual; never manufacture launch dates, metrics, or features.",
			"Use one visual idea per beat and leave room for the reveal to land.",
			"Use a hook → proof → brand world → thesis → logo lockup arc when the brief supports it.",
			"Do not repeat one text reveal, backdrop, or motion treatment three times in a row.",
			"Use the supplied brand palette as the field; dark is a deliberate contrast beat, never the automatic default.",
		],
		preferredMotion: [
			"reveal",
			"hero-push",
			"parallax",
			"collage",
			"macro-crop",
			"light-sweep",
			"kinetic-type",
			"logo-reveal",
		],
		minimumVisualScenes: 2,
		requireSourceVideo: false,
		requireLogoReveal: true,
	},
	{
		id: "product-update",
		name: "Product update",
		description: "A concise feature story that shows what changed and why it matters.",
		opening: "Name the user pain or workflow change immediately.",
		middle:
			"Show the actual product workflow with screen footage or a supplied UI reference; annotate only the relevant action.",
		closing:
			"Summarize the user benefit and close with the product identity without overpowering the proof.",
		visualRules: [
			"A supplied screen recording is the source of truth for UI behavior.",
			"Never recreate readable UI from imagination when footage exists.",
			"Use callouts, crops, cursor emphasis, and zooms to direct attention.",
		],
		preferredMotion: ["screen-zoom", "cursor-callout", "focus-ring", "masked-wipe", "kinetic-type"],
		minimumVisualScenes: 2,
		requireSourceVideo: true,
		requireLogoReveal: true,
	},
	{
		id: "brand-reveal",
		name: "Brand reveal",
		description:
			"A restrained identity film built around the supplied logo, color, texture, and product imagery.",
		opening:
			"Begin with a recognizable brand texture or visual motif, not an arbitrary dark canvas.",
		middle:
			"Build the identity through controlled movement, image layers, and a small amount of typography.",
		closing:
			"Give the supplied logo a clean, legible reveal with correct transparency and contrast.",
		visualRules: [
			"Derive the palette and contrast from the supplied brand asset or product footage.",
			"Preserve the logo's aspect ratio, transparency, and clear space.",
			"Do not place a logo inside an opaque white tile unless the source asset requires it.",
		],
		preferredMotion: ["mask-reveal", "light-sweep", "float", "parallax", "logo-reveal"],
		minimumVisualScenes: 1,
		requireSourceVideo: false,
		requireLogoReveal: true,
	},
];

const DEFAULT_CREATIVE_SKILL = CREATIVE_SKILLS[0];

export function getCreativeSkill(value: unknown): CreativeSkillProfile {
	return (
		CREATIVE_SKILLS.find((skill) => skill.id === value) ??
		(DEFAULT_CREATIVE_SKILL as CreativeSkillProfile)
	);
}

export function creativeSkillPrompt(value: unknown): string {
	const skill = getCreativeSkill(value);
	return [
		`Creative skill: ${skill.name} (${skill.id}) — ${skill.description}`,
		`Opening: ${skill.opening}`,
		`Middle: ${skill.middle}`,
		`Closing: ${skill.closing}`,
		"Skill rules:",
		...skill.visualRules.map((rule) => `- ${rule}`),
		`Preferred motion vocabulary: ${skill.preferredMotion.join(", ")}. These are art-direction cues; only use motion that the validated renderer supports.`,
		"Global production rule: never burn captions over image, video, logo, or mixed-media scenes containing those assets. If this skill or its narration guidance suggests doing so, ignore that part; captions are allowed only on text/card beats.",
	].join("\n");
}
