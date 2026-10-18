from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EngineInfo:
    id: str
    name: str
    mode: str = "full"
    layers: tuple[str, ...] = ()


class ComposerEngine(ABC):
    @property
    @abstractmethod
    def info(self) -> EngineInfo: ...

    @abstractmethod
    def init(self, seed: int, params: dict[str, Any]) -> None: ...

    @abstractmethod
    def render_bars(
        self,
        from_bar: int,
        count: int,
        params: dict[str, Any],
        context: list[Any] | None = None,
    ) -> dict[str, Any]: ...
