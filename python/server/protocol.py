from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, Field, field_validator

from engines.theory import sanitize_params, sanitize_vibe


class VibeParamsModel(BaseModel):
    brightness: float = 0.5
    tension: float = 0.5
    density: float = 0.5
    groove: float = 0.5


class GenerationParamsModel(BaseModel):
    mood: str = "nostalgic"
    energy: float = 0.5
    complexity: float = 0.5
    variation: float = 0.5
    tempo: float | None = None
    seed: int = 0
    vibe: VibeParamsModel | None = None

    def to_dict(self) -> dict[str, Any]:
        d = self.model_dump()
        if d.get("vibe") is not None:
            d["vibe"] = sanitize_vibe(d["vibe"])
        return sanitize_params(d)


class KeySpecModel(BaseModel):
    tonic: int
    scale: str


class ChordSpecModel(BaseModel):
    root: int
    label: str
    intervals: list[int]
    numeral: str | None = None


class BarContextModel(BaseModel):
    bar: int
    sectionName: str
    sectionIndex: int
    key: KeySpecModel
    chord: ChordSpecModel
    energy: float
    activeLayers: list[str]
    padVoicing: list[int]


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
    context: list[BarContextModel] | None = None


class ClientVibePrompt(BaseModel):
    type: Literal["vibe_prompt"] = "vibe_prompt"
    text: str = Field(max_length=500)


class ClientPing(BaseModel):
    type: Literal["ping"] = "ping"
    t: float | None = None


ClientMessage = Union[ClientHello, ClientInit, ClientRender, ClientPing, ClientVibePrompt]


class GenerateBody(BaseModel):
    engineId: str
    seed: int
    params: GenerationParamsModel
    fromBar: int = Field(ge=0)
    bars: int = Field(ge=1, le=16)
    context: list[BarContextModel] | None = None

    @field_validator("bars")
    @classmethod
    def cap_bars(cls, v: int) -> int:
        return min(v, 16)
