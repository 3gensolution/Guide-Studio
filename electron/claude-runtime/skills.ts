// ── Bundled video skills ─────────────────────────────────────────────────
//
// The skill pack is Guide Studio's half of the collaboration: Claude brings
// the reasoning, we bring the craft direction for *this* renderer. Each skill
// is written to the session workspace as `.claude/skills/<id>/SKILL.md`, the
// layout Claude Code loads Agent Skills from, and an index of them is also
// inlined into the prompt so older Claude Code builds — which have no skills
// loader — still get the direction by reading the files.
//
// Skills carry craft, never schema. The frame contract comes from
// `storyboardSystemPrompt()`, which is generated from the same constants the
// validator enforces, so guidance here can never drift out of sync with what
// actually renders.

export interface VideoSkill {
	id: string;
	name: string;
	/** One line, used both in SKILL.md frontmatter and the prompt index. */
	description: string;
	body: string;
}

export const VIDEO_SKILLS: VideoSkill[] = [
	{
		id: "scene-composition",
		name: "Scene composition",
		description: "Sequence frames into a video that holds attention: hook, stakes, proof, payoff.",
		body: `# Scene composition

A storyboard is not a list of facts in frame form. It is a sequence that earns
the next frame. Use this arc unless the brief asks for something else:

1. **Hook** (title) — name the outcome the viewer wants, not the product
   category. "Ship onboarding videos in an afternoon", not "Guide Studio
   overview".
2. **Stakes** (statement) — one sentence on the cost of the current way.
   Concrete and small beats sweeping: "Every release note gets its own
   screen recording, and every one takes a morning."
3. **Proof** (bullets, image, scene3d, or screen frames) — two to four frames
   that show the thing working. This is the body of the video.
4. **Payoff** (statement) — what changes once they have it.
5. **Close** (outro) — one short call to action.

Rules that matter more than the arc:

- **One idea per frame.** If a frame needs "and" to describe it, split it.
- **No frame repeats the previous frame's words.** If the headline restates the
  last subhead, cut one of them.
- **Vary the kind.** Three \`bullets\` frames in a row is a slide deck, not a
  video. Alternate list frames with \`statement\` or a visual frame.
- **Never write placeholder copy.** No "Feature one", no "Lorem", no
  "Your product here". If you do not know a specific, write a true general
  statement instead.
- **Do not invent specifics.** No prices, customer names, metrics, URLs, or
  file names that the brief did not supply. An invented number is worse than
  no number.
`,
	},
	{
		id: "motion-and-timing",
		name: "Motion and timing",
		description: "Pick frame durations that match reading load so nothing feels rushed or dead.",
		body: `# Motion and timing

Duration is a reading-speed problem. A frame must be on screen long enough to
read comfortably once, plus about a second to breathe.

Budget roughly **2.5 words per second**, then round up:

| Frame | Typical duration |
|---|---|
| \`title\` | 3–4s |
| \`statement\` | 3–5s, longer if the sentence is long |
| \`bullets\` | 2s + 1.5s per bullet |
| \`image\` / \`imageSplit\` | 4–5s — the picture needs looking at |
| \`scene3d\` | 4–6s — the motion needs room to land |
| \`outro\` | 3–4s |

Then check the whole:

- **Total length.** Match the target the brief gives. Cut frames rather than
  compressing every frame below its reading time — a 40-second video with six
  readable frames beats one with ten unreadable ones.
- **Rhythm.** Do not give every frame the same duration; identical timings read
  as a slideshow. Let a short punchy statement run 3s next to a 6s proof frame.
- **The end is not a cliff.** The outro should be one of the longer frames, not
  the shortest.
`,
	},
	{
		id: "copy-for-screen",
		name: "Copy for screen",
		description: "Write frame copy that reads at a glance: verb-first, concrete, short.",
		body: `# Copy for screen

Screen copy is read once, at distance, while something is moving. It is closer
to signage than to prose.

- **Headline: verb-first and concrete.** "Cut review time in half" beats
  "Efficiency improvements". Aim well under the character ceiling — the limit
  is a guard rail, not a target. Six to nine words is the readable band.
- **Subhead earns its place or is omitted.** It should add the *how* or the
  *so what*, never restate the headline in different words.
- **Bullets are parallel and short.** Start each with the same part of speech.
  No terminal punctuation. Three bullets is the sweet spot; five is the ceiling
  and usually means the frame should be split.
- **Eyebrow is a label, not a sentence.** "Step 2", "For teams", "Before".
- **No marketing throat-clearing.** Drop "seamlessly", "effortlessly",
  "revolutionary", "powerful", "cutting-edge". If deleting the adjective loses
  nothing, it was noise.
- **Sentence case.** Not Title Case, not ALL CAPS.
- **Numbers only if the brief supplied them.** Never invent a statistic to make
  a frame feel substantial.
`,
	},
	{
		id: "colour-and-accent",
		name: "Colour and accent",
		description: "Choose the accent that matches the subject's tone, and keep it consistent.",
		body: `# Colour and accent

One accent runs the whole video — it tints headings, rules, rings, and the 3D
scenes. Pick it from the subject, not at random:

- **indigo** — software, developer tools, anything default or neutral. The
  safest choice when the brief gives no signal.
- **emerald** — growth, savings, success, health, "after" states, money saved.
- **amber** — warnings, urgency, energy, "before" states, attention.
- **rose** — problems, failure states, deletion, risk, alerts.
- **violet** — AI, creative work, premium or design-led products.

If the brief names a brand colour, choose the accent nearest to it. Never
switch accent partway through: the storyboard carries exactly one.
`,
	},
	{
		id: "motion-and-backdrops",
		name: "Motion and backdrops",
		description:
			"Choose between kinetic typography and backdrop cards, and pick a backdrop that supports the copy.",
		body: `# Motion and backdrops

A motion video alternates two scene kinds. Getting the alternation right is
most of what makes it feel designed rather than assembled.

**Text scenes** are the punctuation. The typography *is* the animation, so the
words have to be short — a title, a turn, a closing line. Three to five words.
If a line needs a subhead to make sense, it is a card, not a text scene.

**Card scenes** are the substance: an animated backdrop with a headline, an
optional subhead, and up to four bullets. This is where the explanation lives.

Rules:

- **Open and close on text scenes**, carry the middle on cards. A video that is
  all cards reads as a deck; all text scenes and it says nothing.
- **Never put two text scenes back to back.** They are visually loud and the
  viewer needs the quiet of a card between them.
- **Match the backdrop to the point**, not to novelty: \`soft-grid\` under
  product and developer copy, \`particle-drift\` for depth behind a claim,
  \`glow-pulse\` under a closing line, \`gradient-drift\` when nothing else fits.
- **Do not repeat a backdrop on consecutive scenes** — it reads as a stuck
  video, and the validator will swap the second one anyway.
- **Respect the character limits** on text scenes. Copy over the limit is
  truncated with an ellipsis, which looks like a bug rather than a choice.
`,
	},
	{
		id: "three-d-scenes",
		name: "3D scenes",
		description: "Use a scene3d frame only where dimensional motion adds meaning, never as filler.",
		body: `# 3D scenes

A \`scene3d\` frame renders one scene from a fixed, audited set. It is the most
expensive frame to render and the easiest to overuse.

**Use one when the motion carries meaning:**

- a product or logo needs presence at the open or close
- data has a shape worth showing dimensionally
- an abstract idea (scale, connection, flow) needs a visual and no image exists

**Do not use one:**

- as decoration between two text frames
- when a plain \`statement\` frame says it more clearly
- more than twice in a video — beyond the cap they silently become text frames,
  so a third is wasted planning

Set both \`scene\` and \`sceneParams\`, and stay inside the documented parameter
bounds — out-of-range values are clamped, which can leave the scene looking
nothing like what you intended. A scene requiring an image with no valid
\`assetId\` degrades to text, so only reach for those when a real asset exists.
`,
	},
	{
		id: "storyboard-review",
		name: "Storyboard review",
		description: "Re-read the finished storyboard against the brief before handing it back.",
		body: `# Storyboard review

Before you write the final file, read your own storyboard once as a viewer who
has never seen the product.

Check, in order:

1. **Does frame 1 make me want frame 2?** If the title is a category label,
   rewrite it as an outcome.
2. **Could any two adjacent frames be merged, or is one redundant?** Cut it.
3. **Does every frame answer the brief?** A frame that is true but off-brief is
   still a frame to cut.
4. **Read each headline aloud.** Anything that trips is too long or too clever.
5. **Do the durations sum near the target?** Adjust by cutting or adding a
   frame, not by squeezing every frame.
6. **Is anything invented?** Prices, metrics, names, URLs — remove or generalise
   anything the brief did not give you.

Fix what you find, then write the file. Do not narrate the review in your final
message; the storyboard file is the deliverable.
`,
	},
];

/** `SKILL.md` body with the frontmatter Claude Code's skills loader expects. */
export function skillFileContents(skill: VideoSkill): string {
	return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}`;
}

/** Compact index inlined into the prompt for builds with no skills loader. */
export function skillIndex(skills: VideoSkill[] = VIDEO_SKILLS): string {
	return skills
		.map((skill) => `- .claude/skills/${skill.id}/SKILL.md — ${skill.name}: ${skill.description}`)
		.join("\n");
}
