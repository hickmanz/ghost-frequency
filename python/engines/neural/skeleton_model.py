from __future__ import annotations

from typing import Any

from ..rng import float01, int_range
from ..theory import BEATS_PER_BAR, MOOD_TEMPO, chord_spec, key_for, sanitize_params

SECTION_NAMES = ["Intro", "Drift", "Glow", "Pulse", "Apex", "Fade", "Breakdown"]
PROGRESSIONS = [
    ["i", "VI", "III", "VII"],
    ["i", "iv", "V", "i"],
    ["I", "V", "vi", "IV"],
    ["i", "bVII", "bVI", "i"],
]


def plan_bars(from_bar: int, count: int, params: dict[str, Any], seed: int) -> list[dict[str, Any]]:
    p = sanitize_params({**params, "seed": seed})
    key = key_for(seed, p["mood"])
    prog = PROGRESSIONS[int_range(seed, "prog", 0, len(PROGRESSIONS) - 1)]
    section_len = 8 + int_range(seed, "sect", 0, 2) * 4
    bars: list[dict[str, Any]] = []
    for i in range(count):
        bar = from_bar + i
        sec_idx = bar // section_len
        num = prog[(bar // 2) % len(prog)]
        chord = chord_spec(key, num)
        energy = float01(seed, f"en_{bar}") * 0.35 + p["energy"] * 0.65
        vibe = p.get("vibe") or {}
        density = float(vibe.get("density", 0.5))
        layers_on = ["pad", "texture"]
        if density > 0.35:
            layers_on.append("arp")
        if p["energy"] > 0.35:
            layers_on.append("bass")
        if density > 0.45:
            layers_on.append("lead")
        if p["energy"] > 0.42:
            layers_on.append("drums")
        voicing = [int(chord["root"]) + iv for iv in chord["intervals"]]
        bars.append(
            {
                "bar": bar,
                "sectionName": SECTION_NAMES[sec_idx % len(SECTION_NAMES)],
                "sectionIndex": sec_idx,
                "key": dict(key),
                "chord": chord,
                "energy": energy,
                "activeLayers": layers_on,
                "padVoicing": voicing,
            }
        )
    return bars


def base_tempo(seed: int, mood: str, params: dict[str, Any]) -> float:
    p = sanitize_params(params)
    if p["tempo"] is not None:
        return float(p["tempo"])
    lo, hi = MOOD_TEMPO.get(mood, (84, 102))
    return float(int_range(seed, "tempo", lo, hi))
