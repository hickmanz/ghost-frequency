from __future__ import annotations

from typing import Any, Callable

from .base import ComposerEngine
from .markov_engine import create_markov

Factory = Callable[[], ComposerEngine]

REGISTRY: dict[str, Factory] = {
    "py-markov": create_markov,
}


def _register_neural() -> None:
    try:
        from .neural.full_engine import create_full
        from .neural.layers_engine import create_layers

        REGISTRY["py-neural-layers"] = create_layers
        REGISTRY["py-neural-full"] = create_full
    except ImportError:
        pass


_register_neural()


def list_engines() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for fid in REGISTRY:
        eng = REGISTRY[fid]()
        info = eng.info
        d: dict[str, Any] = {"id": info.id, "name": info.name}
        if info.mode:
            d["mode"] = info.mode
        if info.layers:
            d["layers"] = list(info.layers)
        out.append(d)
    return out


def get_engine(engine_id: str) -> ComposerEngine:
    if engine_id not in REGISTRY:
        raise KeyError(f"Unknown engine: {engine_id}")
    return REGISTRY[engine_id]()
