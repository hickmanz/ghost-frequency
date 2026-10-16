from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from engines.registry import get_engine, list_engines

from .auth import check_origin, verify_token
from .config import (
    HELLO_TIMEOUT_SEC,
    MAX_RENDER_BARS,
    MAX_WS_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    SERVER_VERSION,
)
from .protocol import ClientHello, ClientInit, ClientRender, ClientPing, GenerationParamsModel

_EXECUTOR = ThreadPoolExecutor(max_workers=2)


class SessionState:
    def __init__(self) -> None:
        self.authed = False
        self.epoch = 0
        self.engine_id = "py-markov"
        self.seed = 0
        self.params: dict[str, Any] = GenerationParamsModel().to_dict()
        self.engine = get_engine(self.engine_id)


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
        hello = ClientHello.model_validate(msg)
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
                await ws.send_json({"type": "pong", "t": ping.t})
            elif mtype == "init":
                init = ClientInit.model_validate(data)
                state.epoch = init.epoch
                state.seed = init.seed & 0xFFFFFFFF
                state.engine_id = init.engineId
                state.params = init.params.to_dict()
                state.engine = get_engine(state.engine_id)
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(_EXECUTOR, lambda: state.engine.init(state.seed, state.params))
            elif mtype == "render":
                render = ClientRender.model_validate(data)
                if render.count > MAX_RENDER_BARS:
                    await _send_error(ws, "limit_exceeded", f"Max {MAX_RENDER_BARS} bars per request")
                    continue
                params = render.params.to_dict()
                engine = state.engine
                seed = state.seed
                epoch = render.epoch
                from_bar = render.fromBar
                count = render.count

                def _gen() -> dict[str, Any]:
                    if params.get("seed") != seed:
                        engine.init(seed, {**params, "seed": seed})
                    return engine.render_bars(from_bar, count, params)

                loop = asyncio.get_running_loop()
                batch = await loop.run_in_executor(_EXECUTOR, _gen)
                await ws.send_json({"type": "batch", "epoch": epoch, "batch": batch})
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
