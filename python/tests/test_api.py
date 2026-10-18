import json
from pathlib import Path

import jsonschema
import pytest
from fastapi.testclient import TestClient
from server.app import create_app

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "shared" / "schemas" / "events.schema.json"
EVENT_SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("GF_TOKEN", "test-token-fixed")
    app = create_app()
    return TestClient(app)


def auth():
    return {"Authorization": "Bearer test-token-fixed"}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_generate_requires_auth(client):
    r = client.post("/generate", json={})
    assert r.status_code == 401


def test_generate_and_schema(client):
    body = {
        "engineId": "py-markov",
        "seed": 1,
        "fromBar": 0,
        "bars": 2,
        "params": {
            "mood": "dark",
            "energy": 0.5,
            "complexity": 0.5,
            "variation": 0.5,
            "tempo": None,
            "seed": 1,
        },
    }
    r = client.post("/generate", json=body, headers=auth())
    assert r.status_code == 200
    batch = r.json()
    jsonschema.validate(batch, EVENT_SCHEMA)


def test_generate_bar_limit(client):
    body = {
        "engineId": "py-markov",
        "seed": 1,
        "fromBar": 0,
        "bars": 32,
        "params": {
            "mood": "dark",
            "energy": 0.5,
            "complexity": 0.5,
            "variation": 0.5,
            "tempo": None,
            "seed": 1,
        },
    }
    r = client.post("/generate", json=body, headers=auth())
    assert r.status_code == 422


def test_ws_round_trip(client):
    params = {
        "mood": "space",
        "energy": 0.5,
        "complexity": 0.5,
        "variation": 0.5,
        "tempo": None,
        "seed": 7,
    }
    with client.websocket_connect("/ws", headers={"Origin": "http://localhost:5173"}) as ws:
        ws.send_json(
            {
                "type": "hello",
                "protocol": 2,
                "token": "test-token-fixed",
                "engineId": "py-markov",
                "seed": 7,
                "params": params,
            }
        )
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        ws.send_json({"type": "render", "epoch": 1, "fromBar": 0, "count": 1, "params": params})
        msg = ws.receive_json()
        assert msg["type"] == "batch"
        jsonschema.validate(msg["batch"], EVENT_SCHEMA)


def test_ws_bad_token(client):
    with client.websocket_connect("/ws", headers={"Origin": "http://localhost:5173"}) as ws:
        ws.send_json(
            {
                "type": "hello",
                "protocol": 2,
                "token": "wrong",
                "engineId": "py-markov",
                "seed": 1,
                "params": {
                    "mood": "space",
                    "energy": 0.5,
                    "complexity": 0.5,
                    "variation": 0.5,
                    "tempo": None,
                    "seed": 1,
                },
            }
        )
        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "auth_failed"
