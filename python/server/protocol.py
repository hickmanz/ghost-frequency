from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, Field, field_validator

from engines.theory import sanitize_params


class GenerationParamsModel(BaseModel):
    mood: str = "nostalgic"
    energy: float = 0.5
    complexity: float = 0.5
    variation: float = 0.5
    tempo: float | None = None
    seed: int = 0

    def to_dict(self) -> dict[str, Any]:
        return sanitize_params(self.model_dump())


class ClientHello(BaseModel):
    type: Literal["hello"] = "hello"
    protocol: int
    token: str
    engineId: str
    seed: int
    params: GenerationParamsModel


class ClientInit(BaseModel):
    type: Literal["init"] = "init"
    epoch: int
    seed: int
    engineId: str
    params: GenerationParamsModel


class ClientRender(BaseModel):
    type: Literal["render"] = "render"
    epoch: int
    fromBar: int = Field(ge=0)
    count: int = Field(ge=0, le=16)
    params: GenerationParamsModel


class ClientPing(BaseModel):
    type: Literal["ping"] = "ping"
    t: float | None = None


ClientMessage = Union[ClientHello, ClientInit, ClientRender, ClientPing]


class GenerateBody(BaseModel):
    engineId: str
    seed: int
    params: GenerationParamsModel
    fromBar: int = Field(ge=0)
    bars: int = Field(ge=1, le=16)

    @field_validator("bars")
    @classmethod
    def cap_bars(cls, v: int) -> int:
        return min(v, 16)
