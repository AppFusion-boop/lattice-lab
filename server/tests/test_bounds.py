from lattice_server.stats.bounds import clopper_pearson_lower, clopper_pearson_upper


def test_clopper_pearson_reference_values():
    delta = 0.05
    # Reference values (§4.4):
    p_58 = clopper_pearson_upper(k=0, n=58, delta=delta)
    p_59 = clopper_pearson_upper(k=0, n=59, delta=delta)

    assert p_58 > 0.05, f"n=58 expected > 0.05, got {p_58}"
    assert p_59 < 0.05, f"n=59 expected < 0.05, got {p_59}"
    assert round(p_58, 4) == 0.0503
    assert round(p_59, 4) == 0.0495


def test_bounds_boundaries():
    assert clopper_pearson_upper(0, 0) == 1.0
    assert clopper_pearson_upper(10, 10) == 1.0
    assert clopper_pearson_lower(0, 10) == 0.0
    assert clopper_pearson_lower(10, 10) > 0.5

