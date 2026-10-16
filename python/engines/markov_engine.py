from __future__ import annotations

from typing import Any

from .base import ComposerEngine, EngineInfo
from .rng import float01, int_range
from .theory import (
    BEATS_PER_BAR,
    MOOD_TEMPO,
    SCHEMA_VERSION,
    chord_spec,
    clamp,
    clamp01,
    euclidean,
    key_for,
    sanitize_params,
)

# Markov transitions on roman numerals (ambient minor-ish bias)
TRANSITIONS: dict[str, list[tuple[str, int]]] = {
    "i": [("VI", 3), ("iv", 2), ("V", 2), ("III", 1), ("i", 1)],
    "VI": [("iv", 2), ("III", 2), ("i", 2), ("V", 1)],
    "iv": [("i", 3), ("V", 2), ("VI", 1)],
    "V": [("i", 3), ("VI", 2), ("III", 1)],
    "III": [("VI", 2), ("iv", 2), ("i", 2)],
    "I": [("V", 2), ("vi", 2), ("IV", 2), ("I", 1)],
    "vi": [("IV", 2), ("V", 2), ("I", 2)],
    "IV": [("I", 2), ("V", 2), ("vi", 2)],
}

SECTION_NAMES = ["Drift", "Glow", "Pulse", "Apex", "Fade"]


class MarkovEngine(ComposerEngine):
    def __init__(self) -> None:
        self._seed = 0
        self._key: dict[str, Any] | None = None
        self._base_tempo = 90.0
        self._section_len = 16

    @property
    def info(self) -> EngineInfo:
        return EngineInfo(id="py-markov", name="Python Markov (harmony graph)")

    def init(self, seed: int, params: dict[str, Any]) -> None:
        p = sanitize_params({**params, "seed": seed})
        self._seed = p["seed"]
        self._key = key_for(self._seed, p["mood"])
        lo, hi = MOOD_TEMPO[p["mood"]]
        self._base_tempo = float(int_range(self._seed, "tempo", lo, hi))
        self._section_len = 8 + int_range(self._seed, "sect", 0, 2) * 8

    def _tempo(self, params: dict[str, Any]) -> float:
        p = sanitize_params(params)
        if p["tempo"] is not None:
            return float(p["tempo"])
        return self._base_tempo

    def _chord_at(self, bar: int) -> str:
        minorish = self._key and self._key["scale"] in (
            "aeolian",
            "dorian",
            "phrygian",
            "locrian",
            "harmonicMinor",
        )
        cur = "i" if minorish else "I"
        for b in range(bar + 1):
            if b > 0 and b % self._section_len == 0 and int_range(self._seed, f"sect_chord_{b}", 0, 1):
                cur = "VI"
            choices = TRANSITIONS.get(cur, TRANSITIONS["i"])
            total = sum(w for _, w in choices)
            r = int_range(self._seed, f"chord_{b}", 0, total - 1)
            acc = 0
            for num, w in choices:
                acc += w
                if r < acc:
                    cur = num
                    break
        return cur

    def render_bars(self, from_bar: int, count: int, params: dict[str, Any]) -> dict[str, Any]:
        p = sanitize_params(params)
        if self._key is None or self._seed != p["seed"]:
            self.init(p["seed"], p)
        assert self._key is not None

        n = max(0, int(count))
        end_bar = from_bar + n
        events: list[dict[str, Any]] = []
        key = self._key

        for bar in range(from_bar, end_bar):
            num = self._chord_at(bar)
            chord = chord_spec(key, num)
            beat0 = bar * BEATS_PER_BAR
            sec_idx = bar // self._section_len
            sec_name = SECTION_NAMES[sec_idx % len(SECTION_NAMES)]
            energy = clamp01(p["energy"] * (0.85 + 0.15 * float01(p["seed"], f"en_{bar}")))
            events.append(
                {
                    "kind": "section",
                    "beat": beat0,
                    "name": sec_name,
                    "sectionIndex": sec_idx,
                    "key": dict(key),
                    "chord": chord,
                    "energy": energy,
                }
            )

            # Pad: whole-bar voicing
            voicing = [chord["root"] + iv for iv in chord["intervals"]]
            if p["complexity"] > 0.5:
                voicing.append(chord["root"] + 12)
            for i, midi in enumerate(voicing):
                events.append(
                    {
                        "kind": "note",
                        "layer": "pad",
                        "beat": beat0,
                        "durBeats": BEATS_PER_BAR * (0.95 + 0.05 * p["variation"]),
                        "midi": int(midi),
                        "vel": clamp(0.35 + energy * 0.25, 0.2, 0.75),
                    }
                )

            # Bass: root on 1 and 3
            for sub in (0.0, 2.0):
                events.append(
                    {
                        "kind": "note",
                        "layer": "bass",
                        "beat": beat0 + sub,
                        "durBeats": 1.8,
                        "midi": int(chord["root"] - 12),
                        "vel": clamp(0.5 + energy * 0.3, 0.3, 0.9),
                    }
                )

            # Arp: euclidean pattern
            steps = 8 if p["complexity"] < 0.6 else 16
            hits = 3 + int(p["complexity"] * 4)
            rot = int_range(p["seed"], f"arp_rot_{bar}", 0, steps - 1)
            pat = euclidean(hits, steps, rot)
            arp_notes = [chord["root"] + iv for iv in chord["intervals"]] + [chord["root"] + 12]
            for step, on in enumerate(pat):
                if not on:
                    continue
                sub = step * (BEATS_PER_BAR / steps)
                idx = int_range(p["seed"], f"arp_n_{bar}_{step}", 0, len(arp_notes) - 1)
                events.append(
                    {
                        "kind": "note",
                        "layer": "arp",
                        "beat": beat0 + sub,
                        "durBeats": BEATS_PER_BAR / steps * 0.9,
                        "midi": int(arp_notes[idx]),
                        "vel": clamp(0.25 + energy * 0.35, 0.15, 0.7),
                    }
                )

            # Sparse lead
            if float01(p["seed"], f"lead_{bar}") < 0.35 + p["variation"] * 0.3:
                sub = float(int_range(p["seed"], f"lead_t_{bar}", 0, 3))
                lead_midi = chord["root"] + 12 + int_range(p["seed"], f"lead_m_{bar}", 0, 2) * 2
                events.append(
                    {
                        "kind": "note",
                        "layer": "lead",
                        "beat": beat0 + sub,
                        "durBeats": 2.5,
                        "midi": int(lead_midi),
                        "vel": clamp(0.3 + energy * 0.25, 0.2, 0.65),
                    }
                )

            # Drums when energy high
            if energy > 0.45 and float01(p["seed"], f"drm_{bar}") > 0.25:
                for step in range(4):
                    if step % 2 == 0:
                        events.append(
                            {
                                "kind": "note",
                                "layer": "drums",
                                "beat": beat0 + step,
                                "durBeats": 0.25,
                                "midi": 36,
                                "vel": 0.6,
                            }
                        )
                    if step == 1 or step == 3:
                        events.append(
                            {
                                "kind": "note",
                                "layer": "drums",
                                "beat": beat0 + step,
                                "durBeats": 0.15,
                                "midi": 42,
                                "vel": 0.35,
                            }
                        )

            if bar % 8 == 0:
                events.append(
                    {
                        "kind": "automation",
                        "target": "send.reverb",
                        "beat": beat0,
                        "value": clamp01(0.35 + p["variation"] * 0.3),
                        "rampBeats": 4,
                    }
                )

        start_beat = from_bar * BEATS_PER_BAR
        end_beat = end_bar * BEATS_PER_BAR
        events.sort(key=lambda e: (e["beat"], 0 if e["kind"] == "section" else 1 if e["kind"] == "automation" else 2))

        return {
            "version": SCHEMA_VERSION,
            "startBeat": start_beat,
            "endBeat": end_beat,
            "tempo": self._tempo(p),
            "timeSig": [4, 4],
            "events": [e for e in events if start_beat <= e["beat"] < end_beat],
        }


def create_markov() -> MarkovEngine:
    return MarkovEngine()
