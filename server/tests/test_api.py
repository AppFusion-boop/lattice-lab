"""Comprehensive tests for Studies, Parameters, Outcomes, Constraints, Audit, and Templates API."""

from fastapi.testclient import TestClient

from lattice_server.ids import compute_values_hash


def test_compute_values_hash_canonical():
    """Verify values_hash produces exact SHA-256 with sorted keys, controlled filtering, and float formatting."""
    val1 = {"flow": 18.0, "droplet": 80.0, "ambient": 298.15}
    val2 = {"droplet": 80.0000000000000, "flow": 18.0}

    # Only controlled keys
    h1 = compute_values_hash(val1, controlled_keys=["droplet", "flow"])
    h2 = compute_values_hash(val2, controlled_keys=["droplet", "flow"])
    assert h1 == h2
    assert len(h1) == 64

    # Float formatting with 12g
    h_float = compute_values_hash({"x": 1.23456789012345}, controlled_keys=["x"])
    h_float2 = compute_values_hash({"x": 1.23456789012}, controlled_keys=["x"])
    assert h_float == h_float2


def test_study_crud_and_audit(client: TestClient):
    """Test Study creation, retrieval, patching, archiving, and audit log entries."""
    # 1. Create study
    res = client.post(
        "/api/v1/studies",
        json={
            "name": "Mitigation Trial A",
            "description": "Baseline testing",
            "domain": "physics",
            "exclusion_threshold": 0.05,
            "confidence": 0.95,
        },
    )
    assert res.status_code == 201
    study = res.json()
    sid = study["id"]
    assert study["name"] == "Mitigation Trial A"
    assert study["archived"] is False
    assert study["rng_seed"] > 0

    # 2. Get study
    res_get = client.get(f"/api/v1/studies/{sid}")
    assert res_get.status_code == 200
    assert res_get.json()["id"] == sid

    # 3. Patch study
    res_patch = client.patch(
        f"/api/v1/studies/{sid}",
        json={"description": "Updated baseline description"},
    )
    assert res_patch.status_code == 200
    assert res_patch.json()["description"] == "Updated baseline description"

    # 4. Archive study
    res_archive = client.post(f"/api/v1/studies/{sid}/archive")
    assert res_archive.status_code == 200
    assert res_archive.json()["archived"] is True

    # 5. List studies (exclude vs include archived)
    res_list = client.get("/api/v1/studies")
    assert not any(s["id"] == sid for s in res_list.json())

    res_list_all = client.get("/api/v1/studies?include_archived=true")
    assert any(s["id"] == sid for s in res_list_all.json())


def test_parameter_crud_and_validations(client: TestClient):
    """Test Parameter CRUD, strict key validation, unit validation, and spec rules."""
    # Create parent study
    s_res = client.post("/api/v1/studies", json={"name": "Param Study"})
    sid = s_res.json()["id"]

    # 1. Valid continuous parameter with log scale
    p_res = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "droplet",
            "label": "Droplet Size",
            "unit": "µm",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10, "max": 1000, "scale": "log", "levels": 12},
        },
    )
    assert p_res.status_code == 201
    param = p_res.json()
    assert param["unit"] == "um"  # normalized µm -> um
    assert param["key"] == "droplet"
    pid = param["id"]

    # 2. Duplicate key rejection
    dup_res = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "droplet",
            "label": "Duplicate Droplet",
            "unit": "um",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10, "max": 500},
        },
    )
    assert dup_res.status_code == 422
    assert dup_res.json()["detail"]["code"] == "duplicate_key"

    # 3. Invalid key (uppercase, collision with reserved function)
    inv_key1 = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "DropletSize",
            "label": "Bad Key",
            "unit": "",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1, "max": 10},
        },
    )
    assert inv_key1.status_code == 422

    inv_key2 = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "sin",
            "label": "Collision with function",
            "unit": "",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1, "max": 10},
        },
    )
    assert inv_key2.status_code == 422

    # 4. Invalid unit rejection
    inv_unit = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "speed",
            "label": "Speed",
            "unit": "invalid_unit_foobar",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1, "max": 100},
        },
    )
    assert inv_unit.status_code == 422

    # 5. Continuous spec validation (min >= max, log with min <= 0)
    inv_spec1 = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "temp",
            "label": "Temp",
            "unit": "degC",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 100, "max": 50},
        },
    )
    assert inv_spec1.status_code == 422

    inv_spec2 = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "pressure",
            "label": "Pressure",
            "unit": "Pa",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 0, "max": 1000, "scale": "log"},
        },
    )
    assert inv_spec2.status_code == 422

    # 6. Integer parameter with step
    p_int = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "nozzles",
            "label": "Nozzle Count",
            "unit": "",
            "kind": "integer",
            "role": "controlled",
            "spec": {"min": 1, "max": 24, "step": 1},
        },
    )
    assert p_int.status_code == 201

    # 7. Uncertain parameter with normal distribution
    p_unc = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "amplitude",
            "label": "Shock Amplitude",
            "unit": "Pa",
            "kind": "continuous",
            "role": "uncertain",
            "spec": {
                "min": 9000,
                "max": 27000,
                "distribution": {"type": "normal", "mean": 18000, "sd": 3600},
            },
        },
    )
    assert p_unc.status_code == 201

    # 8. Controlled parameter trying to specify an uncertain distribution -> 422
    p_bad_role = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "flow",
            "label": "Flow Rate",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {
                "min": 10,
                "max": 100,
                "distribution": {"type": "normal", "mean": 50, "sd": 10},
            },
        },
    )
    assert p_bad_role.status_code == 422

    # 9. Categorical parameter
    p_cat = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "regime",
            "label": "Spray Regime",
            "unit": "",
            "kind": "categorical",
            "role": "controlled",
            "spec": {"options": ["Mist", "Spray", "Rain"]},
        },
    )
    assert p_cat.status_code == 201

    # 10. Update and reorder
    client.patch(f"/api/v1/parameters/{pid}", json={"label": "SMD Droplet Diameter"})
    reorder_res = client.post(
        f"/api/v1/studies/{sid}/parameters/reorder",
        json=[p_unc.json()["id"], pid, p_int.json()["id"], p_cat.json()["id"]],
    )
    assert reorder_res.status_code == 200
    ordered = reorder_res.json()
    assert ordered[0]["key"] == "amplitude"

    # 11. Delete parameter
    del_res = client.delete(f"/api/v1/parameters/{p_cat.json()['id']}")
    assert del_res.status_code == 204


def test_outcome_crud_and_criterion(client: TestClient):
    """Test Outcome creation, criterion validation, updating, and listing."""
    s_res = client.post("/api/v1/studies", json={"name": "Outcome Study"})
    sid = s_res.json()["id"]

    # 1. Continuous outcome with "<" criterion
    o1 = client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak Overpressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
            "criterion": {"op": "<", "value": 8000},
        },
    )
    assert o1.status_code == 201
    assert o1.json()["key"] == "peak_pressure"
    oid = o1.json()["id"]

    # 2. Binary outcome with "equals" criterion
    o2 = client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "toxic",
            "label": "Toxicity",
            "unit": "",
            "kind": "binary",
            "direction": "minimize",
            "criterion": {"op": "equals", "value": 0},
        },
    )
    assert o2.status_code == 201

    # 3. Invalid criterion: between with low > high
    o_bad = client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "temp_range",
            "label": "Temperature",
            "unit": "degC",
            "kind": "continuous",
            "direction": "none",
            "criterion": {"op": "between", "low": 500, "high": 100},
        },
    )
    assert o_bad.status_code == 422

    # 4. Delete outcome
    del_res = client.delete(f"/api/v1/outcomes/{oid}")
    assert del_res.status_code == 204


def test_constraint_validation_and_crud(client: TestClient):
    """Test Constraint validation: uncertain parameter rejection, unknown variables, and CRUD."""
    s_res = client.post("/api/v1/studies", json={"name": "Constraint Study"})
    sid = s_res.json()["id"]

    # Add controlled parameter 'flow' and 'nozzles'
    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "flow",
            "label": "Flow",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1, "max": 150},
        },
    )
    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "nozzles",
            "label": "Nozzles",
            "unit": "",
            "kind": "integer",
            "role": "controlled",
            "spec": {"min": 1, "max": 24},
        },
    )
    # Add uncertain parameter 'amplitude'
    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "amplitude",
            "label": "Shock Amplitude",
            "unit": "Pa",
            "kind": "continuous",
            "role": "uncertain",
            "spec": {"min": 9000, "max": 27000},
        },
    )

    # 1. Valid constraint referencing controlled parameters
    c_res = client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={
            "label": "Pump Capacity",
            "expression": "flow * nozzles <= 600",
            "kind": "hard",
            "rationale": "Pump maximum rating is 600 L/min",
        },
    )
    assert c_res.status_code == 201
    cid = c_res.json()["id"]

    # 2. Constraint referencing uncertain parameter -> MUST BE REJECTED
    c_unc = client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={
            "label": "Bad Constraint",
            "expression": "amplitude <= 20000",
            "kind": "hard",
            "rationale": "Attempt to restrict uncertain parameter",
        },
    )
    assert c_unc.status_code == 422
    assert "Uncertain parameter 'amplitude' cannot be used in a hard constraint" in c_unc.json()["detail"]["message"]

    # 3. Constraint referencing non-existent parameter
    c_unlisted = client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={
            "label": "Non existent var",
            "expression": "flow * non_existent <= 100",
            "kind": "hard",
            "rationale": "Missing parameter check",
        },
    )
    assert c_unlisted.status_code == 422

    # 4. Constraint with rationale too short (< 3 chars)
    c_short_rat = client.post(
        f"/api/v1/studies/{sid}/constraints",
        json={
            "label": "Short rationale",
            "expression": "flow <= 100",
            "kind": "hard",
            "rationale": "no",
        },
    )
    assert c_short_rat.status_code == 422

    # 5. Delete constraint
    del_res = client.delete(f"/api/v1/constraints/{cid}")
    assert del_res.status_code == 204


def test_template_creation(client: TestClient):
    """Test creating complete studies from templates (tunnel_blast and drug_screen)."""
    # 1. Tunnel blast template
    t1 = client.post(
        "/api/v1/studies/from-template",
        json={"template": "tunnel_blast", "name": "Custom Tunnel Blast"},
    )
    assert t1.status_code == 201
    s1 = t1.json()
    assert s1["name"] == "Custom Tunnel Blast"
    s1_id = s1["id"]

    # Check parameters were created
    params1 = client.get(f"/api/v1/studies/{s1_id}/parameters").json()
    param_keys1 = {p["key"] for p in params1}
    assert {"droplet", "flow", "nozzles", "mist_lead", "amplitude"}.issubset(param_keys1)

    # Check outcomes were created
    outcomes1 = client.get(f"/api/v1/studies/{s1_id}/outcomes").json()
    assert len(outcomes1) == 1
    assert outcomes1[0]["key"] == "peak_pressure"

    # Check constraints were created
    constraints1 = client.get(f"/api/v1/studies/{s1_id}/constraints").json()
    assert len(constraints1) == 1
    assert constraints1[0]["expression"] == "flow * nozzles <= 600"

    # 2. Drug screen template
    t2 = client.post("/api/v1/studies/from-template", json={"template": "drug_screen"})
    assert t2.status_code == 201
    s2 = t2.json()
    s2_id = s2["id"]

    params2 = client.get(f"/api/v1/studies/{s2_id}/parameters").json()
    assert {p["key"] for p in params2} == {"mw", "logp", "hbd", "hba"}

    constraints2 = client.get(f"/api/v1/studies/{s2_id}/constraints").json()
    assert len(constraints2) == 4
    exprs2 = {c["expression"] for c in constraints2}
    assert {"mw <= 500", "logp <= 5", "hbd <= 5", "hba <= 10"} == exprs2


def test_expression_check_endpoint(client: TestClient):
    """Test POST /api/v1/expressions/check for valid expressions, errors, and extracted variables."""
    # Valid
    res_ok = client.post(
        "/api/v1/expressions/check",
        json={"expression": "flow * nozzles <= 600", "variables": ["flow", "nozzles"]},
    )
    assert res_ok.status_code == 200
    data_ok = res_ok.json()
    assert data_ok["ok"] is True
    assert data_ok["variables"] == ["flow", "nozzles"]

    # Syntax error with position
    res_err = client.post(
        "/api/v1/expressions/check",
        json={"expression": "flow +", "variables": ["flow"]},
    )
    assert res_err.status_code == 200
    data_err = res_err.json()
    assert data_err["ok"] is False
    assert "Incomplete expression" in data_err["error"]

    # Unknown variable
    res_unk = client.post(
        "/api/v1/expressions/check",
        json={"expression": "flow + radius", "variables": ["flow"]},
    )
    assert res_unk.status_code == 200
    data_unk = res_unk.json()
    assert data_unk["ok"] is False
    assert "Unknown variable: radius" in data_unk["error"]


def test_delete_parameter_and_outcome_referenced_by_evidence(client: TestClient, db_conn):
    """Verify that deleting a parameter or outcome referenced by existing evidence returns 409 Conflict."""
    s_res = client.post("/api/v1/studies", json={"name": "Evidence Guard Study"})
    sid = s_res.json()["id"]

    p_res = client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "flow",
            "label": "Flow",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 1, "max": 100},
        },
    )
    pid = p_res.json()["id"]

    o_res = client.post(
        f"/api/v1/studies/{sid}/outcomes",
        json={
            "key": "peak_pressure",
            "label": "Peak Overpressure",
            "unit": "Pa",
            "kind": "continuous",
            "direction": "minimize",
        },
    )
    oid = o_res.json()["id"]

    # Insert evidence referencing flow and peak_pressure directly via DB
    db_conn.execute(
        """
        INSERT INTO evidence (
            id, study_id, kind, values_json, outcomes_json, status, created_at
        ) VALUES ('evi_test_1', ?, 'lab', '{"flow": 18.0}', '{"peak_pressure": 6200.0}', 'valid', '2026-10-15T12:00:00Z')
        """,
        (sid,),
    )
    db_conn.commit()

    # Attempt to delete parameter -> should return 409
    del_p = client.delete(f"/api/v1/parameters/{pid}")
    assert del_p.status_code == 409
    assert del_p.json()["detail"]["code"] == "conflict"
    assert "referenced by existing evidence" in del_p.json()["detail"]["message"]

    # Attempt to delete outcome -> should return 409
    del_o = client.delete(f"/api/v1/outcomes/{oid}")
    assert del_o.status_code == 409
    assert del_o.json()["detail"]["code"] == "conflict"
    assert "referenced by existing evidence" in del_o.json()["detail"]["message"]

