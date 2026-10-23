# AI Video Creator — the Animated (HyperFrames) look

## Why it exists

The Motion templates, Clean cards and Whiteboard looks have the agent fill in a
validated JSON storyboard against Guide Studio's fixed scene library. That is
safe and predictable, and it reads as templated: every video is a recombination
of the same dozen animations.

The Animated look has the user's own Claude Code or Codex write a real
[HyperFrames](https://github.com/heygen-com/hyperframes) project — HTML, CSS and
GSAP timelines — the way the agent would working with HyperFrames on its own:
plan a storyline, build each scene by hand, lay sound on the visible actions,
check it, look at snapshots, and fix what is wrong. Guide Studio supplies the
media, the rules of this environment, the gate and the renderer.

This is the one place the creator runs model-authored code. It was a deliberate
product decision (2026-10-23) and is contained as described below.

## Flow

```text
planStoryboard (look: "animated")
  stage + analyse the user's media          (shared with every look)
  scaffoldAnimatedProject                   skills, local GSAP, SFX library, starter index.html, ./hf
  BRIEF.md = buildAnimatedBrief             what differs from the HyperFrames skills here
  ensureHyperframesBrowser                  headless Chrome, downloaded once
  agent turn                                writes index.html + compositions/*.html, runs ./hf check/snapshot
  runGate  ──fail──▶ repair turn (≤2) ──▶ runGate
  summarizeAnimatedProject                  `hyperframes timeline --json` → scenes, variables, audio
previewStoryboard  → one snapshot per scene
updateAnimatedVariables / reviseAnimatedSession → edit → runGate → re-summarize
renderStoryboard   → runGate → `hyperframes render` → audio finishing → validateRenderedVideo
```

Code: `electron/hyperframes/` (cli, project, brief, safety, audio, scenes,
pipeline) and the `animated` branches in `electron/claude-runtime/creator.ts`.
UI: `src/components/recording/AnimatedScenesPanel.tsx`.

## Containment

- **Agent tools.** Claude keeps its file tools scoped to the session folder and
  gets exactly one shell prefix, `Bash(./hf:*)`. Claude Code's deny list
  outranks its allow list, so `Bash` leaves the deny list only when that narrow
  grant is made. `./hf` is a generated wrapper with a fixed subcommand allowlist
  (check, lint, snapshot, timeline, …) and the offline flags baked in — no
  render, publish, cloud, capture or registry installs. Codex keeps its
  network-off workspace sandbox.
- **Safety gate** (`safety.ts`), before anything is checked, snapshotted or
  rendered: every `src`/`href`/`url()` must be a project-relative file that
  exists; scripts may contain no URLs and no network or code-loading APIs; no
  iframes, forms or inline handlers. The composition runs only in headless
  Chrome's renderer — never with Node or Electron APIs — so leaking the user's
  media over the network is the realistic harm, and that is what is blocked.
- **HyperFrames' own `check`** (lint, runtime, layout, contrast) must pass with
  zero errors; its findings drive the agent's repair turns.
- **No telemetry.** The CLI defaults telemetry, update checks and on-demand
  installs on. `cli.ts` turns all of them off for every invocation. The one
  network use left is HyperFrames fetching and caching Google Fonts the first
  time a bundled family is used, from Guide Studio's process, not the agent's.

## Editability

The brief requires one scene per file in `compositions/`, every piece of
on-screen copy as a `string` variable on the scene root (bound with
`data-var-text`), and brand colours as `color` variables on `index.html`.
Editing a value rewrites that variable's `default` in the file that declares it,
so preview, snapshot and render all see it with no side channel. Anything else —
timing, motion, layout — is a scoped agent turn ("ask for a change").

## Sound

- Bundled effects: HyperFrames' Pixabay-licensed SFX library, copied into every
  project with durations and descriptions in the brief.
- With an ElevenLabs key: the agent may request custom effects
  (`output/sfx-requests.json`, each with a library fallback) and a music bed
  (`output/music-request.json` → `assets/music/bed.mp3`), ducked with
  `data-automation` under footage speech. Without a key, an unfillable bed is
  removed and the user is told why.
- Footage keeps its own sound when its speech carries the story.
- Production finishing (voiceover, a user music track) mixes over the cut's own
  audio rather than replacing it.

## Packaging

`scripts/bundle-hyperframes.mjs` installs the pinned CLI into
`dist-hyperframes/<arch>/` (it cannot load from app.asar, and sharp/esbuild are
per-architecture); electron-builder ships it as `resources/hyperframes`, with
`vendor/hyperframes` and GSAP as `resources/hyperframes-vendor`. Keep the npm
version and `vendor/hyperframes/UPSTREAM.json` in step.
