# Third-party notice: HyperFrames

The files under `skills/` are from **HyperFrames** by HeyGen,
<https://github.com/heygen-com/hyperframes>, at the commit recorded in
`UPSTREAM.json`. They are licensed under the Apache License, Version 2.0; a copy
is in `LICENSE`.

Guide Studio copies them into each AI Video Creator session (Animated look) so
the user's own Claude Code or Codex can author HyperFrames compositions. The
pinned `hyperframes` CLI that checks and renders those compositions is an npm
dependency under the same licence and ships with its own `LICENSE`.

**Changes from upstream:** upstream test files (`*.test.mjs`) are removed. No
skill text is modified; the differences that matter when running inside Guide
Studio are stated in the session brief (`electron/hyperframes/brief.ts`)
instead.

**Sound effects:** `skills/media-use/audio/assets/sfx/*.mp3` are from
[Pixabay](https://pixabay.com/sound-effects/) and are used under the
[Pixabay Content License](https://pixabay.com/service/license-summary/), as
recorded in `skills/media-use/audio/assets/sfx/CREDITS.md`. They are bundled so
videos can be rendered with them; they are not offered as a standalone
download.

Refresh with `node scripts/vendor-hyperframes-skills.mjs <commit>`, and update
the `hyperframes` version in `package.json` in the same change.
