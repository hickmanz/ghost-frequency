from __future__ import annotations

from typing import Any

from .conditioning import params_to_control_tokens
from .model import generate_with_model
from .tokenizer import events_to_token_strings


HISTORY_MAX_BARS = 8


def generate_layers(
    context_bars: list[dict[str, Any]],
    layers: list[str],
    params: dict[str, Any],
    history_tokens: list[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    if not context_bars:
        return [], history_tokens
    control = params_to_control_tokens(params)
    _ = control  # reserved for transformer conditioning
    events = generate_with_model(context_bars, layers, params, history_tokens)
    new_tokens = events_to_token_strings(events)
    merged = (history_tokens + new_tokens)[-256:]
    return events, merged


def trim_history_for_bars(history_tokens: list[str], keep_bars: int = HISTORY_MAX_BARS) -> list[str]:
    if keep_bars <= 0:
        return []
    # coarse trim by token count (~16 tokens per bar)
    max_tokens = keep_bars * 24
    if len(history_tokens) <= max_tokens:
        return history_tokens
    return history_tokens[-max_tokens:]
