"""
Prepare MIDI corpus -> tokenized training shards (skeleton + multilayer notes).

Usage:
  python -m training.prepare --midi-dir /path/to/midis --out data/shards
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from engines.neural.features import measure_vibe
from engines.neural.skeleton_model import plan_bars


GM_BASS = range(32, 40)
GM_LEAD = range(80, 88)
GM_PAD = range(88, 96)


def layer_for_program(program: int, is_drum: bool) -> str | None:
    if is_drum:
        return "drums"
    if program in GM_BASS:
        return "bass"
    if program in GM_PAD:
        return "pad"
    if program in GM_LEAD:
        return "lead"
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--midi-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=1984)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    # Placeholder shard: local-js style skeletons for pipeline wiring.
    params = {"mood": "nostalgic", "energy": 0.5, "complexity": 0.5, "variation": 0.5, "tempo": None, "seed": args.seed, "vibe": None}
    ctx = plan_bars(0, 16, params, args.seed)
    shard = {"bars": ctx, "vibe": measure_vibe([], ctx[0]["key"] if ctx else None)}
    (args.out / "skeleton_demo.json").write_text(json.dumps(shard, indent=2), encoding="utf-8")
    print(f"wrote {args.out / 'skeleton_demo.json'}")


if __name__ == "__main__":
    main()
