from __future__ import annotations

import os
from typing import Any

_loaded: Any = None
_use_stub = True


def use_stub() -> bool:
    if os.environ.get("GF_NEURAL_STUB", "").strip().lower() in ("1", "true", "yes"):
        return True
    return _use_stub


def get_note_backend() -> str:
    if use_stub():
        return "stub"
    return "transformer"


def try_load_model() -> None:
    global _loaded, _use_stub
    if os.environ.get("GF_NEURAL_STUB", "").strip().lower() in ("1", "true", "yes"):
        _use_stub = True
        return
    try:
        import torch
        from transformers import AutoModelForCausalLM
    except ImportError:
        _use_stub = True
        return
    if not torch.cuda.is_available():
        _use_stub = True
        return
    from server.config import AMT_MODEL_ID, NEURAL_MODEL_PATH

    model_id = NEURAL_MODEL_PATH or AMT_MODEL_ID
    try:
        _loaded = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.float16, device_map="cuda")
        _loaded.eval()
        _use_stub = False
    except Exception as exc:
        import sys

        print(f"[ghost-frequency] neural model load failed ({model_id}): {exc}", file=sys.stderr)
        _use_stub = True


def generate_with_model(
    context_bars: list[dict[str, Any]],
    layers: list[str],
    params: dict[str, Any],
    history_tokens: list[str],
) -> list[dict[str, Any]]:
    """Dispatch to stub or (future) transformer decode. Stub is the production fallback."""
    from .stub_model import generate_bar_notes

    if use_stub() or _loaded is None:
        events: list[dict[str, Any]] = []
        for ctx in context_bars:
            events.extend(generate_bar_notes(ctx, layers, params))
        return events

    # Real model path: until LoRA weights ship, fall back to stub after load check.
    events = []
    for ctx in context_bars:
        events.extend(generate_bar_notes(ctx, layers, params))
    return events
