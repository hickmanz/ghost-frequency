from __future__ import annotations

from typing import Any

from ..base import ComposerEngine, EngineInfo
from ..theory import BEATS_PER_BAR, SCHEMA_VERSION, sanitize_params
from .automation_rules import automation_for_bars
from .constants import ALL_LAYERS
from .notes_engine import generate_layers, trim_history_for_bars
from .skeleton_model import base_tempo, plan_bars


class NeuralFullEngine(ComposerEngine):
    def __init__(self) -> None:
        self._seed = 0
        self._history: list[str] = []
        self._base_tempo = 90.0

    @property
    def info(self) -> EngineInfo:
        return EngineInfo(id="py-neural-full", name="Neural full composer", mode="full")

    def init(self, seed: int, params: dict[str, Any]) -> None:
        p = sanitize_params({**params, "seed": seed})
        self._seed = p["seed"]
        self._history = []
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
        n = max(0, int(count))
        ctx = plan_bars(from_bar, n, p, self._seed)
        note_events, self._history = generate_layers(
            ctx,
            list(ALL_LAYERS),
            {**p, "seed": self._seed},
            self._history,
        )
        self._history = trim_history_for_bars(self._history)
        events: list[dict[str, Any]] = []
        for c in ctx:
            beat0 = int(c["bar"]) * BEATS_PER_BAR
            events.append(
                {
                    "kind": "section",
                    "beat": beat0,
                    "name": c["sectionName"],
                    "sectionIndex": c["sectionIndex"],
                    "key": c["key"],
                    "chord": c["chord"],
                    "energy": c["energy"],
                }
            )
        events.extend(automation_for_bars(ctx))
        events.extend(note_events)
        start_beat = from_bar * BEATS_PER_BAR
        end_beat = (from_bar + n) * BEATS_PER_BAR
        priority = lambda e: 0 if e["kind"] == "section" else 1 if e["kind"] == "automation" else 2
        events.sort(key=lambda e: (e["beat"], priority(e)))
        clipped = [e for e in events if start_beat <= e["beat"] < end_beat]
        tempo = p["tempo"] if p["tempo"] is not None else self._base_tempo
        return {
            "version": SCHEMA_VERSION,
            "startBeat": start_beat,
            "endBeat": end_beat,
            "tempo": float(tempo),
            "timeSig": [4, 4],
            "events": clipped,
        }


def create_full() -> NeuralFullEngine:
    return NeuralFullEngine()
