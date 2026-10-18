from __future__ import annotations

from typing import Any


def _bucket(v: float, steps: int = 8) -> int:
    return max(0, min(steps - 1, int(v * steps)))


def params_to_control_tokens(params: dict[str, Any]) -> list[str]:
    vibe = params.get("vibe") or {}
    tokens = [
        f"<MOOD_{params.get('mood', 'nostalgic').upper()}>",
        f"<EN_{_bucket(float(params.get('energy', 0.5)))}>",
        f"<CX_{_bucket(float(params.get('complexity', 0.5)))}>",
        f"<VAR_{_bucket(float(params.get('variation', 0.5)))}>",
        f"<BR_{_bucket(float(vibe.get('brightness', 0.5)))}>",
        f"<TN_{_bucket(float(vibe.get('tension', 0.5)))}>",
        f"<DN_{_bucket(float(vibe.get('density', 0.5)))}>",
        f"<GR_{_bucket(float(vibe.get('groove', 0.5)))}>",
    ]
    return tokens


def sampling_temperature(params: dict[str, Any]) -> float:
    v = float(params.get("variation", 0.5))
    return 0.65 + v * 0.55


def sampling_top_p(params: dict[str, Any]) -> float:
    v = float(params.get("variation", 0.5))
    return max(0.75, 0.98 - v * 0.15)
