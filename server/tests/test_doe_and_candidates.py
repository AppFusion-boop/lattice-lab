"""Tests for Design of Experiments (DoE) and Candidate Generation (Grid, LHS, Sobol)."""


import numpy as np
import pytest
from fastapi.testclient import TestClient

from lattice_server.schemas import ParameterResponse
from lattice_server.stats import doe
from lattice_server.stats.doe import TooManyCandidatesError


def make_param(
    key: str,
    kind: str,
    role: str = "controlled",
    spec: dict | None = None,
    position: int = 1,
) -> ParameterResponse:
    return ParameterResponse(
        id=f"p_{key}",
        study_id="std_test",
        key=key,
        label=key.capitalize(),
        unit="",
        kind=kind,
        role=role,
        spec=spec or {},
        position=position,
    )


def test_grid_count_and_log_spacing():
    """Verify grid generation count matches product of levels and respects log scale."""
    p_log = make_param("droplet", "continuous", spec={"min": 10, "max": 1000, "scale": "log", "levels": 4})
    p_lin = make_param("flow", "continuous", spec={"min": 10, "max": 30, "scale": "linear", "levels": 3})
    p_int = make_param("nozzles", "integer", spec={"min": 1, "max": 3, "step": 1})
    p_fixed = make_param("fixed_param", "continuous", role="fixed", spec={"min": 0, "max": 10, "value": 5})

    # Only controlled parameters span the space (3 controlled: 4 * 3 * 3 = 36 candidates)
    cands = doe.grid([p_log, p_lin, p_int, p_fixed])
    assert len(cands) == 36

    # Verify fixed_param is NOT in candidate values
    assert "fixed_param" not in cands[0]

    # Verify log spacing of droplet: 10, 100, 1000 (roughly 10, 46.4, 215.4, 1000)
    droplets = sorted({c["droplet"] for c in cands})
    assert len(droplets) == 4
    assert abs(droplets[0] - 10.0) < 1e-6
    assert abs(droplets[-1] - 1000.0) < 1e-6
    # In log scale, ratio between consecutive points is constant
    ratios = [droplets[i + 1] / droplets[i] for i in range(3)]
    assert np.allclose(ratios, ratios[0], rtol=1e-5)


def test_grid_limit_cap_enforced():
    """Verify grid generation refuses product > 250,000."""
    p1 = make_param("x", "continuous", spec={"min": 0, "max": 1, "levels": 600})
    p2 = make_param("y", "continuous", spec={"min": 0, "max": 1, "levels": 500})
    # 600 * 500 = 300,000 > 250,000
    with pytest.raises(TooManyCandidatesError, match="exceeding the limit of 250,000"):
        doe.grid([p1, p2])


def test_lhs_stratification_and_seed_reproducibility():
    """Verify LHS stratification property and seed reproducibility."""
    p1 = make_param("x", "continuous", spec={"min": 0, "max": 100, "scale": "linear"})
    p2 = make_param("y", "continuous", spec={"min": 1, "max": 10, "scale": "linear"})
    n = 100

    cands1 = doe.lhs([p1, p2], n=n, seed=123)
    cands2 = doe.lhs([p1, p2], n=n, seed=123)
    cands3 = doe.lhs([p1, p2], n=n, seed=456)

    # Identical with same seed
    assert len(cands1) == n
    assert cands1 == cands2
    assert cands1 != cands3

    # Stratification check on [0, 100]: each interval [i, i+1] of width 100/n should contain exactly one point
    x_vals = sorted(c["x"] for c in cands1)
    for i in range(n):
        low = (i / n) * 100
        high = ((i + 1) / n) * 100
        # Exactly one value in [low, high]
        in_stratum = [v for v in x_vals if low <= v <= high]
        assert len(in_stratum) == 1


def test_sobol_power_of_two_and_reproducibility():
    """Verify Sobol sequence rounds count up to a power of 2 and is reproducible."""
    p1 = make_param("x", "continuous", spec={"min": 10, "max": 20})
    p2 = make_param("cat", "categorical", spec={"options": ["A", "B", "C"]})

    # Request 500 -> should round up to 512
    cands = doe.sobol([p1, p2], n=500, seed=42)
    assert len(cands) == 512

    cands_same = doe.sobol([p1, p2], n=500, seed=42)
    assert cands == cands_same

    # Categorical options are all represented
    cats = {c["cat"] for c in cands}
    assert cats == {"A", "B", "C"}


def test_candidate_generation_api(client: TestClient):
    """Test full candidate set generation via API, pagination, and active set switching."""
    # Create study
    s_res = client.post("/api/v1/studies", json={"name": "DoE Study"})
    sid = s_res.json()["id"]

    # Add 2 controlled parameters
    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "flow",
            "label": "Flow",
            "unit": "L/min",
            "kind": "continuous",
            "role": "controlled",
            "spec": {"min": 10, "max": 50, "levels": 5},
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
            "spec": {"min": 1, "max": 4, "step": 1},
        },
    )
    # Add uncertain parameter (must not be part of candidates)
    client.post(
        f"/api/v1/studies/{sid}/parameters",
        json={
            "key": "blast_temp",
            "label": "Temp",
            "unit": "degC",
            "kind": "continuous",
            "role": "uncertain",
            "spec": {"min": 300, "max": 1200},
        },
    )

    # 1. Generate Grid candidate set: 5 * 4 = 20 candidates
    grid_res = client.post(
        f"/api/v1/studies/{sid}/candidate-sets",
        json={"method": "grid"},
    )
    assert grid_res.status_code == 201
    set1 = grid_res.json()
    assert set1["count"] == 20
    assert set1["active"] is True
    set1_id = set1["id"]

    # 2. Check active candidate set
    act_res = client.get(f"/api/v1/studies/{sid}/candidate-sets/active")
    assert act_res.status_code == 200
    assert act_res.json()["id"] == set1_id

    # 3. Query candidates paginated
    c_page1 = client.get(f"/api/v1/studies/{sid}/candidates?limit=10&offset=0")
    assert c_page1.status_code == 200
    p1_data = c_page1.json()
    assert p1_data["total"] == 20
    assert len(p1_data["items"]) == 10
    assert "blast_temp" not in p1_data["items"][0]["values"]
    assert "flow" in p1_data["items"][0]["values"]
    assert len(p1_data["items"][0]["values_hash"]) == 64

    # Page 2
    c_page2 = client.get(f"/api/v1/studies/{sid}/candidates?limit=10&offset=10")
    p2_data = c_page2.json()
    assert len(p2_data["items"]) == 10
    assert p2_data["items"][0]["idx"] == 10

    # 4. Generate LHS candidate set with n=50
    lhs_res = client.post(
        f"/api/v1/studies/{sid}/candidate-sets",
        json={"method": "lhs", "settings": {"n": 50, "seed": 99}},
    )
    assert lhs_res.status_code == 201
    set2 = lhs_res.json()
    assert set2["count"] == 50
    assert set2["active"] is True
    set2_id = set2["id"]

    # Old set is now inactive
    set1_refetched = client.get(f"/api/v1/studies/{sid}/candidate-sets").json()
    s1_row = next(s for s in set1_refetched if s["id"] == set1_id)
    assert s1_row["active"] is False

    # Active set is now set2
    act2 = client.get(f"/api/v1/studies/{sid}/candidate-sets/active").json()
    assert act2["id"] == set2_id

    # 5. Sobol candidate set
    sobol_res = client.post(
        f"/api/v1/studies/{sid}/candidate-sets",
        json={"method": "sobol", "settings": {"n": 30, "seed": 42}},
    )
    assert sobol_res.status_code == 201
    assert sobol_res.json()["count"] == 32  # rounded up to 32
