from __future__ import annotations

from typing import Any

from ..base import ComposerEngine, EngineInfo
from ..theory import BEATS_PER_BAR, SCHEMA_VERSION, sanitize_params
from .constants import NEURAL_MELODIC_LAYERS
from .context import parse_context
from .notes_engine import generate_layers, trim_history_for_bars


class NeuralLayersEngine(ComposerEngine):
    def __init__(self) -> None:
        self._seed = 0
        self._history: list[str] = []
        self._base_tempo = 90.0

    @property
    def info(self) -> EngineInfo:
        return EngineInfo(
            id="py-neural-layers",
            name="Neural layers (lead/arp/bass/drums)",
            mode="layers",
            layers=NEURAL_MELODIC_LAYERS,
        )

    def init(self, seed: int, params: dict[str, Any]) -> None:
        p = sanitize_params({**params, "seed": seed})
        self._seed = p["seed"]
        self._history = []
        from .skeleton_model import base_tempo

        self._base_tempo = base_tempo(self._seed, p["mood"], p)

    def render_bars(
        self,
        from_bar: int,
        count: int,
        params: dict[str, Any],
        context: list[Any] | None = None,
    ) -> dict[str, Any]:
        p = sanitize_params(params)
        if self._seed != p["seed"]:
            self.init(p["seed"], p)
        ctx = parse_context(context)
        n = max(0, int(count))
        if len(ctx) < n:
            raise ValueError("py-neural-layers requires context with one entry per requested bar")
        slice_ctx = ctx[:n]
        note_events, self._history = generate_layers(
            slice_ctx,
            list(NEURAL_MELODIC_LAYERS),
            {**p, "seed": self._seed},
            self._history,
        )
        self._history = trim_history_for_bars(self._history)
        start_beat = from_bar * BEATS_PER_BAR
        end_beat = (from_bar + n) * BEATS_PER_BAR
        note_events.sort(key=lambda e: (e["beat"], e["layer"]))
        clipped = [e for e in note_events if start_beat <= e["beat"] < end_beat]
        tempo = p["tempo"] if p["tempo"] is not None else self._base_tempo
        return {
            "version": SCHEMA_VERSION,
            "startBeat": start_beat,
            "endBeat": end_beat,
            "tempo": float(tempo),
            "timeSig": [4, 4],
            "events": clipped,
        }


def create_layers() -> NeuralLayersEngine:
    return NeuralLayersEngine()
