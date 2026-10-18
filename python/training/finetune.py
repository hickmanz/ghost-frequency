"""
LoRA fine-tune driver for the note model (requires requirements-ml.txt + CUDA).

Usage:
  python -m training.finetune --data data/shards --out models/note-lora
"""
from __future__ import annotations

import argparse
import os


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=str, required=True)
    ap.add_argument("--out", type=str, required=True)
    ap.add_argument("--base", type=str, default=os.environ.get("GF_AMT_MODEL", "stanford-crfm/music-small-800k"))
    ap.add_argument("--epochs", type=int, default=1)
    args = ap.parse_args()

    try:
        import torch
        from peft import LoraConfig, get_peft_model
        from transformers import AutoModelForCausalLM
    except ImportError as exc:
        raise SystemExit("Install requirements-ml.txt to run finetune") from exc

    if not torch.cuda.is_available():
        raise SystemExit("CUDA required for finetune")

    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.float16, device_map="cuda")
    lora = LoraConfig(r=8, lora_alpha=16, target_modules=["q_proj", "v_proj"], lora_dropout=0.05, bias="none", task_type="CAUSAL_LM")
    model = get_peft_model(model, lora)
    os.makedirs(args.out, exist_ok=True)
    model.save_pretrained(args.out)
    print(f"[finetune] wrote adapter scaffold to {args.out} (wire dataset loader to train for real)")


if __name__ == "__main__":
    main()
