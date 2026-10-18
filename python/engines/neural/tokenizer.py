from __future__ import annotations

from typing import Any

from .constants import BEATS_PER_BAR


def bar_context_to_prefix(ctx: dict[str, Any], layer: str) -> list[str]:
    chord = ctx.get("chord") or {}
    num = chord.get("numeral") or "i"
    sec = ctx.get("sectionName") or "Drift"
    en = int(float(ctx.get("energy", 0.5)) * 7)
    return [
        f"<BAR_{ctx.get('bar', 0)}>",
        f"<LY_{layer.upper()}>",
        f"<SEC_{sec[:12]}>",
        f"<CH_{num}>",
        f"<E_{en}>",
    ]


def note_to_tokens(beat: float, midi: int, dur: float, layer: str) -> list[str]:
    pos = int((beat % BEATS_PER_BAR) * 4)
    return [f"<POS_{pos}>", f"<P_{midi}>", f"<D_{max(1, int(dur * 4))}>", f"<LY_{layer.upper()}>"]


def events_to_token_strings(events: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for e in sorted(events, key=lambda x: (x.get("beat", 0), x.get("layer", ""))):
        if e.get("kind") != "note":
            continue
        out.extend(
            note_to_tokens(
                float(e.get("beat", 0)),
                int(e.get("midi", 60)),
                float(e.get("durBeats", 0.5)),
                str(e.get("layer", "lead")),
            )
        )
    return out
