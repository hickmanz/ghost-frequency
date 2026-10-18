from __future__ import annotations

from typing import Any


def parse_context(raw: list[Any] | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if hasattr(item, "model_dump"):
            out.append(item.model_dump())
        elif isinstance(item, dict):
            out.append(item)
    return out


def context_key(context: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for c in context:
        ch = c.get("chord") or {}
        parts.append(f"{c.get('bar')}:{ch.get('numeral')}:{c.get('energy', 0):.2f}")
    return "|".join(parts)
