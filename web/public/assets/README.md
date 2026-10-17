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

## What we’re aiming for (and what to skip)

Ghost Frequency sits in **80s electronic / synth-film / wave** territory: Linn, 808, Linndrum, early digital rooms —
**not** lo-fi hip-hop (vinyl crackle, muffled “study beats”), **not** modern EDM/trap one-shots, **not** foley/homemade
pots-and-pans kits.

Good keywords on Freesound: `808`, `linn`, `lm-1`, `linndrum`, `drum machine`, `analog drum`, `one shot`.

Avoid: `lofi`, `boom bap`, `tape hiss`, `vinyl`, `bedroom` unless you explicitly want that colour on one element.

## CC0 TR-808 (default script)

Real **Roland TR-808** hits (Michael Fischer set, 1994). This is the straight “80s machine” baseline.

| Our file      | Fischer path (default profile) |
| ------------- | ------------------------------ |
| `kick.wav`    | `bd8/BD5050.WAV`               |
| `snare.wav`   | `sd8/SD5050.WAV`               |
| `clap.wav`    | `cp8/CP.WAV`                   |
| `hat.wav`     | `ch8/CH.WAV`                   |
| `openhat.wav` | `oh8/OH50.WAV`                 |

**License:** CC0 — https://github.com/tidalcycles/sounds-tr808-fischer

```powershell
# balanced (current default)
powershell -File web/scripts/fetch-cc0-808-drums.ps1

# more attack / pop (still 808, not trap)
powershell -File web/scripts/fetch-cc0-808-drums.ps1 -Profile punchy

# rounder decay, still electronic
powershell -File web/scripts/fetch-cc0-808-drums.ps1 -Profile soft
```

Hard-refresh after download so samples load post–`start()`.

## CC0 Linn LM-1 (manual — great for Vangelis / pop-electronic)

**[Linn LM-1 Drum Computer Samples](https://freesound.org/people/PJCmusic/packs/37785/)** by PJCmusic (CC0 on Freesound).
Short, punchy **analog machine** character — often a better fit than 808 if the kit feels too “hip-hop 808”.

Download from the pack and rename:

| Our file      | LM-1 file in pack   |
| ------------- | ------------------- |
| `kick.wav`    | `Kick.wav`          |
| `snare.wav`   | `Snare.wav`         |
| `hat.wav`     | `Hat Closed.wav`    |
| `openhat.wav` | `Hat Open.wav`      |
| `clap.wav`    | *(no clap in pack)* — keep Fischer `cp8/CP.WAV` or use `Rim.wav` layered quietly |

You can mix: **LM-1 kick/snare/hats + 808 clap** is a common 80s combo.

## Other CC0 / safe sources

| Source | Link | Notes |
| ------ | ---- | ----- |
| Meadowlark factory library | https://github.com/MeadowlarkDAW/meadowlark-factory-library | CC0 electronic one-shots; pick **clean** hits, skip trap/EDM folders if they feel too modern |
| deadrobotmusic (Freesound) | https://freesound.org/people/deadrobotmusic/ | CC0; prefer **Serum / Peanut Butter** synthetic one-shots, **not** the “Lil Lofi Snare” series if you want to stay out of lo-fi |
| 99Sounds | https://99sounds.org/ | Royalty-free for your **tracks**, but **not** CC0 — don’t commit their WAVs into this git repo |

Freesound: always set **License = Creative Commons 0** and **Type = wav** before downloading.

## Credits

- kick.wav, snare.wav, clap.wav, hat.wav, openhat.wav — TR-808 samples by Michael Fischer (1994), CC0 — https://github.com/tidalcycles/sounds-tr808-fischer

<!-- If you switch to LM-1, add e.g.:
- kick.wav, snare.wav, hat.wav, openhat.wav — Linn LM-1 samples by PJCmusic — https://freesound.org/people/PJCmusic/packs/37785/ — CC0
-->
