from engines.markov_engine import MarkovEngine


def test_deterministic_same_seed():
    a = MarkovEngine()
    b = MarkovEngine()
    params = {"mood": "nostalgic", "energy": 0.5, "complexity": 0.5, "variation": 0.5, "tempo": None, "seed": 42}
    a.init(42, params)
    b.init(42, params)
    ba = a.render_bars(0, 4, params)
    bb = b.render_bars(0, 4, params)
    assert ba == bb


def test_batch_shape_and_note_range():
    eng = MarkovEngine()
    params = {"mood": "dreamy", "energy": 0.6, "complexity": 0.4, "variation": 0.3, "tempo": 90, "seed": 99}
    eng.init(99, params)
    batch = eng.render_bars(8, 2, params)
    assert batch["startBeat"] == 32
    assert batch["endBeat"] == 40
    assert batch["tempo"] == 90
    for ev in batch["events"]:
        assert batch["startBeat"] <= ev["beat"] < batch["endBeat"]
        if ev["kind"] == "note":
            assert 0 <= ev["midi"] <= 127
            assert 0 <= ev["vel"] <= 1
