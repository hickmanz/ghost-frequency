# Ghost Frequency — Python backend (Phase 3)

Optional local composition server. The browser keeps playing with the built-in JS engine if this is offline.

## Setup

```bash
cd python
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
pip install -r requirements-ml.txt   # optional: CUDA neural engines
```

## Run

```bash
cd python
python -m server
```

On first start the server prints a **pairing token** (also stored in `python/.gf_token` or set `GF_TOKEN`).

Default URL: `http://127.0.0.1:8000`

## Browser

1. Open the web app → **Engine** panel.
2. Select **Local Python server**.
3. Paste the pairing token.
4. Click **Connect**, then **Play**.

If Python cannot keep up or disconnects, playback continues on the JS engine and switches back when buffered bars are ready.

## Environment

| Variable | Default |
|----------|---------|
| `GF_HOST` | `127.0.0.1` |
| `GF_PORT` | `8000` |
| `GF_TOKEN` | auto-generated file |
| `GF_ALLOWED_ORIGINS` | comma-separated extra origins |

## API

- `GET /health` — no auth
- `GET /engines` — `Authorization: Bearer <token>`
- `POST /generate` — one-shot bar render (same schema as WebSocket `batch`)
- `WS /ws` — streaming `hello` → `ready`, then `render` → `batch` (protocol **v2**)
- `vibe_prompt` → `vibe` (text → brightness/tension/density/groove)

### Neural engines

| ID | Mode |
|----|------|
| `py-neural-layers` | Hybrid: browser sends **BarContext** per bar; server returns lead/arp/bass/drums notes only |
| `py-neural-full` | Full replacement composer (skeleton + all layers) |

Set `GF_NEURAL_STUB=1` to force the in-process stub generator (CI / no GPU). Optional: `GF_NEURAL_MODEL`, `GF_AMT_MODEL`.

Phase 0 timing check: `python -m training.spike_amt`

## HTTPS / hosted pages

If the web UI is served over **HTTPS** and the backend is on **localhost**, browsers may require a **Private Network Access** prompt or block the request. Prefer running the UI locally (`npm run dev`) during development, or serve both from compatible origins.

## Tests

```bash
cd python
pytest
```
