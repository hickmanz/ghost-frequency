from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from engines.registry import get_engine, list_engines

from .auth import check_origin, verify_token
from .config import (
    HELLO_TIMEOUT_SEC,
    MAX_RENDER_BARS,
    MAX_WS_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    SERVER_VERSION,
)
from .gpu_queue import get_ms_per_bar, run_gpu
from .protocol import ClientHello, ClientInit, ClientRender, ClientPing, ClientVibePrompt, GenerationParamsModel

_EXECUTOR = ThreadPoolExecutor(max_workers=2)

NEURAL_IDS = frozenset({"py-neural-layers", "py-neural-full"})


class SessionState:
    def __init__(self) -> None:
        self.authed = False
        self.epoch = 0
        self.engine_id = "py-markov"
        self.seed = 0
        self.params: dict[str, Any] = GenerationParamsModel().to_dict()
        self.engine = get_engine(self.engine_id)
        self.bar_buffer: dict[int, dict[str, Any]] = {}
        self.buffer_key: str | None = None
        self.last_context: list[dict[str, Any]] | None = None


def _params_key(params: dict[str, Any]) -> str:
    vibe = params.get("vibe") or {}
    return json.dumps(
        {
            "mood": params.get("mood"),
            "energy": params.get("energy"),
            "complexity": params.get("complexity"),
            "variation": params.get("variation"),
            "tempo": params.get("tempo"),
            "vibe": vibe,
        },
        sort_keys=True,
    )


def _batch_for_bars(full: dict[str, Any], from_bar: int, count: int) -> dict[str, Any]:
    bar_beats = 4
    start = from_bar * bar_beats
    end = (from_bar + count) * bar_beats
    return {
        **full,
        "startBeat": start,
        "endBeat": end,
        "events": [e for e in full.get("events", []) if start <= e["beat"] < end],
    }


async def ws_handler(ws: WebSocket, token: str, allowed_origins: list[str]) -> None:
    origin = ws.headers.get("origin")
    if not check_origin(origin, allowed_origins):
        await ws.close(code=4403, reason="Origin not allowed")
        return

    await ws.accept()
    state = SessionState()

    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=HELLO_TIMEOUT_SEC)
        if len(raw.encode()) > MAX_WS_MESSAGE_BYTES:
            await _send_error(ws, "message_too_large", "Message too large")
            await ws.close(code=1009)
            return
        msg = json.loads(raw)
        try:
            hello = ClientHello.model_validate(msg)
        except ValidationError as exc:
            await _send_error(ws, "invalid_message", str(exc)[:240])
            await ws.close(code=4400)
            return
        if hello.protocol != PROTOCOL_VERSION:
            await _send_error(ws, "protocol_mismatch", f"Expected protocol {PROTOCOL_VERSION}")
            await ws.close(code=4400)
            return
        if not verify_token(token, hello.token):
            await _send_error(ws, "auth_failed", "Invalid token")
            await ws.close(code=4401)
            return

        state.authed = True
        state.engine_id = hello.engineId
        state.seed = hello.seed & 0xFFFFFFFF
        state.params = hello.params.to_dict()
        state.engine = get_engine(state.engine_id)
        state.engine.init(state.seed, state.params)
        state.bar_buffer.clear()
        state.buffer_key = None

        await ws.send_json(
            {
                "type": "ready",
                "engines": list_engines(),
                "serverVersion": SERVER_VERSION,
            }
        )

        while True:
            raw = await ws.receive_text()
            if len(raw.encode()) > MAX_WS_MESSAGE_BYTES:
                await _send_error(ws, "message_too_large", "Message too large")
                continue
            data = json.loads(raw)
            mtype = data.get("type")
            if mtype == "ping":
                ping = ClientPing.model_validate(data)
                payload: dict[str, Any] = {"type": "pong", "t": ping.t}
                ms = get_ms_per_bar()
                if ms is not None:
                    payload["msPerBar"] = round(ms, 1)
                await ws.send_json(payload)
            elif mtype == "vibe_prompt":
                vp = ClientVibePrompt.model_validate(data)
                from engines.neural.text_vibe import vibe_from_text_embeddings

                result = vibe_from_text_embeddings(vp.text)
                await ws.send_json({"type": "vibe", "vibe": result["vibe"], "mood": result.get("mood")})
            elif mtype == "init":
                init = ClientInit.model_validate(data)
                state.epoch = init.epoch
                state.seed = init.seed & 0xFFFFFFFF
                state.engine_id = init.engineId
                state.params = init.params.to_dict()
                state.engine = get_engine(state.engine_id)
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(_EXECUTOR, lambda: state.engine.init(state.seed, state.params))
                state.bar_buffer.clear()
                state.buffer_key = None
                state.last_context = None
            elif mtype == "render":
                try:
                    render = ClientRender.model_validate(data)
                except ValidationError as exc:
                    await _send_error(ws, "invalid_message", str(exc)[:240])
                    continue
                if render.count > MAX_RENDER_BARS:
                    await _send_error(ws, "limit_exceeded", f"Max {MAX_RENDER_BARS} bars per request")
                    continue
                try:
                    params = render.params.to_dict()
                    engine = state.engine
                    seed = state.seed
                    epoch = render.epoch
                    from_bar = render.fromBar
                    count = render.count
                    context = [c.model_dump() for c in render.context] if render.context else None

                    if state.engine_id == "py-neural-layers":
                        if not context or len(context) < count:
                            await _send_error(
                                ws,
                                "context_required",
                                f"py-neural-layers needs context[{count}] bars (got {len(context or [])})",
                            )
                            continue

                    pk = _params_key(params)
                    if pk != state.buffer_key:
                        state.bar_buffer.clear()
                        state.buffer_key = pk
                    if context is not None:
                        state.last_context = context

                    def _gen_range(start_bar: int, n: int, ctx_slice: list[dict[str, Any]] | None) -> dict[str, Any]:
                        if params.get("seed") != seed:
                            engine.init(seed, {**params, "seed": seed})
                        return engine.render_bars(start_bar, n, params, context=ctx_slice)

                    loop = asyncio.get_running_loop()
                    for i in range(count):
                        bar = from_bar + i
                        if bar in state.bar_buffer:
                            continue
                        ctx_slice = [context[i]] if context is not None and len(context) > i else None

                        if state.engine_id == "py-neural-layers":
                            assert ctx_slice is not None
                            batch = await loop.run_in_executor(
                                _EXECUTOR, lambda b=bar, c=ctx_slice: _gen_range(b, 1, c)
                            )
                        elif state.engine_id in NEURAL_IDS:
                            batch = await run_gpu(lambda b=bar, c=ctx_slice: _gen_range(b, 1, c))
                        else:
                            batch = await loop.run_in_executor(
                                _EXECUTOR, lambda b=bar, c=ctx_slice: _gen_range(b, 1, c)
                            )
                        state.bar_buffer[bar] = _batch_for_bars(batch, bar, 1)

                    events: list[dict[str, Any]] = []
                    tempo = 90.0
                    for i in range(count):
                        bar = from_bar + i
                        b = state.bar_buffer.get(bar)
                        if not b:
                            await _send_error(ws, "buffer_miss", f"Bar {bar} not generated")
                            continue
                        events.extend(b.get("events", []))
                        tempo = float(b.get("tempo", tempo))

                    bar_beats = 4
                    out_batch = {
                        "version": 1,
                        "startBeat": from_bar * bar_beats,
                        "endBeat": (from_bar + count) * bar_beats,
                        "tempo": tempo,
                        "timeSig": [4, 4],
                        "events": events,
                    }
                    await ws.send_json({"type": "batch", "epoch": epoch, "batch": out_batch})
                except Exception as exc:
                    await _send_error(ws, "internal", str(exc)[:240])
            else:
                await _send_error(ws, "unknown_type", f"Unknown message type: {mtype}")
    except asyncio.TimeoutError:
        try:
            await _send_error(ws, "hello_timeout", "Expected hello within timeout")
            await ws.close(code=4408)
        except Exception:
            pass
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await _send_error(ws, "internal", str(exc))
            await ws.close(code=1011)
        except Exception:
            pass


async def _send_error(ws: WebSocket, code: str, message: str) -> None:
    await ws.send_json({"type": "error", "code": code, "message": message})
