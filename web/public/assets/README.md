# Optional audio assets

The app works with **no files here**: every drum has a synthesized fallback (`web/src/audio/instruments/drums.ts`).
Drop real one-shots in to replace individual drums; each file is detected independently, so you can add just some.

## Drum one-shots

Folder: `web/public/assets/drums/` (served at `<BASE_URL>assets/drums/<name>.wav`)

| file          | replaces           | MIDI (DRUM map) | notes                                            |
| ------------- | ------------------ | --------------- | ------------------------------------------------ |
| `kick.wav`    | synth kick         | 36              | soft, round 80s kick; ~0.3-0.5 s                 |
| `snare.wav`   | snare noise + body | 38              | snappy but not harsh; the gated tail stays synth |
| `clap.wav`    | synth clap         | 39              |                                                  |
| `hat.wav`     | closed hat         | 42              | short, ~50-120 ms                                |
| `openhat.wav` | open hat           | 46              | ~0.3-0.6 s                                       |

Crash (49) and tom (43) are always synthesized.

Requirements / behaviour:

- Format: **WAV** (16/24-bit PCM, mono or stereo, any sample rate; the browser resamples). Only `.wav` is probed.
- Normalise to roughly -1 dBFS peak. The renderer applies a per-mood level on top (see `SAMPLE_OFFSET_DB` in
  `drums.ts`); trim the files rather than editing code if a sample is too loud/quiet.
- Missing, 404 or undecodable files are silently skipped (the browser console may show a 404 per missing file in dev).
- Samples are loaded after `start()` without blocking it; hits before loading finishes use the synth voices.

## Where to get CC0 one-shots

Pick packs explicitly licensed **CC0 / public domain** and keep a note of the source here:

- Freesound.org - filter by license "Creative Commons 0" (search e.g. "808 kick", "linndrum snare", "lm-1 hat").
- 99Sounds.org (free packs, royalty-free; check each pack's licence text).
- Looperman / Sampleswap - verify each file's licence; prefer CC0 only.
- Archive.org "Public Domain drum machine samples" collections.

Add credits (title, author, URL, licence) below when you add files:

<!-- - kick.wav - "Title" by Author - https://freesound.org/... - CC0 -->
