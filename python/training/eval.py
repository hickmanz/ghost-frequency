"""Evaluate neural engine outputs: vibe match, in-key rate, repetition, timing."""
from __future__ import annotations

import argparse
import time

from engines.neural.features import measure_vibe
from engines.neural.full_engine import create_full
from engines.neural.skeleton_model import plan_bars
from engines.theory import scale_pcs


def in_key_rate(events: list[dict], key: dict) -> float:
    pcs = set(scale_pcs(key))
    notes = [e for e in events if e.get("kind") == "note" and e.get("layer") != "drums"]
    if not notes:
        return 1.0
    ok = sum(1 for n in notes if int(n["midi"]) % 12 in pcs)
    return ok / len(notes)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", type=int, default=16)
    args = ap.parse_args()
    params = {
        "mood": "nostalgic",
        "energy": 0.55,
        "complexity": 0.5,
        "variation": 0.6,
        "tempo": None,
        "seed": 42,
        "vibe": {"brightness": 0.5, "tension": 0.4, "density": 0.55, "groove": 0.5},
    }
    eng = create_full()
    eng.init(42, params)
    t0 = time.perf_counter()
    batch = eng.render_bars(0, args.bars, params)
    elapsed = time.perf_counter() - t0
    ctx = plan_bars(0, args.bars, params, 42)
    key = ctx[0]["key"]
    target_vibe = params["vibe"]
    measured = measure_vibe(batch["events"], key)
    print(f"ms/bar: {elapsed / args.bars * 1000:.2f}")
    print(f"in_key_rate: {in_key_rate(batch['events'], key):.3f}")
    print(f"vibe target: {target_vibe}")
    print(f"vibe measured: {measured}")


if __name__ == "__main__":
    main()
