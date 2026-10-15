"""ID generation and canonical hashing utilities."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from collections.abc import Set as AbstractSet
from typing import Any


def new_id(prefix: str = "") -> str:
    """Generate a unique random identifier, optionally with a prefix."""
    raw = uuid.uuid4().hex
    if prefix:
        return f"{prefix}_{raw[:20]}"
    return raw


def _canonicalize_value(val: Any) -> Any:
    """Format float values with repr(float(f'{v:.12g}'))."""
    if isinstance(val, bool):
        return val
    if isinstance(val, float):
        # Format with at most 12 significant digits
        formatted = float(f"{val:.12g}")
        return formatted
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        return val
    if isinstance(val, (list, tuple)):
        return [_canonicalize_value(item) for item in val]
    if isinstance(val, dict):
        return {k: _canonicalize_value(v) for k, v in sorted(val.items())}
    return val


def compute_values_hash(
    values: dict[str, Any],
    controlled_keys: Sequence[str] | AbstractSet[str] | None = None,
) -> str:
    """Compute canonical values_hash.

    Contract (§5):
    SHA-256 of JSON with keys sorted, only controlled parameters,
    floats formatted with repr(float(f"{v:.12g}")), no whitespace.
    """
    if controlled_keys is not None:
        target_keys = [k for k in sorted(controlled_keys) if k in values]
    else:
        target_keys = sorted(values.keys())

    canonical_dict = {k: _canonicalize_value(values[k]) for k in target_keys}
    json_bytes = json.dumps(canonical_dict, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(json_bytes).hexdigest()
