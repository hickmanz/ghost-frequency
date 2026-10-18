"""Train / export skeleton structure model (bar-level chords, layers, energy)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    meta = {"type": "rule_skeleton_v1", "source": str(args.data)}
    (args.out / "skeleton.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {args.out / 'skeleton.json'}")


if __name__ == "__main__":
    main()
