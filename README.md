# Ghost Frequency

Infinite procedural synthwave / ambient music generator that runs in the browser.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 - click to begin
npm run test       # composition, audio-mapping, presets tests
npm run build      # static build in web/dist (relative paths, host anywhere)
```

## Architecture

```text
shared/schemas/     versioned event format (EventBatch, NoteEvent, ...) + params. No runtime deps.
web/src/composition pure TS music logic: seeded RNG, theory, harmony, motifs, layers, form. No Tone/DOM.
web/src/engines/    ComposerEngine interface, LocalEngine, Conductor (lookahead loop), WAV export
web/src/audio/      Tone.js renderer: scheduler, instruments, fx, master limiter, offline render
web/src/ui/         React UI;  web/src/services/ store, presets (localStorage), controller seam
python/             optional FastAPI + WebSocket backend (`py-markov` engine)
```

Flow: `ComposerEngine` (`LocalEngine` or Python via `FailoverEngine`) -> `EventBatch` (beats)
-> `Conductor` (keeps ~4 bars ahead of the audio clock) -> `ToneRenderer` (schedules on the audio clock).

### Optional Python backend

```bash
cd python && python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt
python -m server    # copy pairing token from the console
```

In the app: **Engine** → Local Python server → paste token → **Connect**. See [python/README.md](python/README.md).

## Tuning / auditioning

- Text view of a composition: `cd web && npx vite-node src/composition/debugDump.ts <seed> <mood> <bars>`
- Export WAV (offline, faster than real time): `getController().exportWav?.(32)` from the dev console.
- Optional CC0 drum samples: see `web/public/assets/README.md` (synth drums are used when missing).
