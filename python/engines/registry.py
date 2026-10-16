from __future__ import annotations

from typing import Callable

from .base import ComposerEngine
from .markov_engine import create_markov

Factory = Callable[[], ComposerEngine]

REGISTRY: dict[str, Factory] = {
    "py-markov": create_markov,
}


def list_engines() -> list[dict[str, str]]:
    return [{"id": fid, "name": REGISTRY[fid]().info.name} for fid in REGISTRY]


def get_engine(engine_id: str) -> ComposerEngine:
    if engine_id not in REGISTRY:
        raise KeyError(f"Unknown engine: {engine_id}")
    return REGISTRY[engine_id]()
