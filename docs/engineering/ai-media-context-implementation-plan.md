# AI Media Context — implementation plan

## Objective

Make AI Chat and AI Video Creator operate on the same approved media context:

- source videos and their time ranges
- reference images, screenshots, logos, and style frames
- generated images and generated video clips
- transcripts, OCR, scene boundaries, and visual summaries
- brand rules and delivery requirements

The AI proposes edits and shots; Guide Studio owns file access, validation,
rendering, provenance, and export quality.

## Non-negotiable engineering rules

1. Renderer input is untrusted. The main process validates every asset id,
   extension, size, file type, and current filesystem state.
2. Agents never receive arbitrary paths from the renderer. They receive a
   session-local staged copy and an asset manifest containing stable ids.
3. No model-authored code is compiled for the fixed creator renderer. Models
   select audited scene components and bounded parameters.
4. User media is not uploaded implicitly. Cloud analysis or generation must be
   an explicit provider action with a visible asset and privacy notice.
5. Every generated asset records its source assets, prompt, provider, model,
   timestamp, and generation settings.
6. All normalization is deterministic and testable. Invalid input degrades to
   a safe result with a visible warning; it never becomes a filesystem escape
   or a silent publication defect.
7. New functionality must include unit tests for contracts and security
   boundaries before UI tests are added.

## Target architecture

```text
Renderer
  ├─ Media Context UI (attach, label, role, remove)
  ├─ AI Chat (questions + editor actions)
  └─ AI Video Creator (brief + storyboard + shot approvals)
          │ IPC: ids and bounded requests only
          ▼
Main process
  ├─ Media Context Registry
  ├─ File picker and path approval
  ├─ Staging into an isolated session workspace
  ├─ ffprobe / frame extraction / Whisper / OCR analysis
  ├─ Provider adapters (image, video, audio)
  └─ Provenance and generation manifest
          │ validated props only
          ▼
Deterministic renderer
  ├─ Remotion scene library
  ├─ source video/image layers
  ├─ image motion and motion graphics
  └─ color/audio/export quality gates
```

## Delivery slices and latest status

### Latest implementation pass — IN PROGRESS (2026-10-20)

- Added a reference-grade launch-film contract shared by the existing creative
  skill pipeline: beat roles, bounded motion presets, transition presets, and
  explicit caption safety metadata.
- Product Launch now prompts for a hook → proof → brand-world → thesis → logo
  lockup arc instead of independent generic cards.
- Product Launch normalization preserves explicit editorial choices, repairs
  unknown values to deterministic defaults, and emits non-blocking structure
  warnings for weak openings, insufficient visual proof, repeated motion, or a
  missing final logo lockup.
- Visual scenes force `captionsAllowed: false` even if a model requests it;
  text/card beats remain eligible for finishing captions.
- The Remotion motion composition now honors scene entrance intent with
  deterministic cut, crossfade, wipe, match-cut, and scale-through behavior.
- Supplied image/video scenes now honor launch-film treatment metadata with
  hero-push, macro-crop, framed collage, and card-stack compositions; Product
  Launch receives a deterministic mixed-media collage proof beat when source
  footage or imagery is available.
- Product Launch collage beats can now combine multiple approved supporting
  images with a supplied hero video. Asset selection remains ID-based and
  staged-session bounded; inferred logos and brand-mark files are excluded
  from incidental collage tiles.
- Adjacent visual beats can now receive deterministic match-cut continuity,
  using a controlled scale/translation entrance instead of treating every
  transition as an unrelated wipe or fade.
- Supplied logo reveals now use a finer scatter-to-assemble grid while keeping
  the original logo asset's exact pixels, colors, transparency, and proportions.
- Removed the logo reveal's drop-shadow and ambient logo halo. The supplied mark
  now animates through position, rotation, opacity, and scale only; its pixels
  are not recolored or decorated with an invented glow.
- Removed the remaining tagline text shadow from the closing lockup.
- Source footage is now a render precondition: an attached video that is not
  represented by a video scene/layer or cannot be staged fails with an explicit
  error instead of silently falling back to a text/card render.
- Attached footage remains eligible even when probing returns no duration. The
  renderer uses the original file untrimmed in that case, and uses bounded shot
  trims whenever trusted duration metadata is available.
- Video treatment no longer applies the old dark brightness/gradient treatment
  by default. Supplied video remains visible; copy gets only a low-opacity edge
  readability gradient when copy is actually present.
- Long detected video segments are subdivided into distinct deterministic
  editorial windows instead of reusing the same source range for every beat.
  Product-launch normalization keeps the hook and thesis copy, then moves
  excess middle copy beats onto source footage.
- Focused launch-film, motion-plan, and caption-policy tests pass; TypeScript,
  Biome, the Vite/Electron production build, and the Remotion bundle check pass.

### Slice 1 — contract and secure ingestion — COMPLETE

- Add shared media-context types and normalization.
- Add an allowlist for image/video media.
- Add a main-process reference picker.
- Stage approved references into the creator session workspace.
- Pass only asset ids and safe summaries into the storyboard contract.
- Add tests for invalid ids, unsupported extensions, oversized files, and
  path traversal.

### Slice 2 — video-aware planning — COMPLETE

- Probe video dimensions, duration, FPS, audio, and color metadata.
- Extract a bounded, shot-aware contact sheet and optional local Whisper transcript.
- Add source asset ids and source ranges to storyboard frames.
- Render a supplied reference video through the existing HyperFrame screen
  layer where the selected scene kind supports it.
- Use an attached source video as a first-class Motion Graphics scene with a
  validated asset id, bounded source range, and deterministic camera treatment.
- Add visual warnings when a plan references a video that cannot be rendered.

### Slice 3 — shared AI Chat context — MOSTLY COMPLETE

- Add the active media manifest to Chat's system context.
- Let Chat ask for frame captures, scene lists, transcript ranges, and OCR.
- Support one explicitly selected image frame as a vision input.
- Attach analyzed image/video references with factual visual summaries, readable
  OCR text, and timecoded transcript phrases when those capabilities are available.
- Add structured tools for creating a storyboard and applying shot edits.

### Slice 4 — generation and motion — IN PROGRESS

- Add provider capability adapters for text-to-video, image-to-video,
  reference images, first/last frames, and masks.
- Implement deterministic pan, parallax, depth, camera, light, and reveal
  motion for static images.
- Add audited product, UI, device, comparison, and reveal motion scenes.
- Keep text, logos, and UI rendered locally rather than generated inside
  raster images.
- Shared creative-skill profiles now select story grammar while reusing the
  same validated media, preview, approval, and export infrastructure.

### Slice 5 — professional finishing — IN PROGRESS

- Editable scene/layer output instead of only a flattened MP4.
- Rec.709, HDR/PQ, HLG, P3, log input, LUT, and scope handling.
- Dialogue/music roles, deterministic ducking, loudness checks, and captions.
- ProRes master export; web delivery presets, stems, and FCPXML/XML interchange
  remain.
- Review links, timecoded comments, approval states, and version compare.

## Apple-quality acceptance bar

Before a user tests a generated video, the system should verify:

- one clear idea per shot
- purposeful motion only
- consistent spacing, typography, color, and safe margins
- no invented product behavior, metrics, or UI
- supplied product references remain visually faithful
- text is rendered as text and remains crisp
- narration fits the shot duration
- music does not mask dialogue
- captions are synchronized
- output color space and frame rate are explicit
- every generated asset has provenance
- the result remains editable until final export

## What is implemented now

The current implementation establishes a secure media-context foundation and
production pieces of Slices 2–4:

- secure native image/video selection and session-local staging
- deterministic file-extension, size, symlink, id, and file-state validation
- bounded FFmpeg technical probing on staged references
- AI Chat context for the active video and its transcript
- explicit current-playhead frame attachment for vision analysis
- bounded video contact sheets for multi-moment vision context
- optional provider vision pass over supplied images/contact sheets, returning
  bounded factual visual summaries and readable OCR items
- optional local Whisper pass for bounded timecoded transcript segments, with a
  compact excerpt and exact ranges available to both Chat and Creator
- deterministic query-specific retrieval across transcript, OCR, visual
  summaries, and media metadata; Chat can use the existing seek tool on a
  returned source range, and Creator receives the same focused evidence
- an offline hashed word/character vector pass layered over exact matching so
  common inflections and partial phrases can retrieve the correct source
  moment without a new cloud service or model download
- approved image/video attachments inside AI Chat with bounded vision payloads
- one-key core AI configuration: MiniMax routes chat/vision, image, video,
  music, and narration; specialist providers remain optional
- deterministic Ken Burns-style motion for supplied static images
- vector/raster brand references are accepted, validated, staged, and available
  to the motion renderer
- motion projects have a first-class `logo` scene that reveals the supplied
  brand asset, with deterministic fallback behavior when staging fails
- motion projects can use supplied, stock, or explicitly AI-generated image
  scenes with bounded Ken Burns, parallax, or float movement; a visual asset is
  injected when the plan would otherwise be text-only
- supplied logo, image, and video references are sampled through the trusted
  FFmpeg path to derive a restrained light/dark brand palette; that palette
  drives motion backgrounds, gradients, glows, text contrast, and logo reveals
- typography motion scenes use the same brand-aware renderer instead of the
  legacy library's hard-coded black canvas
- logo requests infer a single attached image or an explicitly branded asset;
  the planner cannot replace a valid supplied logo with ordinary text
- reference video routing through the approved HyperFrame screen layer
- first-class source-video motion scenes with validated time ranges, per-shot
  push-in/drift/steady treatment, shot previews, and final MP4 rendering
- bounded FFmpeg scene-change detection for staged videos; coarse shot ranges
  are included in AI context and used for safe fallback source selection
- shot-aware contact sheets that extract representative frames from detected
  shot midpoints for AI Chat and AI Video Creator review
- explicit stock versus AI-generated visual selection in AI Video Creator
- session-local MiniMax image generation for atmosphere/illustration frames,
  with prompt/provider/model/time/settings provenance
- all-shot preview review before rendering, with explicit approve/needs-changes
  states, bounded per-shot timing overrides, stale-render invalidation, and
  advisory pacing/story craft checks
- all planned shots receive preview stills before approval; MP4 rendering is
  blocked in both the UI and main process until every shot is approved
- review sessions persist atomically in the app's private user-data directory
  and are restored after renderer recovery, display sleep, or app restart
- every review row shows the thumbnail for its matching shot, with an explicit
  refresh-preview action when older or missing preview stills are encountered
- review updates are validated through a dedicated IPC contract and preserve
  the original storyboard while applying timing only at preview/render time
- saved preview stills and rendered MP4s can be cleared without deleting the
  underlying plan; clearing media resets shot approvals to pending because no
  preview remains to support an approval decision
- rendered MP4s pass a post-render quality gate for file existence, decodability,
  dimensions, duration, and frame rate before the session is marked rendered
- Creator finishing can synthesize one validated narration clip per approved
  shot, burn synchronized captions into the Remotion composition, stage a local
  music bed inside the private session workspace, duck music under dialogue,
  and require an audio stream plus integrated loudness validation before the
  finished MP4 is marked rendered
- Creator finishing can also stage one user-supplied voiceover file, including
  an ElevenLabs export or a recorded read, and derive reviewable caption windows
  from the supplied script when local/generated TTS is unavailable
- Creative video skills are now explicit profiles over the shared pipeline:
  Explainer Motion, Product Launch, Product Update, and Brand Reveal share the
  same media context, validated motion scenes, review, and export stages
- layered motion scenes now combine supplied video, images, logos, text, and
  graphic shapes in normalized coordinates with deterministic drift, push-in,
  rise, scale-in, and wipe motion; invalid or unstaged asset ids are dropped
  before rendering
- Explainer Motion and Product Update now convert legacy text/card beats into
  source-footage-led layered lower thirds when attached footage exists; the
  deterministic fallback still guarantees a mixed-media proof scene if the
  plan contains no usable visual beat
- source footage, images, and structural layers are visible from frame zero;
  short kinetic typography beats settle early enough to be readable in review
- attached JPEG/white-matte logo references are derived into transparent PNGs
  inside the private session workspace; the original user asset remains
  untouched and the accidental white logo tile cannot reach the renderer
- Claude Code sessions now receive absolute, session-local brief and output
  paths, avoiding relative-path ambiguity in macOS Application Support
  workspaces while preserving the same file sandbox
- Source-video palette extraction now takes priority over fetched/generated
  stills, and the no-reference fallback is a neutral light field rather than a
  fixed navy template; supplied logo reveals no longer place artwork inside an
  opaque presentation card
- the finished social MP4 can be transcoded to an edit-friendly ProRes 422 HQ
  BT.709 master and validated independently
- a separate Clear all action removes the saved plan, previews, rendered MP4,
  and session-local references and returns the creator to an empty state
- the latest full regression run passed 82 test files and 764 tests. The focused
  launch-film, motion-plan, caption, and render-validation tests also pass.
  TypeScript, the production Vite/Electron build, the Remotion bundle, and
  `git diff --check` pass. Repository lint has no blocking errors; 128 existing
  warning-level diagnostics remain in unrelated legacy/benchmark code and are
  tracked as cleanup rather than hidden by this release.

## What remains

The shared planning, media-ingestion, preview, review, deterministic motion,
caption-suppression, logo, palette, and MP4 validation path is implemented for
tonight's test release. The remaining items below are deliberate follow-on
work for a full finishing and interchange product; they are not hidden
dependencies for testing the current Creator flow.

## Reference-grade launch-film implementation plan

The attached reference is a useful motion-language target: it uses a coherent
brand system, varied visual proof, controlled typography, deliberate pacing,
and a resolved logo lockup. It is not a prompt-only problem. The product needs
an editorial planning layer between the model and the deterministic renderer.

### Phase A — launch-film contract and brand system

- Add a shared launch-film beat contract with explicit roles: hook, problem,
  product proof, brand world, thesis, feature reveal, logo lockup, and CTA.
- Add bounded motion presets and transition presets to the motion scene
  contract; unknown values must normalize to safe defaults.
- Carry `captionsAllowed` as a render contract. It must default to false for
  image, video, logo, and mixed-media scenes.
- Make the planner request a brand system derived from supplied media: light
  field, dark field, primary, secondary, highlight, text, and muted text.
- Preserve exact supplied logo pixels, colors, aspect ratio, transparency, and
  clear space. The renderer may animate the logo but may not redraw or recolor
  it without an explicit brand instruction.

### Phase B — editorial planning and normalization

- Product Launch and Brand Reveal must plan a complete arc rather than a list
  of unrelated cards.
- Require an opening hook, at least two visual-proof beats when media exists,
  one thesis or outcome beat, and one final logo lockup when a logo exists.
- Reject or repair two consecutive text-only beats when a usable visual asset
  is available.
- Prevent the same motion treatment from appearing three times consecutively.
- Keep the logo and its tagline in one lockup scene; never move the tagline to
  an unrelated final card.
- Use the attached video as source truth. Select bounded shot ranges and never
  replace relevant supplied footage with generated filler.
- Add plan warnings for weak narrative structure so the user can correct the
  story before rendering.

### Phase C — deterministic launch-film renderer

- Add full-frame hero, editorial split, collage, card-stack, macro crop,
  masked image, parallax, match-cut, and scatter-to-assemble treatments.
- Add entrance transitions with explicit semantics: cut, crossfade, wipe,
  scale-through, and match-cut. They must be deterministic and frame-safe.
- Use image/video layers as the visual subject; text is supporting hierarchy,
  not a permanent lower-third.
- Derive background treatment from the selected brand palette. A generic dark
  canvas is never an acceptable default when a light brand field or supplied
  media provides a better contrast surface.
- Keep product/UI footage truthful. Callouts, crops, and focus rings may
  direct attention, but generated pixels may not replace readable UI.

### Phase D — sound, review, and release gates

- Add beat markers for narration, music, and sound effects so motion resolves
  on editorial moments instead of arbitrary scene boundaries.
- Keep captions separate from visual proof and expose them in a dedicated
  finishing control; never use a dark caption bar to rescue poor contrast.
- Add a launch-film review rubric: story clarity, brand fidelity, asset usage,
  motion variety, typography, logo treatment, pacing, audio, and export health.
- Add representative golden projects for 16:9, 9:16, and 1:1, including a
  supplied logo, supplied video, supplied stills, and a no-media fallback.
- Frame-compare representative outputs, validate decode/dimensions/FPS/audio,
  and block release on missing assets, invented UI, unreadable text, or a
  broken final lockup.

### Delivery order

1. Contract, prompt, normalization, and tests.
2. Brand-aware palette and asset-role enforcement.
3. Transition shell and visual-led scene presets.
4. Logo assembly and collage/macro treatments.
5. Audio beat alignment and launch-film QA rubric.
6. UI controls for motion preset, beat role, and review notes.

### Current implementation slice

Phase A and the first production slices of Phases B–D are now implemented:

- Product Launch receives the shared launch-film grammar and bounded beat,
  motion, transition, and caption-safety metadata.
- The normalizer creates media-led proof beats, uses multiple approved stills
  in a launch collage when available, keeps supplied video in the composition,
  and consolidates the logo plus tagline into one closing lockup.
- The renderer supports deterministic hero push, macro crop, collage,
  card-stack, parallax, wipe, scale-through, match-cut, and 3×3 exact-logo
  scatter/assemble treatments.
- Launch-film readiness checks now surface missing/unused source media,
  invalid asset references, unsafe durations, visual caption violations,
  repeated camera language, and incomplete logo lockups before approval.
- Creator finishing now supports a validated timed SFX cue, and rendered
  sessions can export a JSON scene/layer manifest plus conservative FCPXML
  markers beside the MP4/master.
- The existing secure media ingestion, source-video routing, caption
  suppression, preview review, logo matte cleanup, and render validation remain
  in force. No provider change is required; this work stays inside the shared
  deterministic pipeline.

Focused launch-film, motion-plan, caption, and render-validation tests pass
(40 tests in the current motion/launch focused run). The latest full regression run reached
82 test files / 766 tests: 765 passed and one unrelated AI settings test timed
out at its existing five-second limit. The repository lint gate is error-free but reports
128 warning-level diagnostics in unrelated legacy/benchmark code; those do not
block the Creator build, but should be removed in the next hygiene pass.

The following work is intentionally not marked complete:

### AI understanding and context

- Model-backed sentence embeddings/vector search across the transcript/OCR/
  visual context for deeper meaning matches beyond the current offline vector
  pass.
- Full visual embeddings, semantic search, and semantic scene retrieval.
- Multi-turn retrieval tools that jump Chat or Creator to a matching source
  moment instead of placing the entire bounded context in one prompt.
- Structured Chat tools for creating, editing, and applying storyboard changes.

The first understanding pass and deterministic retrieval layer are now
implemented: OCR/visual analysis is
provider-assisted and bounded, while transcript extraction is local Whisper
when its native binary and model are installed. If either capability is not
available, planning continues with technical metadata, contact sheets, and
shot ranges; it never fabricates a result.

### Generation and creative control

- Provider-capability adapters for native text-to-video and image-to-video,
  reference images, first/last frames, and masks.
- A richer layered-timeline vocabulary for production explainers: image
  cutouts, illustrations, callouts, masks, beat-aware transitions, and
  multi-shot editorial assembly. The first safe layered contract is now live,
  but the current fallback proof scene is intentionally conservative until the
  planner and review UI expose richer per-layer editing.
- More audited product, device, UI, comparison, reveal, and transition scenes.
- Stronger brand-system controls for typography, spacing, color, logo usage,
  and product-fidelity constraints.
- Multi-clip source-video editing with AI-selected multi-shot boundaries,
  semantic retrieval, and richer timecoded source ranges beyond the bounded
  first pass. Current detection is coarse scene-change metadata, not a full
  editorial understanding of the footage.
- Provider-neutral AI credentials. The current one-key path is MiniMax for
  core AI, while specialist providers remain optional; this is a practical
  current implementation, not the final provider abstraction.

### Professional finishing and delivery

- Separate audio stems. Creator now accepts a first-class timed SFX cue lane,
  stages those files inside the session workspace, and mixes them safely into
  the validated delivery; isolated stem export remains.
- Automatic caption generation from arbitrary external voiceover, word-level
  timing, and richer accessibility validation. Current Creator finishing uses
  the supplied per-shot narration text as the authoritative caption source.
- Rec.709/HDR/PQ/HLG/P3/log workflows, LUT handling, and scopes.
- ProRes 422 HQ BT.709 master export is implemented; HDR/PQ/HLG/P3/log
  workflows, LUT handling, scopes, and additional web delivery presets remain.
- FCPXML/XML interchange is implemented as a conservative master reference
  with scene markers, alongside a full JSON scene/layer manifest. Native
  separate audio stems remain.
- Native reopenable scene/layer editing inside the main timeline remains; the
  JSON manifest is the safe interchange contract until that editor exists.
- Review links, timecoded comments, version comparison, and approval history.

### Validation still required

- Run real end-to-end renders with installed Claude/Codex agents and supplied
  product videos/images, including failure, cancellation, and retry paths.
- Run a real Creator finishing render with one SFX cue and verify it in a
  player, not only through the unit-level cue contract.
- Perform frame-by-frame visual QA on representative Apple-style launch,
  product-update, vertical, square, and reference-video projects.
- Add browser/Electron UI coverage for attaching media, reviewing every shot,
  rejecting a shot, changing timing, and confirming the render gate.
- Add export-level checks for frame rate, dimensions, color metadata, audio
  presence, duration, and playback across target players.

Release verification completed for this pass:

- `npm test`: 82 test files ran; 765/766 tests passed. The only failure was the
  unrelated `AISettingsDialog > saves a key for DeepSeek, GLM and Qwen` timeout.
- `npx tsc --noEmit`: passed.
- `npm run build-vite`: passed.
- `node scripts/bundle-remotion.mjs`: passed.
- `npx biome check` on the changed media/render files: passed after formatting.
- `git diff --check`: passed.
- Repository lint has no error-level diagnostics; 128 warning-level legacy or
  benchmark diagnostics remain.
- Playwright E2E was attempted twice. Three Electron export tests abort at
  process launch with `SIGABRT` on this managed macOS runner, while five
  Windows/native checks are skipped by platform. This is an environment
  limitation and must be rerun on the release machine before packaging.
