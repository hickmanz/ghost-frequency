from __future__ import annotations

from typing import Any

from ..theory import BEATS_PER_BAR, scale_pcs
from .constants import LAYER_REGISTER


def _note_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in events if e.get("kind") == "note"]


def measure_vibe(events: list[dict[str, Any]], key: dict[str, Any] | None = None) -> dict[str, float]:
    notes = _note_events(events)
    if not notes:
        return {"brightness": 0.5, "tension": 0.5, "density": 0.5, "groove": 0.5}

    pcs = scale_pcs(key) if key else list(range(12))
    in_scale = 0
    high = 0
    vel_sum = 0.0
    for n in notes:
        midi = int(n.get("midi", 60))
        vel_sum += float(n.get("vel", 0.5))
        if midi % 12 in pcs:
            in_scale += 1
        if midi >= 72:
            high += 1

    n = len(notes)
    brightness = high / n
    tension = 1.0 - (in_scale / n)

    beats_span = max(BEATS_PER_BAR, max((float(n.get("beat", 0)) for n in notes), default=0) + 1)
    density = min(1.0, n / (beats_span * 2.5))

    drum_notes = [x for x in notes if x.get("layer") == "drums"]
    if drum_notes:
        offbeats = sum(1 for d in drum_notes if int(d.get("beat", 0) * 2) % 2 == 1)
        groove = offbeats / len(drum_notes)
    else:
        groove = 0.35

    return {
        "brightness": max(0.0, min(1.0, brightness)),
        "tension": max(0.0, min(1.0, tension)),
        "density": max(0.0, min(1.0, density)),
        "groove": max(0.0, min(1.0, groove)),
    }


def pitch_in_register(layer: str, midi: int) -> bool:
    lo, hi = LAYER_REGISTER.get(layer, (0, 127))
    return lo <= midi <= hi
