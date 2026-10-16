"""Deterministic RNG streams (hash-based, stable across processes)."""

from __future__ import annotations

import hashlib
import struct
from typing import Iterator


def _u32(seed: int, label: str, index: int = 0) -> int:
    h = hashlib.sha256(f"{seed & 0xFFFFFFFF}:{label}:{index}".encode()).digest()
    return struct.unpack(">I", h[:4])[0]


def stream_u32(seed: int, label: str) -> Iterator[int]:
    i = 0
    while True:
        yield _u32(seed, label, i)
        i += 1


def int_range(seed: int, label: str, lo: int, hi: int, index: int = 0) -> int:
    """Inclusive lo..hi."""
    if hi < lo:
        lo, hi = hi, lo
    span = hi - lo + 1
    return lo + (_u32(seed, label, index) % span)


def float01(seed: int, label: str, index: int = 0) -> float:
    return _u32(seed, label, index) / 0xFFFFFFFF
