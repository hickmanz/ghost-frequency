# Ghost Frequency

Infinite procedural synthwave / ambient music generator that runs in the browser.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 - click to begin
npm run test       # composition, audio-mapping, presets tests
npm run build      # static build in web/dist (relative paths, host anywhere)
```

---

## How the pieces fit together

Think of four layers: **what to play** (composition), **when to play it** (conductor), **how it sounds** (audio), and **optional remote composition** (Python).

```text
┌─────────────────────────────────────────────────────────────────┐
│  UI (React) — sliders, transport, Engine panel, presets         │
└────────────────────────────┬────────────────────────────────────┘
                             │ store + PlaybackController
┌────────────────────────────▼────────────────────────────────────┐
│  Conductor — lookahead loop (~4 bars ahead of the audio clock)   │
└────────────────────────────┬────────────────────────────────────┘
                             │ EventBatch (notes, sections, automation)
┌────────────────────────────▼────────────────────────────────────┐
│  ComposerEngine — generates musical events (browser or Python)   │
└────────────────────────────┬────────────────────────────────────┘
                             │ same schema either way
┌────────────────────────────▼────────────────────────────────────┐
│  ToneRenderer — synths, FX, mixer, limiter (always in browser)   │
└─────────────────────────────────────────────────────────────────┘
```

### Folder map

| Piece | Location | What it does |
|--------|-----------|--------------|
| **Shared schema** | [`shared/schemas/`](shared/schemas/) | Versioned `EventBatch`, notes, chords, params. Contract between any composer and the audio renderer. No runtime deps. |
| **Composition logic** | [`web/src/composition/`](web/src/composition/) | Music theory, harmony, form, motifs, per-layer generators. Used by the **full** JS engine (`LocalEngine`). Pure TypeScript — no Tone, no DOM. |
| **Composer engines** | [`web/src/engines/`](web/src/engines/) | `ComposerEngine` interface, engine **registry**, `Conductor`, WAV export. Swappable “brains” that emit `EventBatch`. |
| **Audio** | [`web/src/audio/`](web/src/audio/) | Tone.js instruments, scheduling on the **audio clock**, reverb/delay, master limiter. Never imports composition code. |
| **Services** | [`web/src/services/`](web/src/services/) | Zustand store, presets/localStorage, optional `BackendClient` (WebSocket to Python). |
| **Python backend** | [`python/`](python/) | Optional FastAPI server; runs **different** composer algorithms and streams the same JSON events. |

### Important distinctions

- **Composition engine** — decides *which notes/chords/sections* to generate (`local-js`, `js-sparse`, `py-markov`, …).
- **Backend host** — *where* that engine runs: **browser-only** (all JS engines) or **Local Python server** (Python engines over WebSocket, with JS fallback if disconnected).
- **Audio** — always synthesized **in the browser**. Python does not send audio files (only symbolic events).

End-to-end flow:

`ComposerEngine.renderBars()` → `EventBatch` → `Conductor.pump()` → `ToneRenderer.schedule()` → speakers.

---

## Composition engines

Register and create browser engines in [`web/src/engines/registry.ts`](web/src/engines/registry.ts). Pick one in the app under **Engine → Composition engine** (browser-only mode).

| ID | Name | Role |
|----|------|------|
| **`local-js`** | **Full (default)** | Complete procedural composer: sections, motifs, voice leading, pad/arp/bass/lead/drums/texture. Best overall quality. Implementation: [`localEngine.ts`](web/src/engines/localEngine.ts) + [`composition/`](web/src/composition/). |
| **`js-sparse`** | **Sparse ambient** | Alternate **in-browser** engine: slow chord loops from the mood grammar, long pad sustains, soft bass, occasional single arp note, more reverb send. Fewer layers — good for drones and minimal experiments. Implementation: [`sparseAmbientEngine.ts`](web/src/engines/sparseAmbientEngine.ts). Same seed/settings produce **different** music than `local-js`. |
| **`js-auteur`** | **Auteur (timbral)** | **Same notes and arrangement as `local-js`**, but the engine **replaces** composition automation and drives **Sound Lab parameters over time** (wave shape, attack/release, chorus, drive, filters, reverb/delay). Use when you want the full piece with evolving timbre. Implementation: [`auteurEngine.ts`](web/src/engines/auteurEngine.ts) + [`auteurTimbral.ts`](web/src/engines/auteurTimbral.ts). |
| **`js-develop`** | **Developed** | **Same key, motifs, and section plan as `local-js`**, then each later pass of a section is arranged: one harmonic color on the last pass, the motif quoted by the arp (and a long bass on calm passes), low-energy swing, kick ducking, and a sparse bell in Drift and Breakdown. Full is unchanged. Implementation: [`developEngine.ts`](web/src/engines/developEngine.ts). |

### Sound Lab vs composer

| | **Sound Lab** | **Composer (`local-js`)** | **Auteur (`js-auteur`)** |
|--|----------------|---------------------------|---------------------------|
| **Who sets timbre?** | You (sliders, per mood) | Built-in preset + modest filter/send/layer automation | Engine schedules `param.*` automation (same keys as Sound Lab) |
| **Notes / harmony** | — | Full procedural score | Same score as `local-js` |
| **Together** | Your overrides apply as the **baseline**; composer automation moves **on top** (filters, sends). Auteur **also** animates many of the same parameters the Lab exposes. |
| **Sound Lab visuals** | While playing, wave / envelope / filter panels read **live composer telemetry** (when the engine emits `param.*` or `filter.*` automation). Sliders still show your saved overrides; the **engine** pill marks panels driven by the score. |

Python engines (separate implementations, same schema):

| ID | Name | Role |
|----|------|------|
| **`py-markov`** | Python Markov | Markov chord graph, Euclidean arp, simpler arrangement. Not a port of `local-js`. See [`python/engines/markov_engine.py`](python/engines/markov_engine.py). |

Switching engines triggers **regenerate** so you do not mix two rule sets mid-piece.

To add another browser experiment: implement `ComposerEngine`, add an entry to `BROWSER_ENGINES` in `registry.ts`, and document it in this table.

---

## Optional Python backend

```bash
cd python && python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt
python -m server    # copy pairing token from the console
```

In the app: **Engine** → **Local Python server** → paste token → **Connect**. Details: [python/README.md](python/README.md).

While connected, **Active: Python: …** means composition comes from the server; **Fallback: JS** means the built-in full engine is covering a gap until Python catches up.

---

## Tuning / auditioning

- Text view of a composition: `cd web && npx vite-node src/composition/debugDump.ts <seed> <mood> <bars>`
- Export WAV (offline, faster than real time): `getController().exportWav?.(32)` from the dev console (uses the **currently selected browser engine** when in browser-only mode).
- Optional CC0 drum samples: see `web/public/assets/README.md` (synth drums are used when missing).
