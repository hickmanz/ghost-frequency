"""
Phase 0 spike: load Anticipatory Music Transformer (or stub) and measure generation time.

Usage (from python/ with ML deps installed):
  python -m training.spike_amt

Set GF_NEURAL_STUB=1 to skip Hugging Face download and use the in-repo stub timing path.
"""
from __future__ import annotations

import os
import time


def _fixed_chord_context() -> dict:
    return {
        "bar": 0,
        "sectionName": "Drift",
        "sectionIndex": 0,
        "key": {"tonic": 9, "scale": "aeolian"},
        "chord": {
            "root": 45,
            "label": "Am",
            "numeral": "i",
            "intervals": [0, 3, 7],
        },
        "energy": 0.55,
        "activeLayers": ["pad", "arp", "bass", "lead", "drums"],
        "padVoicing": [45, 48, 52, 57],
    }


def main() -> None:
    bars = 8
    ctx = [_fixed_chord_context() for _ in range(bars)]
    for i, c in enumerate(ctx):
        c = dict(c)
        c["bar"] = i
        ctx[i] = c

    if os.environ.get("GF_NEURAL_STUB", "").strip() in ("1", "true", "yes"):
        from engines.neural.notes_engine import generate_layers

        t0 = time.perf_counter()
        generate_layers(ctx, ["lead"], {"mood": "nostalgic", "energy": 0.5, "complexity": 0.5, "variation": 0.5, "tempo": None, "seed": 1, "vibe": None}, [])
        elapsed = time.perf_counter() - t0
        print(f"[spike] stub generate_layers {bars} bars (lead only): {elapsed:.3f}s ({elapsed / bars * 1000:.1f} ms/bar)")
        return

    try:
        import torch
        from transformers import AutoModelForCausalLM
    except ImportError:
        print("[spike] torch/transformers not installed; run with GF_NEURAL_STUB=1 or pip install -r requirements-ml.txt")
        return

    if not torch.cuda.is_available():
        print("[spike] CUDA not available; timing stub path instead")
        os.environ["GF_NEURAL_STUB"] = "1"
        main()
        return

    model_id = os.environ.get("GF_AMT_MODEL", "sander-wood/anticipation")
    print(f"[spike] loading {model_id} on CUDA (fp16)...")
    t_load = time.perf_counter()
    model = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.float16, device_map="cuda")
    model.eval()
    load_s = time.perf_counter() - t_load
    print(f"[spike] load time: {load_s:.1f}s")

    # Minimal forward pass proxy for throughput (full AMT token pipeline lives in finetune path).
    dummy = torch.randint(0, min(model.config.vocab_size, 512), (1, 64), device="cuda")
    t0 = time.perf_counter()
    with torch.inference_mode():
        for _ in range(bars):
            _ = model(input_ids=dummy)
    torch.cuda.synchronize()
    elapsed = time.perf_counter() - t0
    print(f"[spike] {bars} x forward(64 tokens): {elapsed:.3f}s ({elapsed / bars * 1000:.1f} ms/bar proxy)")


if __name__ == "__main__":
    main()
