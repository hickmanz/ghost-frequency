from __future__ import annotations

import hmac
from typing import Optional

from .config import default_origins


def verify_token(expected: str, provided: str) -> bool:
    if not expected or not provided:
        return False
    return hmac.compare_digest(expected.encode(), provided.encode())


def check_origin(origin: Optional[str], allowed: list[str] | None = None) -> bool:
    if origin is None or origin == "":
        # Non-browser clients (curl, tests)
        return True
    allowed = allowed or default_origins()
    return origin in allowed


def extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None
