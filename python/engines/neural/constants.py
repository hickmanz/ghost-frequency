from __future__ import annotations

BEATS_PER_BAR = 4

LAYER_REGISTER: dict[str, tuple[int, int]] = {
    "bass": (28, 52),
    "arp": (48, 76),
    "lead": (60, 88),
    "pad": (36, 72),
    "texture": (48, 84),
    "drums": (35, 51),
}

NEURAL_MELODIC_LAYERS = ("lead", "arp", "bass", "drums")
ALL_LAYERS = ("pad", "arp", "bass", "lead", "drums", "texture")

DRUM_PITCHES = (36, 38, 42, 46)
