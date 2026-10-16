"""Pydantic schemas and validation for studies, parameters, outcomes, and constraints."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from lattice_server.expr import FORMULA_FUNCTIONS
from lattice_server.units import validate_unit

PARAM_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
RESERVED_IDENTIFIERS = set(FORMULA_FUNCTIONS) | {"pi", "e"}


class ApiErrorDetail(BaseModel):
    code: str
    message: str
    field: str | None = None


class ApiErrorResponse(BaseModel):
    detail: ApiErrorDetail


# --- Distribution Specs (§4.2) ---


class DistributionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["uniform", "normal", "lognormal", "triangular", "discrete"]
    mean: float | None = None
    sd: float | None = None
    median: float | None = None
    gsd: float | None = None
    mode: float | None = None
    values: list[Any] | None = None
    weights: list[float] | None = None

    @model_validator(mode="after")
    def check_distribution_params(self) -> DistributionSpec:
        t = self.type
        if t == "normal":
            if self.mean is None or self.sd is None:
                raise ValueError("Normal distribution requires 'mean' and 'sd'")
            if self.sd <= 0:
                raise ValueError("Normal distribution 'sd' must be > 0")
        elif t == "lognormal":
            if self.median is None or self.gsd is None:
                raise ValueError("Lognormal distribution requires 'median' and 'gsd'")
            if self.median <= 0:
                raise ValueError("Lognormal distribution 'median' must be > 0")
            if self.gsd <= 1:
                raise ValueError("Lognormal distribution 'gsd' must be > 1")
        elif t == "triangular":
            if self.mode is None:
                raise ValueError("Triangular distribution requires 'mode'")
        elif t == "discrete":
            if not self.values:
                raise ValueError("Discrete distribution requires non-empty 'values'")
            if self.weights is not None:
                if len(self.weights) != len(self.values):
                    raise ValueError("Discrete distribution 'weights' length must match 'values'")
                if any(w < 0 for w in self.weights) or sum(self.weights) <= 0:
                    raise ValueError("Discrete distribution weights must be non-negative and sum > 0")
        return self


# --- Parameter Specs (§4.2) ---


class ContinuousSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: float
    max: float
    scale: Literal["linear", "log"] = "linear"
    levels: int | None = None
    values: list[float] | None = None
    distribution: DistributionSpec | None = None
    value: float | None = None

    @model_validator(mode="after")
    def validate_spec(self) -> ContinuousSpec:
        if self.min >= self.max:
            raise ValueError(f"Continuous parameter min ({self.min}) must be strictly less than max ({self.max})")
        if self.scale == "log" and self.min <= 0:
            raise ValueError("Log scale continuous parameter requires min > 0")
        if self.levels is not None and self.levels < 2:
            raise ValueError("levels must be >= 2")
        if self.values is not None:
            if len(self.values) < 2:
                raise ValueError("Explicit values list must contain at least 2 points")
            if self.values != sorted(set(self.values)):
                raise ValueError("Explicit values must be strictly sorted and unique")
            for v in self.values:
                if v < self.min or v > self.max:
                    raise ValueError(f"Value {v} is outside range [{self.min}, {self.max}]")
        if self.value is not None and (self.value < self.min or self.value > self.max):
            raise ValueError(f"Fixed value {self.value} is outside range [{self.min}, {self.max}]")
        if (
            self.distribution is not None
            and self.distribution.type == "triangular"
            and self.distribution.mode is not None
            and (self.distribution.mode < self.min or self.distribution.mode > self.max)
        ):
            raise ValueError(
                f"Triangular mode {self.distribution.mode} is outside range [{self.min}, {self.max}]"
            )
        return self


class IntegerSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: int
    max: int
    step: int = 1
    levels: int | None = None
    values: list[int] | None = None
    distribution: DistributionSpec | None = None
    value: int | None = None

    @model_validator(mode="after")
    def validate_spec(self) -> IntegerSpec:
        if self.min >= self.max:
            raise ValueError(f"Integer parameter min ({self.min}) must be strictly less than max ({self.max})")
        if self.step < 1:
            raise ValueError("Integer step must be >= 1")
        if self.levels is not None and self.levels < 2:
            raise ValueError("levels must be >= 2")
        if self.values is not None:
            if len(self.values) < 2:
                raise ValueError("Explicit values list must contain at least 2 points")
            if self.values != sorted(set(self.values)):
                raise ValueError("Explicit values must be strictly sorted and unique")
            for v in self.values:
                if v < self.min or v > self.max:
                    raise ValueError(f"Value {v} is outside range [{self.min}, {self.max}]")
        if self.value is not None and (self.value < self.min or self.value > self.max):
            raise ValueError(f"Fixed value {self.value} is outside range [{self.min}, {self.max}]")
        return self


class CategoricalSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    options: list[str]
    weights: list[float] | None = None
    distribution: DistributionSpec | None = None
    value: str | None = None

    @model_validator(mode="after")
    def validate_spec(self) -> CategoricalSpec:
        if not (1 <= len(self.options) <= 50):
            raise ValueError("Categorical options must contain between 1 and 50 options")
        if len(self.options) != len(set(self.options)):
            raise ValueError("Categorical options must be unique")
        for opt in self.options:
            if not opt or not opt.strip():
                raise ValueError("Categorical option strings cannot be blank")
        if self.value is not None and self.value not in self.options:
            raise ValueError(f"Fixed value '{self.value}' must be one of {self.options}")
        if self.weights is not None:
            if len(self.weights) != len(self.options):
                raise ValueError("Weights length must match options length")
            if any(w < 0 for w in self.weights) or sum(self.weights) <= 0:
                raise ValueError("Categorical weights must be non-negative and sum > 0")
        return self


# --- Parameter Model ---


def validate_param_key(v: str) -> str:
    if not PARAM_KEY_RE.match(v):
        raise ValueError(
            f"Parameter key '{v}' is invalid. Must match regex ^[a-z][a-z0-9_]{{0,39}}$ (lowercase letters, numbers, underscores, starting with a letter)"
        )
    if v in RESERVED_IDENTIFIERS:
        raise ValueError(f"Parameter key '{v}' collides with reserved identifier or built-in function")
    return v


def validate_unit_str(v: str) -> str:
    return validate_unit(v)


class ParameterCreate(BaseModel):
    key: str
    label: str = Field(min_length=1, max_length=100)
    unit: str = ""
    kind: Literal["continuous", "integer", "categorical"]
    role: Literal["controlled", "uncertain", "fixed"]
    spec: dict[str, Any]

    @field_validator("key")
    @classmethod
    def check_key(cls, v: str) -> str:
        return validate_param_key(v)

    @field_validator("unit")
    @classmethod
    def check_unit(cls, v: str) -> str:
        return validate_unit_str(v)

    @model_validator(mode="after")
    def check_role_and_spec(self) -> ParameterCreate:
        k = self.kind
        r = self.role
        s = self.spec

        # Validate spec schema
        if k == "continuous":
            parsed_spec = ContinuousSpec.model_validate(s)
            if r == "fixed" and parsed_spec.value is None:
                raise ValueError("Fixed continuous parameter requires 'value' in spec")
            if r == "uncertain" and parsed_spec.distribution is None:
                # Default to uniform if omitted
                pass
            if r == "controlled" and parsed_spec.distribution is not None:
                raise ValueError("Controlled parameter cannot define an uncertain distribution")
        elif k == "integer":
            parsed_spec_int = IntegerSpec.model_validate(s)
            if r == "fixed" and parsed_spec_int.value is None:
                raise ValueError("Fixed integer parameter requires 'value' in spec")
            if r == "controlled" and parsed_spec_int.distribution is not None:
                raise ValueError("Controlled parameter cannot define an uncertain distribution")
        elif k == "categorical":
            parsed_spec_cat = CategoricalSpec.model_validate(s)
            if r == "fixed" and parsed_spec_cat.value is None:
                raise ValueError("Fixed categorical parameter requires 'value' in spec")
            if r == "controlled" and parsed_spec_cat.distribution is not None:
                raise ValueError("Controlled parameter cannot define an uncertain distribution")
        return self


class ParameterUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    unit: str | None = None
    role: Literal["controlled", "uncertain", "fixed"] | None = None
    spec: dict[str, Any] | None = None

    @field_validator("unit")
    @classmethod
    def check_unit(cls, v: str | None) -> str | None:
        if v is not None:
            return validate_unit_str(v)
        return None


class ParameterResponse(BaseModel):
    id: str
    study_id: str
    key: str
    label: str
    unit: str
    kind: Literal["continuous", "integer", "categorical"]
    role: Literal["controlled", "uncertain", "fixed"]
    spec: dict[str, Any]
    position: int


# --- Outcome Models (§4.3) ---


class OutcomeCriterion(BaseModel):
    op: Literal["<", "<=", ">", ">=", "between", "equals"]
    value: float | None = None
    low: float | None = None
    high: float | None = None

    @model_validator(mode="after")
    def validate_criterion(self) -> OutcomeCriterion:
        op = self.op
        if op in ("<", "<=", ">", ">="):
            if self.value is None:
                raise ValueError(f"Criterion '{op}' requires 'value'")
        elif op == "between":
            if self.low is None or self.high is None:
                raise ValueError("Criterion 'between' requires 'low' and 'high'")
            if self.low > self.high:
                raise ValueError(f"Criterion 'between' low ({self.low}) cannot exceed high ({self.high})")
        elif op == "equals" and self.value is None:
            raise ValueError("Criterion 'equals' requires 'value'")
        return self


class OutcomeCreate(BaseModel):
    key: str
    label: str = Field(min_length=1, max_length=100)
    unit: str = ""
    kind: Literal["continuous", "binary"]
    direction: Literal["minimize", "maximize", "none"] = "none"
    criterion: OutcomeCriterion | None = None

    @field_validator("key")
    @classmethod
    def check_key(cls, v: str) -> str:
        return validate_param_key(v)

    @field_validator("unit")
    @classmethod
    def check_unit(cls, v: str) -> str:
        return validate_unit_str(v)


class OutcomeUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    unit: str | None = None
    direction: Literal["minimize", "maximize", "none"] | None = None
    criterion: OutcomeCriterion | None = None

    @field_validator("unit")
    @classmethod
    def check_unit(cls, v: str | None) -> str | None:
        if v is not None:
            return validate_unit_str(v)
        return None


class OutcomeResponse(BaseModel):
    id: str
    study_id: str
    key: str
    label: str
    unit: str
    kind: Literal["continuous", "binary"]
    direction: Literal["minimize", "maximize", "none"]
    criterion: OutcomeCriterion | None
    position: int


# --- Constraint Models (§4.1) ---


class ConstraintCreate(BaseModel):
    label: str = Field(default="", max_length=150)
    expression: str = Field(min_length=1, max_length=500)
    kind: Literal["hard", "soft"]
    penalty: float | None = None
    rationale: str = Field(min_length=3, max_length=1000)
    source_id: str | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def validate_constraint(self) -> ConstraintCreate:
        if not self.label.strip():
            self.label = self.expression[:150]
        if self.kind == "soft" and self.penalty is None:
            self.penalty = 1.0
        return self


class ConstraintUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=150)
    expression: str | None = Field(default=None, min_length=1, max_length=500)
    kind: Literal["hard", "soft"] | None = None
    penalty: float | None = None
    rationale: str | None = Field(default=None, min_length=3, max_length=1000)
    source_id: str | None = None
    enabled: bool | None = None


class ConstraintResponse(BaseModel):
    id: str
    study_id: str
    label: str
    expression: str
    kind: Literal["hard", "soft"]
    penalty: float | None
    rationale: str
    source_id: str | None
    enabled: bool
    position: int


# --- Study Models (§4.1) ---


class StudyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    domain: str = Field(default="generic", max_length=50)
    exclusion_threshold: float = Field(default=0.05, gt=0, lt=1)
    confidence: float = Field(default=0.95, ge=0.5, lt=1)
    cost_expression: str | None = Field(default=None, max_length=500)
    budget: float | None = Field(default=None, gt=0)
    max_engine_evaluations: int = Field(default=50000, gt=0, le=1_000_000)
    settings: dict[str, Any] = Field(default_factory=dict)
    rng_seed: int | None = None


class StudyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    domain: str | None = Field(default=None, max_length=50)
    exclusion_threshold: float | None = Field(default=None, gt=0, lt=1)
    confidence: float | None = Field(default=None, ge=0.5, lt=1)
    cost_expression: str | None = Field(default=None, max_length=500)
    budget: float | None = Field(default=None, gt=0)
    max_engine_evaluations: int | None = Field(default=None, gt=0, le=1_000_000)
    settings: dict[str, Any] | None = None


class StudyResponse(BaseModel):
    id: str
    name: str
    description: str
    domain: str
    exclusion_threshold: float
    confidence: float
    cost_expression: str | None
    budget: float | None
    max_engine_evaluations: int
    settings: dict[str, Any]
    rng_seed: int
    archived: bool
    created_at: str
    updated_at: str


# --- Expression Check Models (§6) ---


class ExpressionCheckRequest(BaseModel):
    expression: str
    variables: list[str] = Field(default_factory=list)


class ExpressionCheckResponse(BaseModel):
    ok: bool
    error: str | None = None
    position: int | None = None
    variables: list[str] = Field(default_factory=list)


# --- Template Creation (§6) ---


class TemplateCreateRequest(BaseModel):
    template: Literal["tunnel_blast", "drug_screen", "microchannel_cold_plate"]
    name: str | None = None


# --- Candidate Set & Candidate Models (§4.1) ---


class CandidateSetGenerateRequest(BaseModel):
    method: Literal["grid", "lhs", "sobol"]
    settings: dict[str, Any] = Field(default_factory=dict)


class CandidateSetResponse(BaseModel):
    id: str
    study_id: str
    method: Literal["grid", "lhs", "sobol", "imported"]
    settings: dict[str, Any]
    parameters_hash: str
    count: int
    active: bool
    created_at: str


class DecisionSummary(BaseModel):
    status: Literal["open", "excluded", "deprioritised", "recommended", "tested_pass", "tested_fail"]
    filter: str
    p_hat: float | None = None
    p_upper: float | None = None
    reason: str


class CandidateResponse(BaseModel):
    id: str
    candidate_set_id: str
    idx: int
    label: str | None
    values: dict[str, Any]
    values_hash: str
    decision: DecisionSummary | None = None


class PaginatedCandidatesResponse(BaseModel):
    items: list[CandidateResponse]
    total: int
    offset: int
    limit: int


class CandidateImportResponse(BaseModel):
    candidate_set: CandidateSetResponse
    imported_count: int
    skipped_count: int
    errors: list[dict[str, Any]] = Field(default_factory=list)


# --- Job Models (§4.1) ---


class JobResponse(BaseModel):
    id: str
    study_id: str | None
    kind: str
    status: Literal["queued", "running", "done", "failed", "cancelled"]
    progress: float
    message: str
    input: Any
    result: Any | None = None
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None


# --- Override Models (§4.5, §6) ---


class OverrideCreate(BaseModel):
    values_hash: str | None = None
    candidate_id: str | None = None
    status: Literal["open", "excluded", "deprioritised", "recommended"]
    reason: str = Field(min_length=3)


class OverrideResponse(BaseModel):
    id: str
    study_id: str
    values_hash: str
    status: Literal["open", "excluded", "deprioritised", "recommended"]
    reason: str
    created_by: str
    created_at: str
    revoked_at: str | None = None


# --- Screening Models (§4.5, §6) ---


class ScreeningRunRequest(BaseModel):
    settings: dict[str, Any] = Field(default_factory=dict)


class ScreeningFunnel(BaseModel):
    total: int
    after_constraints: int
    after_statistical: int
    after_deprioritised: int
    recommended: int


class ScreeningSummary(BaseModel):
    total_candidates: int
    funnel: ScreeningFunnel
    counts_by_status: dict[str, int]
    counts_by_filter: dict[str, int]
    expected_false_exclusions_bound: float = 0.0


class ScreeningRunResponse(BaseModel):
    id: str
    study_id: str
    candidate_set_id: str
    model_version_id: str | None = None
    evidence_fingerprint: str
    settings: dict[str, Any]
    summary: ScreeningSummary
    job_id: str | None = None
    created_at: str


# --- Source and Evidence Models (Phase 2, §4.1, §6) ---


class SourceCreate(BaseModel):
    kind: Literal["field", "lab", "literature", "simulation", "expert", "import"]
    citation: str = ""
    doi: str | None = None
    url: str | None = None
    file_name: str | None = None
    file_sha256: str | None = None
    notes: str = ""


class SourceResponse(BaseModel):
    id: str
    study_id: str
    kind: Literal["field", "lab", "literature", "simulation", "expert", "import"]
    citation: str
    doi: str | None = None
    url: str | None = None
    file_name: str | None = None
    file_sha256: str | None = None
    notes: str
    created_at: str


class EvidenceCreate(BaseModel):
    kind: Literal["field", "lab", "literature", "simulation", "expert"]
    source_id: str | None = None
    values: dict[str, Any]
    outcomes: dict[str, Any]
    status: Literal["valid", "failed_run", "outlier"] = "valid"
    status_reason: str | None = None
    candidate_id: str | None = None
    run_sheet_id: str | None = None
    replicate: int | None = None
    recorded_at: str | None = None
    recorded_by: str = "local-user"
    notes: str = ""

    @model_validator(mode="after")
    def validate_status_reason(self) -> EvidenceCreate:
        if self.status != "valid" and not self.status_reason:
            raise ValueError("status_reason is required when status is not 'valid'")
        return self


class EvidenceRetractRequest(BaseModel):
    reason: str = Field(min_length=3)


class EvidenceResponse(BaseModel):
    id: str
    study_id: str
    kind: Literal["field", "lab", "literature", "simulation", "expert"]
    source_id: str | None = None
    values: dict[str, Any]
    outcomes: dict[str, Any]
    status: Literal["valid", "failed_run", "outlier"]
    status_reason: str | None = None
    candidate_id: str | None = None
    run_sheet_id: str | None = None
    replicate: int | None = None
    supersedes_id: str | None = None
    recorded_at: str | None = None
    recorded_by: str
    notes: str
    retracted_at: str | None = None
    retraction_reason: str | None = None
    created_at: str


# --- Tabular Import Models (Phase 2, P2-3, §6) ---


class ImportPreviewResponse(BaseModel):
    import_token: str
    filename: str
    columns: list[str]
    column_units: dict[str, str]
    sample_rows: list[list[Any]]
    total_rows: int
    guessed_mapping: dict[str, str]


class ImportCommitRequest(BaseModel):
    import_token: str
    mapping: dict[str, str]
    kind: Literal["field", "lab", "literature", "simulation", "expert"] = "lab"
    source_id: str | None = None
    default_status: Literal["valid", "failed_run", "outlier"] = "valid"
    skip_invalid: bool = False


class ImportCommitResponse(BaseModel):
    imported_count: int
    skipped_count: int
    errors: list[dict[str, Any]] = Field(default_factory=list)


# --- Run Sheet Models (Phase 2, P2-4, §6) ---


class RunSheetCreate(BaseModel):
    screening_run_id: str | None = None
    candidate_status: Literal["recommended", "open"] = "recommended"
    replicates: int = Field(default=3, ge=1, le=20)
    seed: int | None = None


class RunSheetResponse(BaseModel):
    id: str
    study_id: str
    screening_run_id: str | None
    seed: int
    count: int
    created_at: str


class RunSheetImportResponse(BaseModel):
    imported_count: int
    skipped_count: int
    errors: list[dict[str, Any]] = Field(default_factory=list)


# --- Audit & Backup Models (Phase 2, P2-5, §6) ---


class AuditEntryResponse(BaseModel):
    id: int
    study_id: str | None
    at: str
    actor: str
    action: str
    entity: str
    entity_id: str | None
    details: dict[str, Any]


class AuditLogResponse(BaseModel):
    items: list[AuditEntryResponse]
    total: int
    offset: int
    limit: int


class BackupResponse(BaseModel):
    filename: str
    created_at: str
    size_bytes: int


# --- Model Version Models (Phase 3, P3-4, §6) ---


class ParameterBindingModel(BaseModel):
    parameter_key: str
    node_id: str | None = None
    param_key: str | None = None
    not_in_model: bool = False


class OutcomeBindingModel(BaseModel):
    outcome_key: str
    node_id: str
    port: str
    reducer: Literal[
        "value",
        "max",
        "min",
        "maxAbs",
        "mean",
        "rms",
        "final",
        "crossed",
        "timeAbove",
    ]
    threshold: float | None = 0.0


class ModelVersionCreate(BaseModel):
    project: dict[str, Any]
    parameter_bindings: list[ParameterBindingModel]
    outcome_bindings: list[OutcomeBindingModel]
    notes: str = ""


class ModelVersionResponse(BaseModel):
    id: str
    study_id: str
    version: int
    kind: Literal["flow", "none"]
    project: dict[str, Any] | None = None
    parameter_bindings: list[ParameterBindingModel]
    outcome_bindings: list[OutcomeBindingModel]
    engine_version: str | None = None
    signature: str | None = None
    validation_status: Literal["unvalidated", "validated", "failed"]
    validation_json: dict[str, Any] | None = None
    notes: str
    created_at: str


# --- Sensitivity & Pareto Models ---


class SensitivityRequest(BaseModel):
    outcome_id: str | None = None
    outcome_key: str | None = None
    n_samples: int = Field(default=64, ge=16, le=512)
    seed: int | None = None
    freezing_threshold: float = Field(default=0.05, gt=0, lt=0.5)


class ParameterSensitivityModel(BaseModel):
    param_id: str
    name: str
    key: str
    first_order: float
    total_order: float
    ci_95: list[float]


class FreezingRecommendationModel(BaseModel):
    param_id: str
    key: str
    name: str
    reason: str
    suggested_value: float
    unit: str | None = None


class SensitivityResponse(BaseModel):
    outcome_id: str
    outcome_key: str
    n_samples: int
    n_evaluations: int
    parameters: list[ParameterSensitivityModel]
    freezing_recommendations: list[FreezingRecommendationModel]


class ParetoPointModel(BaseModel):
    candidate_id: str
    label: str | None = None
    values: dict[str, Any]
    outcomes: dict[str, float]
    rank: int


class ParetoResponse(BaseModel):
    study_id: str
    x_outcome: str
    y_outcome: str
    x_direction: Literal["minimize", "maximize"]
    y_direction: Literal["minimize", "maximize"]
    total_candidates: int
    frontier_count: int
    ideal_point: dict[str, float]
    nadir_point: dict[str, float]
    frontier: list[ParetoPointModel]
    all_points: list[ParetoPointModel]


# --- Auto-Calibration Models (Pillar 6, §13) ---


class CalibrationRequest(BaseModel):
    parameter_key: str
    target_outcome: str
    initial_guess: float
    param_bounds: list[float] = Field(min_length=2, max_length=2)
    evidence_ids: list[str] | None = None


class CalibrationResponse(BaseModel):
    study_id: str
    model_id: str
    parameter_key: str
    prior_value: float
    calibrated_value: float
    ci_95: list[float]
    standard_error: float
    prior_rmse: float
    calibrated_rmse: float
    rmse_reduction_pct: float
    n_evidence_points: int


class CalibrationApplyRequest(BaseModel):
    parameter_key: str
    calibrated_value: float
    notes: str | None = None
