from __future__ import annotations

from typing import Any

from ..theory import clamp01, sanitize_vibe

# Curated anchor phrases -> vibe + optional mood hint
ANCHORS: list[dict[str, Any]] = [
    {"text": "rainy neon drive melancholic synthwave", "vibe": {"brightness": 0.45, "tension": 0.55, "density": 0.5, "groove": 0.55}, "mood": "nostalgic"},
    {"text": "cold deep space ambient drift vast reverb", "vibe": {"brightness": 0.35, "tension": 0.25, "density": 0.3, "groove": 0.25}, "mood": "space"},
    {"text": "dark midnight industrial pulse aggressive bass", "vibe": {"brightness": 0.3, "tension": 0.75, "density": 0.65, "groove": 0.7}, "mood": "dark"},
    {"text": "dreamy lush pastel floating major seventh haze", "vibe": {"brightness": 0.7, "tension": 0.2, "density": 0.45, "groove": 0.4}, "mood": "dreamy"},
    {"text": "sparse minimal drone slow evolving pads", "vibe": {"brightness": 0.4, "tension": 0.35, "density": 0.2, "groove": 0.2}, "mood": "space"},
    {"text": "uptempo energetic retro chase arpeggios", "vibe": {"brightness": 0.65, "tension": 0.5, "density": 0.75, "groove": 0.8}, "mood": "nostalgic"},
]


def _token_set(s: str) -> set[str]:
    return {w for w in s.lower().replace(",", " ").split() if len(w) > 2}


def vibe_from_text(text: str) -> dict[str, Any]:
    q = _token_set(text)
    if not q:
        return {"vibe": sanitize_vibe(None), "mood": None}
    scored: list[tuple[float, dict[str, Any]]] = []
    for a in ANCHORS:
        t = _token_set(a["text"])
        overlap = len(q & t)
        if overlap == 0:
            continue
        scored.append((overlap / max(len(q), 1), a))
    if not scored:
        return {"vibe": sanitize_vibe(None), "mood": None}
    scored.sort(key=lambda x: -x[0])
    top = scored[:3]
    wsum = sum(w for w, _ in top) or 1.0
    vibe = {"brightness": 0.0, "tension": 0.0, "density": 0.0, "groove": 0.0}
    mood_votes: dict[str, float] = {}
    for w, a in top:
        v = a["vibe"]
        for k in vibe:
            vibe[k] += w * float(v[k])
        m = a.get("mood")
        if m:
            mood_votes[m] = mood_votes.get(m, 0.0) + w
    for k in vibe:
        vibe[k] = clamp01(vibe[k] / wsum)
    mood = max(mood_votes, key=mood_votes.get) if mood_votes else None
    return {"vibe": sanitize_vibe(vibe), "mood": mood}


def vibe_from_text_embeddings(text: str) -> dict[str, Any]:
    """Optional sentence-transformer path; falls back to token overlap."""
    try:
        from sentence_transformers import SentenceTransformer
        import numpy as np
    except ImportError:
        return vibe_from_text(text)

    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    try:
        model = SentenceTransformer(model_name)
    except Exception:
        return vibe_from_text(text)

    texts = [a["text"] for a in ANCHORS] + [text]
    emb = model.encode(texts, normalize_embeddings=True)
    q = emb[-1]
    sims = np.dot(emb[:-1], q)
    idx = int(np.argmax(sims))
    if float(sims[idx]) < 0.15:
        return vibe_from_text(text)
    a = ANCHORS[idx]
    return {"vibe": sanitize_vibe(a["vibe"]), "mood": a.get("mood")}
