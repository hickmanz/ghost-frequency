from __future__ import annotations

import os
import secrets
from pathlib import Path

SERVER_VERSION = "0.1.0"
PROTOCOL_VERSION = 1
SCHEMA_VERSION = 1
MAX_RENDER_BARS = 16
HELLO_TIMEOUT_SEC = 5.0
MAX_WS_MESSAGE_BYTES = 256_000

ROOT = Path(__file__).resolve().parents[1]
TOKEN_FILE = ROOT / ".gf_token"


def default_origins() -> list[str]:
    extra = os.environ.get("GF_ALLOWED_ORIGINS", "")
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    if extra.strip():
        origins.extend(o.strip() for o in extra.split(",") if o.strip())
    return origins


def load_token() -> str:
    env = os.environ.get("GF_TOKEN", "").strip()
    if env:
        return env
    if TOKEN_FILE.is_file():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(24)
    TOKEN_FILE.write_text(token, encoding="utf-8")
    return token


def host() -> str:
    return os.environ.get("GF_HOST", "127.0.0.1")


def port() -> int:
    return int(os.environ.get("GF_PORT", "8000"))
