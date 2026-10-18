from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from engines.registry import get_engine, list_engines

from .auth import extract_bearer, verify_token
from .config import (
    PROTOCOL_VERSION,
    SCHEMA_VERSION,
    SERVER_VERSION,
    default_origins,
    load_token,
)
from .protocol import GenerateBody
from .session import ws_handler

_TOKEN: str = ""


def require_token(authorization: str | None = Header(default=None)) -> None:
    bearer = extract_bearer(authorization)
    if not verify_token(_TOKEN, bearer or ""):
        raise HTTPException(status_code=401, detail="Unauthorized")


class PrivateNetworkMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS":
            response = Response(status_code=204)
            origin = request.headers.get("origin", "*")
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Private-Network"] = "true"
            return response
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response


def create_app() -> FastAPI:
    global _TOKEN
    _TOKEN = load_token()
    origins = default_origins()

    app = FastAPI(title="Ghost Frequency Backend", version=SERVER_VERSION)
    app.add_middleware(PrivateNetworkMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.on_event("startup")
    async def _startup() -> None:
        print(f"[ghost-frequency] pairing token: {_TOKEN}")
        print(f"[ghost-frequency] allowed origins: {', '.join(origins)}")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "version": SERVER_VERSION,
            "protocol": PROTOCOL_VERSION,
            "schemaVersion": SCHEMA_VERSION,
        }

    @app.get("/engines", dependencies=[Depends(require_token)])
    def engines() -> list[dict[str, str]]:
        return list_engines()

    @app.post("/generate", dependencies=[Depends(require_token)])
    def generate(body: GenerateBody) -> dict[str, Any]:
        engine = get_engine(body.engineId)
        params = body.params.to_dict()
        seed = body.seed & 0xFFFFFFFF
        engine.init(seed, {**params, "seed": seed})
        ctx = [c.model_dump() for c in body.context] if body.context else None
        return engine.render_bars(body.fromBar, body.bars, params, context=ctx)

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket) -> None:
        await ws_handler(ws, _TOKEN, origins)

    return app


app = create_app()
