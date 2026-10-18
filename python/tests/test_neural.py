import json
from pathlib import Path

import jsonschema
import pytest

from engines.neural.features import pitch_in_register
from engines.neural.full_engine import create_full
from engines.neural.layers_engine import create_layers
from engines.neural.sampler import allowed_pitches, clamp_note
from engines.neural.skeleton_model import plan_bars
from engines.neural.text_vibe import vibe_from_text
from engines.theory import key_for

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "shared" / "schemas" / "events.schema.json"
EVENT_SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_vibe_from_text_in_range():
    r = vibe_from_text("cold deep space ambient")
    v = r["vibe"]
    for k in ("brightness", "tension", "density", "groove"):
        assert 0 <= v[k] <= 1


def test_sampler_respects_register():
    key = key_for(1, "dark")
    chord = {"root": 45, "intervals": [0, 3, 7]}
    for midi in range(20, 100):
        out = clamp_note("bass", midi, key, chord, 0.3)
        if out is not None:
            assert pitch_in_register("bass", out)


def test_layers_engine_requires_context():
    eng = create_layers()
    eng.init(1, {"mood": "dark", "energy": 0.5, "complexity": 0.5, "variation": 0.5, "tempo": None, "seed": 1})
    with pytest.raises(ValueError):
        eng.render_bars(0, 1, {"mood": "dark", "energy": 0.5, "complexity": 0.5, "variation": 0.5, "tempo": None, "seed": 1})


def test_neural_engines_emit_schema_valid_batches():
    params = {
        "mood": "nostalgic",
        "energy": 0.55,
        "complexity": 0.5,
        "variation": 0.5,
        "tempo": None,
        "seed": 99,
        "vibe": {"brightness": 0.5, "tension": 0.4, "density": 0.5, "groove": 0.5},
    }
    ctx = plan_bars(0, 2, params, 99)
    layers = create_layers()
    layers.init(99, params)
    batch_l = layers.render_bars(0, 2, params, context=ctx)
    jsonschema.validate(batch_l, EVENT_SCHEMA)

    full = create_full()
    full.init(99, params)
    batch_f = full.render_bars(0, 4, params)
    jsonschema.validate(batch_f, EVENT_SCHEMA)


def test_allowed_pitches_in_scale():
    key = key_for(5, "dreamy")
    chord = {"root": 48, "intervals": [0, 4, 7]}
    allowed = allowed_pitches("lead", key, chord, 0.2)
    pcs = {m % 12 for m in allowed}
    assert len(pcs) > 0
