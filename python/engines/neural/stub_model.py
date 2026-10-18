from __future__ import annotations

import hashlib
from typing import Any

from ..rng import float01, int_range
from ..theory import BEATS_PER_BAR, clamp, clamp01
from .sampler import clamp_note, note_event


def _rng(seed: int, tag: str) -> float:
    return float01(seed, tag)


def generate_bar_notes(
    ctx: dict[str, Any],
    layers: list[str],
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    bar = int(ctx.get("bar", 0))
    seed = int(params.get("seed", 0)) ^ (bar * 9973)
    vibe = params.get("vibe") or {}
    energy = clamp01(float(ctx.get("energy", params.get("energy", 0.5))))
    density = clamp01(float(vibe.get("density", 0.5)) * 0.6 + float(params.get("complexity", 0.5)) * 0.4)
    groove = clamp01(float(vibe.get("groove", 0.5)))
    tension = clamp01(float(vibe.get("tension", 0.5)))
    brightness = clamp01(float(vibe.get("brightness", 0.5)))

    key = ctx.get("key") or {"tonic": 0, "scale": "aeolian"}
    chord = ctx.get("chord") or {"root": 48, "intervals": [0, 3, 7]}
    beat0 = bar * BEATS_PER_BAR
    active = set(ctx.get("activeLayers") or layers)
    out: list[dict[str, Any]] = []

    if "bass" in layers and "bass" in active:
        root = int(chord.get("root", 48)) - 12
        for sub in (0.0, 2.0):
            if groove > 0.6 and sub == 2.0 and _rng(seed, f"bass_skip_{sub}") < 0.25:
                continue
            midi = clamp_note("bass", root, key, chord, tension) or root
            out.append(note_event("bass", beat0 + sub, 1.75, midi, 0.45 + energy * 0.35))

    if "arp" in layers and "arp" in active:
        steps = 8 if density < 0.55 else 16
        hits = 2 + int(density * 5)
        arp_notes = [int(chord.get("root", 48)) + i for i in (chord.get("intervals") or [0, 3, 7])]
        if brightness > 0.55:
            arp_notes.append(int(chord.get("root", 48)) + 12)
        for step in range(steps):
            if step % max(1, steps // hits) != 0 and _rng(seed, f"arp_{step}") > density:
                continue
            sub = step * (BEATS_PER_BAR / steps)
            idx = int_range(seed, f"arp_i_{step}", 0, len(arp_notes) - 1)
            raw = arp_notes[idx]
            midi = clamp_note("arp", raw, key, chord, tension) or raw
            out.append(
                note_event("arp", beat0 + sub, BEATS_PER_BAR / steps * 0.85, midi, 0.22 + energy * 0.35)
            )

    if "lead" in layers and "lead" in active:
        if _rng(seed, "lead_on") < 0.35 + density * 0.45:
            n_notes = 1 + int(density * 2)
            for i in range(n_notes):
                sub = _rng(seed, f"lead_t_{i}") * (BEATS_PER_BAR - 1.5)
                deg = int_range(seed, f"lead_m_{i}", 0, 4)
                raw = int(chord.get("root", 48)) + 12 + deg * 2
                if brightness > 0.65:
                    raw += 2
                midi = clamp_note("lead", raw, key, chord, tension) or raw
                out.append(note_event("lead", beat0 + sub, 1.5 + _rng(seed, f"lead_d_{i}"), midi, 0.28 + energy * 0.3))

    if "drums" in layers and "drums" in active and energy > 0.38:
        if _rng(seed, "drums") > 0.2:
            for step in range(4):
                if step % 2 == 0:
                    out.append(note_event("drums", beat0 + step, 0.25, 36, 0.55 + energy * 0.25))
                if (step == 1 or step == 3) and groove > 0.35:
                    out.append(note_event("drums", beat0 + step, 0.15, 42, 0.3 + groove * 0.25))
                if groove > 0.7 and step == 2 and _rng(seed, "clap") > 0.5:
                    out.append(note_event("drums", beat0 + step + 0.5, 0.12, 38, 0.4))

    # pad/texture for full engine path
    if "pad" in layers and "pad" in active:
        voicing = ctx.get("padVoicing") or []
        for i, midi in enumerate(voicing[:4]):
            out.append(note_event("pad", beat0, BEATS_PER_BAR * 0.95, int(midi), 0.32 + energy * 0.2))

    if "texture" in layers and density < 0.75:
        if _rng(seed, "tex") > 0.55:
            midi = clamp(int(chord.get("root", 48)) + 24, 48, 84)
            out.append(note_event("texture", beat0, BEATS_PER_BAR, midi, 0.15 + (1 - density) * 0.2))

    return [e for e in out if e["layer"] in layers]


def history_fingerprint(history: list[str]) -> str:
    h = hashlib.sha256("".join(history).encode()).hexdigest()[:12]
    return h
