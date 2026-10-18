from __future__ import annotations

from typing import Any

from ..theory import clamp, clamp01, scale_pcs
from .constants import LAYER_REGISTER
from .features import pitch_in_register


def allowed_pitches(
    layer: str,
    key: dict[str, Any],
    chord: dict[str, Any],
    tension: float,
) -> set[int]:
    root = int(chord.get("root", 48))
    intervals = chord.get("intervals") or [0, 3, 7]
    pcs = set(scale_pcs(key))
    chord_pcs = {((root + i) % 12) for i in intervals}
    lo, hi = LAYER_REGISTER.get(layer, (36, 84))
    allowed: set[int] = set()
    for midi in range(lo, hi + 1):
        pc = midi % 12
        if pc in pcs:
            allowed.add(midi)
        elif tension > 0.55 and pc in chord_pcs:
            allowed.add(midi)
    return allowed


def clamp_note(layer: str, midi: int, key: dict[str, Any], chord: dict[str, Any], tension: float) -> int | None:
    if layer == "drums":
        return midi if pitch_in_register("drums", midi) else None
    allowed = allowed_pitches(layer, key, chord, tension)
    if midi in allowed:
        return midi
    # snap to nearest allowed pitch
    if not allowed:
        return None
    return min(allowed, key=lambda m: abs(m - midi))


def note_event(layer: str, beat: float, dur: float, midi: int, vel: float) -> dict[str, Any]:
    return {
        "kind": "note",
        "layer": layer,
        "beat": beat,
        "durBeats": dur,
        "midi": int(midi),
        "vel": clamp(vel, 0.15, 0.95),
    }
