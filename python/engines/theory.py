from __future__ import annotations

from typing import Any

SCHEMA_VERSION = 1
BEATS_PER_BAR = 4

SCALE_INTERVALS: dict[str, list[int]] = {
    "ionian": [0, 2, 4, 5, 7, 9, 11],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "aeolian": [0, 2, 3, 5, 7, 8, 10],
    "locrian": [0, 1, 3, 5, 6, 8, 10],
    "harmonicMinor": [0, 2, 3, 5, 7, 8, 11],
}

MOOD_KEYS: dict[str, list[tuple[int, str]]] = {
    "dreamy": [(9, "lydian"), (4, "ionian"), (2, "dorian")],
    "dark": [(8, "phrygian"), (10, "aeolian"), (3, "locrian")],
    "nostalgic": [(9, "aeolian"), (4, "mixolydian"), (11, "dorian")],
    "space": [(0, "dorian"), (7, "mixolydian"), (5, "phrygian")],
}

MOOD_TEMPO: dict[str, tuple[int, int]] = {
    "dreamy": (72, 96),
    "dark": (80, 108),
    "nostalgic": (84, 102),
    "space": (68, 88),
}

# Roman numerals -> diatonic triad intervals (semitones from root)
TRIADS = {
    "I": [0, 4, 7],
    "i": [0, 3, 7],
    "II": [0, 4, 7],
    "ii": [0, 3, 7],
    "III": [0, 4, 7],
    "iii": [0, 3, 7],
    "IV": [0, 4, 7],
    "iv": [0, 3, 7],
    "V": [0, 4, 7],
    "v": [0, 3, 7],
    "VI": [0, 4, 7],
    "vi": [0, 3, 7],
    "VII": [0, 4, 7],
    "vii": [0, 3, 6],
    "bVII": [0, 4, 7],
    "bVI": [0, 4, 7],
    "bIII": [0, 4, 7],
}


def mod12(n: int) -> int:
    return n % 12


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def sanitize_params(p: dict[str, Any]) -> dict[str, Any]:
    moods = {"dreamy", "dark", "nostalgic", "space"}
    mood = p.get("mood", "nostalgic")
    if mood not in moods:
        mood = "nostalgic"
    tempo = p.get("tempo")
    if tempo is not None:
        try:
            tempo = clamp(float(tempo), 40, 200)
        except (TypeError, ValueError):
            tempo = None
    seed = int(p.get("seed", 0)) & 0xFFFFFFFF
    return {
        "mood": mood,
        "energy": clamp01(float(p.get("energy", 0.5))),
        "complexity": clamp01(float(p.get("complexity", 0.5))),
        "variation": clamp01(float(p.get("variation", 0.5))),
        "tempo": tempo,
        "seed": seed,
    }


def key_for(seed: int, mood: str) -> dict[str, Any]:
    from .rng import int_range

    choices = MOOD_KEYS.get(mood, MOOD_KEYS["nostalgic"])
    idx = int_range(seed, "key", 0, len(choices) - 1)
    tonic, scale = choices[idx]
    return {"tonic": tonic, "scale": scale}


def scale_pcs(key: dict[str, Any]) -> list[int]:
    return [mod12(key["tonic"] + i) for i in SCALE_INTERVALS[key["scale"]]]


def degree_root_midi(key: dict[str, Any], degree: int, octave: int = 3) -> int:
    pcs = scale_pcs(key)
    d = degree % 7
    return 12 * (octave + 1) + pcs[d]


def chord_spec(key: dict[str, Any], numeral: str, label: str | None = None) -> dict[str, Any]:
    pcs = scale_pcs(key)
    degree_map = {
        "I": 0,
        "i": 0,
        "II": 1,
        "ii": 1,
        "III": 2,
        "iii": 2,
        "IV": 3,
        "iv": 3,
        "V": 4,
        "v": 4,
        "VI": 5,
        "vi": 5,
        "VII": 6,
        "vii": 6,
        "bVII": 6,
        "bVI": 5,
        "bIII": 2,
    }
    deg = degree_map.get(numeral, 0)
    root = 12 * 4 + pcs[deg]
    intervals = list(TRIADS.get(numeral, [0, 3, 7]))
    if label is None:
        label = numeral
    return {"root": root, "label": label, "numeral": numeral, "intervals": intervals}


def euclidean(hits: int, steps: int, rotation: int = 0) -> list[bool]:
    if steps <= 0:
        return []
    hits = max(0, min(hits, steps))
    pattern = [False] * steps
    if hits == 0:
        return pattern
    for i in range(hits):
        idx = (i * steps // hits + rotation) % steps
        pattern[idx] = True
    return pattern
