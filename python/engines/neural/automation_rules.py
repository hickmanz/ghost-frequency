from __future__ import annotations

from typing import Any

from ..theory import BEATS_PER_BAR, clamp01


def automation_for_bars(context_bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    prev_energy: float | None = None
    prev_section: int | None = None
    for ctx in context_bars:
        bar = int(ctx.get("bar", 0))
        beat0 = bar * BEATS_PER_BAR
        energy = float(ctx.get("energy", 0.5))
        sec = int(ctx.get("sectionIndex", 0))
        if prev_energy is not None and abs(energy - prev_energy) > 0.12:
            events.append(
                {
                    "kind": "automation",
                    "target": "filter.lead",
                    "beat": beat0,
                    "value": clamp01(0.45 + energy * 0.4),
                    "rampBeats": 4,
                }
            )
        if prev_section is not None and sec != prev_section:
            events.append(
                {
                    "kind": "automation",
                    "target": "master.filter",
                    "beat": beat0,
                    "value": 0.6,
                    "rampBeats": 2,
                }
            )
            events.append(
                {
                    "kind": "automation",
                    "target": "master.filter",
                    "beat": beat0 + 2,
                    "value": 1.0,
                    "rampBeats": 4,
                }
            )
            events.append(
                {
                    "kind": "automation",
                    "target": "send.reverb",
                    "beat": beat0,
                    "value": clamp01(0.35 + energy * 0.25),
                    "rampBeats": 8,
                }
            )
        if bar % 8 == 0:
            events.append(
                {
                    "kind": "automation",
                    "target": "send.delay",
                    "beat": beat0,
                    "value": clamp01(0.2 + energy * 0.35),
                    "rampBeats": 4,
                }
            )
        prev_energy = energy
        prev_section = sec
    return events
