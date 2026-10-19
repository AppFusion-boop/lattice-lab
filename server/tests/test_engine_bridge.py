import json

from lattice_server import config
from lattice_server.engine import bridge


def test_engine_health():
    res = bridge.health()
    assert res.get("ok") is True, f"Engine health failed: {res}"
    assert "2.2.0" in res.get("engine_version", "")


def test_engine_evaluate_tunnel_demo():
    demo_path = config.REPO_ROOT / "public/demos/tunnel-methane-water.json"
    assert demo_path.exists(), "tunnel-methane-water.json demo must exist"
    project = json.loads(demo_path.read_text("utf-8"))

    param_bindings = [
        {"parameterKey": "reduction", "nodeId": "water", "paramKey": "reduction"}
    ]
    outcome_bindings = [
        {
            "outcomeKey": "peak_mist",
            "nodeId": "mist",
            "port": "sensor:probe",
            "reducer": "maxAbs",
        },
        {
            "outcomeKey": "peak_ref",
            "nodeId": "reference",
            "port": "sensor:probe",
            "reducer": "maxAbs",
        },
    ]

    rows = [
        {"id": "c1", "values": {"reduction": 0}},
        {"id": "c2", "values": {"reduction": 45}},
    ]

    results = bridge.evaluate(
        project,
        param_bindings,
        outcome_bindings,
        rows,
        chunk_size=1,
    )

    assert len(results) == 2
    assert results[0].id == "c1"
    assert results[0].status == "ok"
    assert results[1].id == "c2"
    assert results[1].status == "ok"

    p0_ref = results[0].outcomes["peak_ref"]
    p45_ref = results[1].outcomes["peak_ref"]
    p0_mist = results[0].outcomes["peak_mist"]
    p45_mist = results[1].outcomes["peak_mist"]

    # Reference scene has no water mist: pressures match
    assert abs(p0_ref - p45_ref) < 1e-4
    # Mist scene with 45% reduction must be lower than 0% reduction
    assert p45_mist < p0_mist


def test_engine_evaluate_cancellation():
    demo_path = config.REPO_ROOT / "public/demos/tunnel-methane-water.json"
    project = json.loads(demo_path.read_text("utf-8"))

    param_bindings = [
        {"parameterKey": "reduction", "nodeId": "water", "paramKey": "reduction"}
    ]
    outcome_bindings = [
        {
            "outcomeKey": "peak_mist",
            "nodeId": "mist",
            "port": "sensor:probe",
            "reducer": "maxAbs",
        }
    ]

    rows = [{"id": f"row_{i}", "values": {"reduction": 20}} for i in range(5)]

    # Cancel immediately
    results = bridge.evaluate(
        project,
        param_bindings,
        outcome_bindings,
        rows,
        cancelled=lambda: True,
    )
    assert len(results) == 5
    assert all(r.status == "error" for r in results)
    assert any("Cancelled" in (r.message or "") for r in results)

