# Lattice Lab — Master Scientific Overhaul Implementation Plan
## (Step-by-Step Execution Spec for Autonomous Coding Agents)

> **Purpose of this document:** This is a **zero-ambiguity, prescriptive implementation blueprint** designed so a coding agent can execute every task mechanically without needing to invent math, guess file locations, or make architectural decisions.
> **Companion critique:** Every task in this plan directly resolves a failure, missing capability, or high-value feature identified in [`docs/SCIENTIFIC_AND_DEVELOPER_CRITIQUE.md`](./SCIENTIFIC_AND_DEVELOPER_CRITIQUE.md).

---

## 0. Strict Operating Instructions for the Executing Agent

1. **Execute tasks in exact ID order:** `T1-1`, `T1-2`, …, `T4-5`. Do **not** skip ahead.
2. **Never invent scientific data or fallback mock rows.** If an endpoint or UI component lacks real data, return a clear validation error or render an honest empty state.
3. **Preserve backward compatibility with existing tests:**
   - Before starting any task, run `npm test` and `npm run test:server`.
   - After finishing each task, you **must** run:
     ```bash
     npm test
     npm run build
     npm run test:server
     uv run --directory server ruff check .
     ```
   - All four commands must exit `0` before marking a task `done` in [§6 Progress Tracker](#6-progress-tracker).
4. **Follow exact code specifications:** Where this document provides exact Python/TypeScript code, formulas, or replacement blocks, implement them verbatim.

---

## Phase 1 (Tier 1) — Fix Broken Math, Fake Calibration, Mock UI & Split-Brain State

### `T1-1` · Ban Fake Data in Calibration, Fix Parameter Apply, and Enforce Validation Rules
**Resolves:** Critique §2.1 #2 (Hard Rule #1 and #6 violations in [`server/lattice_server/api/calibration.py`](../server/lattice_server/api/calibration.py) and [`server/lattice_server/stats/calibration.py`](../server/lattice_server/stats/calibration.py)).

#### Reasoning & What Is Broken
1. In `server/lattice_server/api/calibration.py:81-106`, when `not evidence_points`, the server fabricates 3 fake data points (`base_measured`, `+0.12`, `-0.09`). **This is a severe violation of Hard Rule 1.**
2. In `server/lattice_server/api/calibration.py:167-180`, `apply_calibrated_model` copies `latest_model.project` into `new_project` without writing `req.calibrated_value` into the bound node's parameter field!
3. In `server/lattice_server/api/calibration.py:181-186`, `apply_calibrated_model` forces `validation_status = 'validated'` via raw SQL, violating Hard Rule 6.

#### Exact Changes to Make

1. **Edit `server/lattice_server/api/calibration.py` (`L73-107`):**
   - **Delete lines 81–106 completely** (the `if not evidence_points:` block that calls `bridge.evaluate` and creates fake `evidence_points`).
   - Replace it with an explicit check requiring at least **3 valid physical evidence rows** that contain the target outcome:
     ```python
     valid_for_outcome = [
         ep for ep in evidence_points
         if req.target_outcome in (ep.get("outcomes") or {})
     ]
     if len(valid_for_outcome) < 3:
         raise ApiHttpError(
             status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
             code="insufficient_evidence",
             message=(
                 f"Calibration requires at least 3 valid evidence records measuring "
                 f"outcome '{req.target_outcome}' (found {len(valid_for_outcome)}). "
                 f"Never invent synthetic calibration data (Hard Rule 1)."
             ),
             field="evidence_ids",
         )
     ```

2. **Edit `server/lattice_server/api/calibration.py` (`L165-187`) in `apply_calibrated_model`:**
   - Deep-copy `latest_model.project` using `copy.deepcopy(latest_model.project)`.
   - Locate the binding in `latest_model.parameter_bindings` where `b.parameter_key == req.parameter_key`.
   - If found and `not b.not_in_model` and `b.node_id` and `b.param_key`:
     - Find the node in `new_project.get("nodes", [])` where `node.get("id") == b.node_id`.
     - If found, set `node.setdefault("params", {})[b.param_key] = float(req.calibrated_value)`.
   - Also update the study's parameter spec if the parameter `role == "fixed"` (via `parameters_repo`).
   - **Delete lines 181–186** (`UPDATE model_versions SET validation_status = 'validated'`). A newly calibrated model version **must** start with `validation_status = 'unvalidated'` until it passes empirical coverage validation (`T2-1`) and human acceptance!
   - Exact replacement for lines 167–187 of `server/lattice_server/api/calibration.py`:
     ```python
     import copy

     new_project = copy.deepcopy(latest_model.project) if latest_model.project else {}
     binding_applied = False
     for b in latest_model.parameter_bindings:
         if b.parameter_key == req.parameter_key and not b.not_in_model and b.node_id and b.param_key:
             for node in new_project.get("nodes", []):
                 if node.get("id") == b.node_id:
                     node.setdefault("params", {})[b.param_key] = float(req.calibrated_value)
                     binding_applied = True
                     break

     if not binding_applied:
         raise ApiHttpError(
             status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
             code="unbound_parameter",
             message=f"Parameter '{req.parameter_key}' is not bound to any flow node in model v{latest_model.version}.",
             field="parameter_key",
         )

     notes = req.notes or f"Calibrated {req.parameter_key}={req.calibrated_value} from bench evidence (unvalidated until coverage check)."

     create_req = ModelVersionCreate(
         project=new_project,
         parameter_bindings=[b.model_dump() for b in latest_model.parameter_bindings],
         outcome_bindings=[b.model_dump() for b in latest_model.outcome_bindings],
         notes=notes,
     )

     created_model = models_repo.create_model_version(conn, study_id, create_req)
     ```

3. **Edit `src/study/components/CalibrationWizard.tsx`:**
   - When the API returns `422 insufficient_evidence`, display a clear amber alert box inside the modal: *"At least 3 valid lab evidence records are required to calibrate model parameters. Add or import physical measurements in the Evidence tab first."*
   - Change the button label from `"Apply & Validate Model"` to `"Apply Calibrated Parameter (Creates New Model Version)"`.

#### Verification Tests
- Add `server/tests/test_calibration_integrity.py`:
  1. Calling `POST /api/v1/studies/{id}/calibrate` with 0, 1, or 2 evidence rows returns HTTP `422` with `detail.code == "insufficient_evidence"`.
  2. Calling `POST /api/v1/studies/{id}/calibrate` with 5 real evidence rows converges and returns `n_evidence_points == 5`.
  3. Calling `POST /api/v1/studies/{id}/calibrate/apply` creates a new `ModelVersion` whose `project["nodes"]` actually contains the updated `calibrated_value` on the bound node field, and whose `validation_status == "unvalidated"`.

---

### `T1-2` · Fix Uncertain Distributions, Adaptive Two-Stage Monte Carlo, and Premature `"recommended"` Status
**Resolves:** Critique §2.1 #1, #3, #4 ([`server/lattice_server/stats/montecarlo.py`](../server/lattice_server/stats/montecarlo.py), [`server/lattice_server/screening/pipeline.py`](../server/lattice_server/screening/pipeline.py), [`src/study/tabs/OverviewTab.tsx`](../src/study/tabs/OverviewTab.tsx)).

#### Reasoning & Mathematical Specification
1. **Clopper–Pearson Sample Size Mathematics:**
   For confidence $1 - \delta$ (default $0.95$, so $\delta = 0.05$) and exclusion threshold $\tau$ (default $0.05$), the minimum number of zero-success draws required to achieve $p_{\text{upper}}(0, n) = 1 - \delta^{1/n} < \tau$ is:
   $$n_{\min}(\tau, \delta) = \left\lfloor \frac{\ln(\delta)}{\ln(1 - \tau)} \right\rfloor + 1$$
   For $\delta = 0.05, \tau = 0.05$, $n_{\min} = \lfloor -2.9957 / -0.05129 \rfloor + 1 = 58 + 1 = 59$.
2. **Adaptive Two-Stage Sampling (§4.4 of Plan):**
   Instead of a fixed 5 draws (which can never exclude anything) or wasting 200 draws on candidates that succeed on every draw, evaluate in rounds of `round_size = 20` up to `mc_max` (default `min(200, max(60, n_min + 1))`, configurable via `settings["mc_draws"]`).
   After round $r$ (with total valid draws $n$ and successes $k$):
   - Compute $p_{\text{upper}} = \text{clopper\_pearson\_upper}(k, n, \delta)$ and $p_{\text{lower}} = \text{clopper\_pearson\_lower}(k, n, \delta)$.
   - **Early stop for candidate** if:
     - $p_{\text{upper}} < \tau$ (candidate is decisively below threshold), OR
     - $p_{\text{lower}} \ge \tau$ (candidate is decisively viable above threshold).
   - Only surviving ambiguous candidates ($p_{\text{lower}} < \tau \le p_{\text{upper}}$) continue to round $r + 1$!
3. **Complete Distribution Sampling (`sample_uncertain_parameter`):**
   Must implement all 5 distribution types truncated to `[min_v, max_v]`:
   - `uniform`: `rng.uniform(min_v, max_v, size=size)`
   - `normal`: `scipy.stats.truncnorm.rvs((min_v - mean)/sd, (max_v - mean)/sd, loc=mean, scale=sd, size=size, random_state=rng)`
   - `lognormal`: Let $\mu_{\ln} = \ln(\text{median})$ and $\sigma_{\ln} = \ln(\text{gsd})$. Sample $Z \sim \text{truncnorm}\!\left(\frac{\ln(\text{min\_v}) - \mu_{\ln}}{\sigma_{\ln}}, \frac{\ln(\text{max\_v}) - \mu_{\ln}}{\sigma_{\ln}}, \text{loc}=\mu_{\ln}, \text{scale}=\sigma_{\ln}\right)$ and return $\exp(Z)$.
   - `triangular`: Let $c = \text{clip}\!\left(\frac{\text{mode} - \text{min\_v}}{\text{max\_v} - \text{min\_v}}, 0.0, 1.0\right)$. Return `scipy.stats.triang.rvs(c, loc=min_v, scale=max_v - min_v, size=size, random_state=rng)`.
   - `discrete`: Given `values` and optional `weights` (default equal weights), normalize `p = np.array(weights, dtype=float) / np.sum(weights)` and return `rng.choice(values, size=size, p=p)`.
4. **Never Set `status = "recommended"` in Monte Carlo:**
   Delete the `elif p_hat >= 0.70: status = "recommended"` branch in `montecarlo.py:212-217`. All non-excluded, non-deprioritised candidates must have `status = "open"`. Recommendation is strictly the job of Phase 5 Batch Selection (`T3-2`).

#### Exact Changes to Make

1. **Rewrite `sample_uncertain_parameter` in `server/lattice_server/stats/montecarlo.py` (`L39-66`):**
   ```python
   from scipy.stats import triang, truncnorm

   def min_draws_for_exclusion(tau: float, delta: float) -> int:
       """Minimum MC draws n so that k=0 successes yields Clopper-Pearson p_upper < tau."""
       if tau <= 0.0 or tau >= 1.0 or delta <= 0.0 or delta >= 1.0:
           return 60
       return int(np.floor(np.log(delta) / np.log(1.0 - tau))) + 1

   def sample_uncertain_parameter(
       param: ParameterResponse,
       rng: np.random.Generator,
       size: int,
   ) -> np.ndarray:
       """Sample values for an uncertain parameter from its defined distribution, truncated to [min, max]."""
       spec = param.spec if isinstance(param.spec, dict) else (
           param.spec.model_dump() if hasattr(param.spec, "model_dump") else {}
       )
       dist = spec.get("distribution") or {}
       if hasattr(dist, "model_dump"):
           dist = dist.model_dump()

       dist_type = dist.get("type", "uniform")
       if param.kind == "categorical":
           options = spec.get("options") or dist.get("values") or ["default"]
           weights = spec.get("weights") or dist.get("weights")
           if weights is not None and len(weights) == len(options):
               p = np.asarray(weights, dtype=np.float64)
               p = p / np.sum(p)
           else:
               p = None
           return rng.choice(options, size=size, p=p)

       if dist_type == "discrete":
           values = dist.get("values") or spec.get("values") or [0.0]
           weights = dist.get("weights")
           if weights is not None and len(weights) == len(values):
               p = np.asarray(weights, dtype=np.float64)
               p = p / np.sum(p)
           else:
               p = None
           sampled = rng.choice(values, size=size, p=p)
           return sampled.astype(np.int64 if param.kind == "integer" else np.float64)

       min_v = float(spec.get("min", 0.0))
       max_v = float(spec.get("max", 1.0))
       span = max(1e-12, max_v - min_v)

       if dist_type == "normal":
           mean = float(dist.get("mean", 0.5 * (min_v + max_v)))
           sd = max(1e-9, float(dist.get("sd", span / 4.0)))
           a = (min_v - mean) / sd
           b = (max_v - mean) / sd
           draws = truncnorm.rvs(a, b, loc=mean, scale=sd, size=size, random_state=rng)
       elif dist_type == "lognormal":
           median = max(1e-9, float(dist.get("median", np.sqrt(max(1e-9, min_v) * max(1e-6, max_v)))))
           gsd = max(1.0001, float(dist.get("gsd", 1.5)))
           mu_ln = np.log(median)
           sd_ln = np.log(gsd)
           low_ln = np.log(max(1e-12, min_v))
           high_ln = np.log(max(1e-9, max_v))
           a = (low_ln - mu_ln) / sd_ln
           b = (high_ln - mu_ln) / sd_ln
           draws = np.exp(truncnorm.rvs(a, b, loc=mu_ln, scale=sd_ln, size=size, random_state=rng))
       elif dist_type == "triangular":
           mode = float(dist.get("mode", 0.5 * (min_v + max_v)))
           c = float(np.clip((mode - min_v) / span, 0.0, 1.0))
           draws = triang.rvs(c, loc=min_v, scale=span, size=size, random_state=rng)
       else:
           draws = rng.uniform(min_v, max_v, size=size)

       if param.kind == "integer":
           return np.round(draws).astype(np.int64)
       return np.asarray(draws, dtype=np.float64)
   ```

2. **Implement Adaptive Rounds in `run_monte_carlo_screening` (`server/lattice_server/stats/montecarlo.py:96-235`):**
   - Change default `mc_draws: int = 60` (and in `pipeline.py:169, 548` change default `mc_draws` from `5`/`10` to `60`).
   - Add parameter `adaptive: bool = True` and `round_size: int = 20`.
   - In `run_monte_carlo_screening`:
     - If `not uncertain_params`: only `1` deterministic draw per candidate is needed (`n_draws = 1`), and since there is no input uncertainty, if the deterministic model is validated and fails criteria ($k = 0$), set $p_{\text{hat}} = 0.0, p_{\text{upper}} = 0.0$ so deterministic models don't waste 60 identical runs!
     - If `uncertain_params` is non-empty:
       - Run in rounds `r = 0, 1, ...` of `step = min(round_size, mc_draws - total_drawn_so_far)` for active candidates.
       - Seed each candidate's round RNG deterministically via `np.random.default_rng([rng_seed, cand_idx, r])`.
       - Accumulate `n_draws[cand_id]` and `k_successes[cand_id]`.
       - After each round, compute `p_upper = clopper_pearson_upper(k, n, delta)` and `p_lower = clopper_pearson_lower(k, n, delta)`.
       - If `adaptive` is True and (`p_upper < tau` or `p_lower >= tau`), mark candidate as converged and do not evaluate it in subsequent rounds.
     - Status assignment at the end:
       - If `is_validated and p_upper < tau`: `status = "excluded"`
       - Else if `(not is_validated) and p_hat < tau`: `status = "deprioritised"`
       - Else if `is_validated and p_hat < tau` (when `mc_draws < n_min` so `p_upper >= tau`): `status = "deprioritised"` with reason explaining that `p_hat < tau` but `n_draws` was insufficient for `1 - delta` exclusion (`p_upper >= tau`).
       - Else: `status = "open"`.

3. **Update `src/study/tabs/OverviewTab.tsx` (`L47-56`):**
   - Change `settings: { mc_draws: 5 }` on line 50 to `settings: { mc_draws: 60, adaptive: true }`.
   - Add a small configuration dropdown or number input next to **"Run Screening"** allowing the scientist to pick `Standard Adaptive (up to 60 draws)`, `High Precision (up to 200 draws)`, or `Fast Preview (20 draws — deprioritise only)`.

4. **Fix `expected_false_exclusions_bound` in `server/lattice_server/screening/pipeline.py` (`L649-655`):**
   - Count how many candidates were excluded by statistical filters (`filter in ("model", "evidence", "hybrid")` and `status == "excluded"`), let this be $N_{\text{stat\_excl}}$, and let $N_{\text{tested\_stat}}$ be the number of candidates evaluated by statistical filters (i.e., `after_constraints`).
   - Per §4.4 of the spec, compute:
     ```python
     delta = 1.0 - study.confidence
     expected_false_exclusions_bound = round(delta * after_constraints, 4) if excluded_statistical > 0 else 0.0
     ```
   - Also support optional Holm–Bonferroni multiplicity adjustment when `settings.get("multiplicity") == "holm"`: sort statistical `p_upper` values ascending $p_{(1)} \le p_{(2)} \le \dots \le p_{(m)}$ (where each candidate was evaluated at $\delta / (m - j + 1)$) or compare against adjusted threshold.

#### Verification Tests
- Update/add tests in `server/tests/test_montecarlo.py`:
  1. Test `sample_uncertain_parameter` for all 5 distributions (`uniform`, `normal`, `lognormal`, `triangular`, `discrete`): verify sample medians/modes match theoretical values within tolerance and all samples lie inside `[min, max]`.
  2. Verify that with `mc_draws=60`, a validated model where candidate A always fails ($k=0$) gets `n_draws=60`, `p_upper ≈ 0.0487 < 0.05`, and `status == "excluded"`.
  3. Verify that candidate B which always succeeds ($k=20$ in round 0) stops early at `n_draws=20` with `p_lower > 0.05` and `status == "open"` (NOT `"recommended"`).

---

### `T1-3` · Fix Soft Constraint Penalties, Hard Constraint Role Validation, and Evidence Replicate Matching
**Resolves:** Critique §2.1 #5 ([`server/lattice_server/screening/pipeline.py`](../server/lattice_server/screening/pipeline.py), [`server/lattice_server/repo/constraints.py`](../server/lattice_server/repo/constraints.py)).

#### Exact Changes to Make
1. **Enforce Hard Constraint Parameter Roles (`server/lattice_server/repo/constraints.py` & `api/constraints.py`):**
   - When creating or updating a constraint with `kind == "hard"`, extract referenced variables via `expression_variables(expression)`.
   - Look up study parameters. If any referenced variable has `role == "uncertain"`, raise `ApiHttpError(422, code="uncertain_in_hard_constraint", message=f"Hard constraint cannot reference uncertain parameter '{var}'. Uncertain parameters vary randomly and are evaluated in Monte Carlo screening, not deterministic hard constraints.")`.
2. **Use `_constraint.penalty` for Soft Constraints (`server/lattice_server/screening/pipeline.py:308-313` & `359-364`):**
   - Replace `soft_penalties[i] += 1.0` with:
     ```python
     weight = float(_constraint.penalty) if _constraint.penalty is not None else 1.0
     soft_penalties[i] += weight
     ```
3. **Continuous Evidence Matching Tolerance (`server/lattice_server/screening/pipeline.py:122-125`):**
   - In `matches_candidate`, for continuous parameters, check relative tolerance `1e-6` OR span tolerance `0.005 * (p_max - p_min)` when `min` and `max` are defined in `p.spec`, and ensure `evidence_filter` aggregates **all** matching non-retracted valid evidence rows (computing mean, standard deviation, and replicate pass ratio `passes / n_valid`).

#### Verification Tests
- Add tests in `server/tests/test_screening.py` verifying:
  - Creating a hard constraint referencing an `uncertain` parameter returns HTTP `422`.
  - Soft constraint with `penalty=4.5` stores `details["soft_penalty"] == 4.5`.

---

### `T1-4` · Fix Pareto Comparator Bug, Remove Hardcoded Mock Data in `LabProtocolSheet` & `CandidatesTab`
**Resolves:** Critique §2.1 #6 & #7 ([`src/study/components/ParetoExplorer.tsx`](../src/study/components/ParetoExplorer.tsx), [`src/study/components/LabProtocolSheet.tsx`](../src/study/components/LabProtocolSheet.tsx), [`src/study/tabs/CandidatesTab.tsx`](../src/study/tabs/CandidatesTab.tsx), [`server/lattice_server/api/run_sheets.py`](../server/lattice_server/api/run_sheets.py)).

#### Exact Changes to Make
1. **Fix `src/study/components/ParetoExplorer.tsx` (`L100-103`):**
   - Change:
     ```ts
     const sortedFrontier = [...frontierPoints].sort(
       (a, b) => (a.outcomes[xKey] ?? 0) - (b.outcomes[yKey] ?? 0)
     );
     ```
     to:
     ```ts
     const sortedFrontier = [...frontierPoints].sort(
       (a, b) => (a.outcomes[xKey] ?? 0) - (b.outcomes[xKey] ?? 0)
     );
     ```
2. **Include `rows` in `RunSheetResponse` (`server/lattice_server/schemas.py:688-695` & `server/lattice_server/repo/run_sheets.py`):**
   - Add `rows: list[dict[str, Any]] = Field(default_factory=list)` to `RunSheetResponse` in `schemas.py` and populate it from `json.loads(row["rows_json"])` in `repo/run_sheets.py`.
3. **Remove Fake Rows & Hardcoded Cold-Plate Checklist from `src/study/components/LabProtocolSheet.tsx`:**
   - Delete the hardcoded `[1, 2, 3, 4, 5, 6, 7, 8].map(...)` table body (`L373-405`) that fabricates `CAND-103..124` and fake `T_j Measured (°C)` / `ΔP Measured (kPa)` columns.
   - Instead, render dynamic columns from the Study's actual `parameters` (controlled) and `outcomes` (with their real `label` and `unit`), and iterate over `activeRunSheet.rows`.
   - If `activeRunSheet` has not been generated yet, show a clean empty state with a button **"Generate Randomized Run Sheet"** that calls `POST /studies/${study.id}/run-sheets`.
   - Replace the hardcoded microchannel cold-plate checklist (`"Thermocouple calibrated"`, `"Coriolis Flow Meter Zeroed"`, `"TIM 50µm applied"`) with dynamic domain-appropriate pre-run checks derived from the study's actual parameters, constraints, and outcomes (e.g., `"Verify controlled parameter calibration ranges"`, `"Record ambient uncertain conditions"`, `"Run order randomized with seed #" + activeRunSheet.seed`).
4. **Remove Hardcoded Cold-Plate Fallback in `src/study/tabs/CandidatesTab.tsx` (`L96-135`):**
   - When exporting CAD for a candidate, if the study has an active `ModelVersion` with `scene3d`/`scene2d` objects, apply the candidate's bound parameter values to a clone of those objects before opening `FabricationExportModal`. If the study has no 3D scene objects (e.g., a drug screen study), disable or hide the `"Export CAD"` button instead of generating a fake 5-fin microchannel heatsink!

---

### `T1-5` · Fix Split-Brain State Sync (`Workspace.tsx` ↔ `ModelTab.tsx`) and Add Pint Unit Conversion in `engine/bridge.py`
**Resolves:** Critique §2.2 #7 and §2.3 #1 & #2 ([`src/Workspace.tsx`](../src/Workspace.tsx), [`src/study/tabs/ModelTab.tsx`](../src/study/tabs/ModelTab.tsx), [`server/lattice_server/engine/bridge.py`](../server/lattice_server/engine/bridge.py), [`server/lattice_server/api/models.py`](../server/lattice_server/api/models.py)).

#### Exact Changes to Make
1. **Add Unit Validation & Conversion in `server/lattice_server/api/models.py` and `server/lattice_server/engine/bridge.py`:**
   - Write a helper function `resolve_node_field_unit(project: dict[str, Any], node_id: str, param_key: str) -> str` in `server/lattice_server/engine/bridge.py` (or a shared node-field unit lookup map generated from `registry.ts` / `scene-events.ts` or stored on `ParameterBindingModel` as `field_unit: str = ""`).
   - Add `field_unit: str | None = None` to `ParameterBindingModel` in `server/lattice_server/schemas.py` (`L733-738`) and `src/core/study/types.ts`.
   - In `src/core/study/bindings.ts` (`validateBindings`), check if `pb.unit` (study parameter unit) and `field.unit` (node field unit) are both non-empty; pass `field.unit` back or convert in Python using `lattice_server.units.convert_value(val, from_unit=param.unit, to_unit=field_unit)`.
   - In `server/lattice_server/api/models.py` (`create_model_version`), validate dimensional compatibility between each bound Study parameter's `unit` and the bound field's `field_unit` using `lattice_server.units.are_units_compatible(param.unit, b.field_unit)`. If incompatible (e.g., `Pa` bound to `m/s`), raise `ApiHttpError(422, code="incompatible_units", message=...)`.
   - Before sending `rows` to the Node subprocess in `bridge.evaluate()`, convert any bound parameter value from `param.unit` to `b.field_unit` via `convert_value()`.
2. **Fix `Workspace.tsx` & `ModelTab.tsx` Project State Sync:**
   - In `src/Workspace.tsx`, when `initialProject` prop changes (or when `studyId` is passed), use a `useEffect` keyed on `studyId` and `initialProject` so `Workspace` loads `initialProject` instead of stale `localStorage["lattice-studio-v3"]`.
   - Pass an `onProjectChange?: (project: Project) => void` callback from `ModelTab.tsx` into `<Workspace />`. Store `draftProject` in `ModelTab.tsx` state.
   - When the user clicks **"Save Version"** in `ModelTab.tsx`, pass `draftProject` (the live edited graph from the embedded `Workspace`) directly into `<BindingDialog project={draftProject} ... />`, pre-populating `BindingDialog` with the previous `latestModel.parameter_bindings` and `latestModel.outcome_bindings` so the scientist doesn't have to re-bind everything from scratch!

#### Verification Tests
- Add test in `server/tests/test_models_api.py`: binding a Study parameter with `unit="mm"` (`value=0.1`) to a node field with `field_unit="um"` converts `0.1 mm -> 100.0 um` during evaluation; binding `unit="Pa"` to `field_unit="s"` returns HTTP `422 incompatible_units`.

---

## Phase 2 (Tier 1.5) — Cure the "Theatrical Physics" & Upgrade the Flow Engine

### `T2-1` · Replace Placebo Parameters in `waterMist`, `gasExplosion`, `fluidSprayer`, and `gasCloud`
**Resolves:** Critique §2.2 #1 and `IMPLEMENTATION_PLAN.md` `P3-6` ([`src/core/scene-events.ts`](../src/core/scene-events.ts), [`src/core/runtime.ts`](../src/core/runtime.ts)).

#### Reasoning & Mathematical Specification
Currently, `waterMist` ignores `flow`, `droplet`, `nozzles`, `angle`, and `fallSpeed`; `gasExplosion` ignores `fuel` and `fuelMass`; `fluidSprayer` ignores `flow`, `nozzles`, and `fallSpeed`. When a scientist binds these parameters in a Study, sensitivity is $0.0$. At the same time, **existing unit tests in `src/core/engine.test.ts` expect exact numerical outputs when default parameters are used**.
Therefore:
1. **`waterMist` (`src/core/scene-events.ts:114-147`):**
   - Add select field `mitigation` with options `["Assumed %", "Parametric"]` (default `"Assumed %"` so all existing tests produce identical numbers, while Study templates and users can select `"Parametric"`—or if `mitigation === "Parametric"`, compute physical attenuation from `flow`, `droplet`, `nozzles`, `angle`, `fallSpeed`).
   - Add numeric fields for `"Parametric"`:
     - `rmax` (Max attenuation %, default `85`, min `0`, max `98`, unit `"%"`)
     - `kLoad` (Loading sensitivity, default `0.012`, min `0.0001`, max `10`, unit `"1/(L/min)"`)
     - `dOpt` (Optimal Sauter diameter $D_{32}$, default `80`, min `10`, max `1000`, unit `"µm"`)
     - `dWidth` (Log-normal droplet effectiveness width, default `1.1`, min `0.1`, max `5`, unit `""`)
   - In `waterMist.effect({ params: p, age, channel })`:
     ```ts
     const fill = Math.min(1, age / Number(p.rise));
     const isParametric = p.mitigation === "Parametric";
     if (!isParametric) {
       return channel === "temperature"
         ? -Number(p.cooling) * fill
         : (Number(p.reduction) / 100) * fill;
     }
     const totalFlow = Math.max(0, Number(p.flow)) * Math.max(1, Number(p.nozzles));
     const droplet = Math.max(1, Number(p.droplet));
     const dOpt = Math.max(1, Number(p.dOpt ?? 80));
     const dWidth = Math.max(0.1, Number(p.dWidth ?? 1.1));
     const kLoad = Math.max(0, Number(p.kLoad ?? 0.012));
     const rmax = Math.min(98, Math.max(0, Number(p.rmax ?? 85)));
     const angleFactor = Math.sin((Math.min(150, Math.max(10, Number(p.angle ?? 65))) * Math.PI) / 180);
     const residenceFactor = Math.min(1.5, Math.max(0.4, 3.0 / Math.max(0.2, Number(p.fallSpeed ?? 3))));
     const loadTerm = 1 - Math.exp(-kLoad * totalFlow * angleFactor * residenceFactor);
     const sizeTerm = Math.exp(-Math.pow(Math.log(droplet / dOpt) / dWidth, 2));
     if (channel === "temperature") {
       return -Number(p.cooling) * loadTerm * sizeTerm * fill;
     }
     return (rmax / 100) * loadTerm * sizeTerm * fill;
     ```
   - Update `tunnel_blast.json` template and `src/core/tunnel-demo.ts` so `waterMist` sets `mitigation: "Parametric"`.
2. **`gasExplosion` (`src/core/scene-events.ts:278-333`):**
   - Make `fuel`, `fuelMass`, and `phi` modulate the effective overpressure and flame temperature around the baseline (`fuelMass_ref = 25 kg`, `phi_ref = 1.0`):
     - Fuel energy density multiplier `fuelFactor`: `"Hydrogen (H2)" -> 1.35`, `"Acetylene (C2H2)" -> 1.25`, `"Propane (C3H8)" -> 1.05`, `"Vapor Cloud (TNT Eq)" -> 1.15`, `"Methane (CH4)" -> 1.0` (so default `"Methane (CH4)"` with `fuelMass = 25` and `phi = 1.0` has multiplier `1.0`, preserving exact backward compatibility!).
     - Sachs/Hopkinson cube-root mass scaling relative to reference `25 kg`: `massScale = Math.cbrt(Math.max(0.1, Number(p.fuelMass ?? 25)) / 25)`.
     - Stoichiometric peaking factor: `stoichScale = Math.exp(-Math.pow((Number(p.phi ?? 1.0) - 1.05) / 0.65, 2)) / Math.exp(-Math.pow((1.0 - 1.05) / 0.65, 2))`.
     - Multiply `Number(p.overpressure)` by `fuelFactor * massScale * stoichScale` in `effect()`.
3. **`fluidSprayer` (`src/core/scene-events.ts:335-388`):**
   - Couple `flow`, `nozzles`, `droplet`, and `fallSpeed` into both `pressure` and `temperature` channels (normalized to `1.0` at the defaults `flow=25, nozzles=12, droplet=75, fallSpeed=6` so existing snapshots stay unchanged while varying any of those 4 parameters produces smooth physical response!).
4. **`gasCloud` (`src/core/scene-events.ts:390-418`):**
   - Apply Graham's law molecular diffusivity factor based on `p.gas` (`"Hydrogen (H2)" -> 1.8`, `"Methane (CH4)" -> 1.0`, `"Ammonia (NH3)" -> 0.95`, `"Carbon Monoxide (CO)" -> 0.85`, `"Hydrogen Sulfide (H2S)" -> 0.75`) to the dispersion decay rate.
5. **Backward Compatibility in `parseProject` (`src/core/runtime.ts:311-390`):**
   - Before field validation in `parseProject`, fill any missing newly added fields (`mitigation: "Assumed %"`, `rmax: 85`, `kLoad: 0.012`, `dOpt: 80`, `dWidth: 1.1`) on `waterMist` scene events so saved JSON projects from before this change load without throwing.

#### Verification Tests
- Add tests in `src/core/engine.test.ts`:
  - All 46 existing TS tests continue to pass unchanged.
  - In `Parametric` mode on `waterMist`, varying `droplet` (`80 µm` vs `800 µm`), `flow` (`10` vs `100`), and `nozzles` (`2` vs `16`) changes downstream pressure sensor output as expected.
  - Varying `fuelMass` (`5 kg` vs `125 kg`) on `gasExplosion` scales peak overpressure by $5\times^{1/3}$ ($25^{1/3}$ ratio).

---

### `T2-2` · Fix Physics Bugs (`blastImpulseSensor`, `sdofVibration`, `fftSpectrum`) & Add Multi-Variable `formula` Support
**Resolves:** Critique §2.2 #3 & #4 ([`src/core/sensor-model.ts`](../src/core/sensor-model.ts), [`src/core/registry.ts`](../src/core/registry.ts)).

#### Exact Changes to Make
1. **Fix `blastImpulseSensor` in `src/core/sensor-model.ts` (`L59-121`):**
   - Currently `blastImpulseSensor` returns instantaneous pressure $P(t)$ labeled `"Pa·s"`.
   - Fix: After computing the instantaneous sensor response array `values` (or inside the time loop when `spec.id === "blastImpulseSensor"`), integrate positive overpressure over time using the trapezoidal rule:
     $$I(t_i) = I(t_{i-1}) + \frac{\max(0, P(t_{i-1})) + \max(0, P(t_i))}{2} \cdot (t_i - t_{i-1})$$
   - Specifically, in `src/core/sensor-model.ts` right before `return signal(values, c.times, spec.unit, c.node.label);` (`L121`):
     ```ts
     if (spec.id === "blastImpulseSensor") {
       const integrated = new Array<number>(values.length).fill(0);
       for (let i = 1; i < values.length; i++) {
         const dt = Math.max(0, c.times[i] - c.times[i - 1]);
         const p0 = Math.max(0, values[i - 1]);
         const p1 = Math.max(0, values[i]);
         integrated[i] = integrated[i - 1] + 0.5 * (p0 + p1) * dt;
       }
       return signal(integrated, c.times, spec.unit, c.node.label);
     }
     ```
2. **Fix Numerical Instability in `sdofVibration` (`src/core/registry.ts:1615-1627`):**
   - Replace the semi-implicit Euler loop with the **unconditionally stable Newmark-$\beta$ average acceleration method** ($\gamma = 0.5, \beta = 0.25$):
     ```ts
     const dt = 1 / c.sampleRate;
     let x = 0, v = 0;
     let a = (F[0] - cd * v - k * x) / m;
     const disp: number[] = [];
     const a0 = 1 / (0.25 * dt * dt);
     const a1 = 0.5 / (0.25 * dt);
     const a2 = 1 / (0.25 * dt);
     const keff = k + a0 * m + a1 * cd;
     for (let i = 0; i < c.times.length; i++) {
       disp.push(x * 1000); // mm
       if (i + 1 < c.times.length) {
         const fNext = F[i + 1];
         const feff =
           fNext +
           m * (a0 * x + a2 * v + a) +
           cd * (a1 * x + v);
         const xNext = feff / keff;
         const aNext = a0 * (xNext - x) - a2 * v - a;
         const vNext = v + dt * (0.5 * a + 0.5 * aNext);
         x = xNext;
         v = vNext;
         a = aNext;
       }
     }
     ```
3. **Expand `formula` Node to Accept up to 4 Inputs (`a, b, c, d`) (`src/core/registry.ts:616-639` & `src/core/expression.ts`):**
   - In `src/core/expression.ts`, allow default variables `a`, `b`, `c`, `d`, `t` when `options?.variables` is not provided (updating the default error message only if a test asserts the exact string `"Unknown variable: x. Use a, b or t."` — check `src/core/engine.test.ts` first! Note: if `engine.test.ts` checks `"Use a, b or t."`, keep `a, b, t` when `options` is undefined, and pass `{ variables: ["a", "b", "c", "d", "t"], strict: false }` from `formula`'s `evaluate` only when `c.inputs.c !== undefined || c.inputs.d !== undefined`!).
   - In `src/core/registry.ts` (`formula` definition, `L619-622`), add optional inputs `port("c", "c", ["number", "boolean", "signal"])` and `port("d", "d", ["number", "boolean", "signal"])` so scientists can wire up to 4 variables into a single `formula` node without building deep binary trees.

#### Verification Tests
- Add tests in `src/core/engine.test.ts`:
  - `blastImpulseSensor` output is monotonically non-decreasing and equals $\int \Delta P\,dt$.
  - `sdofVibration` remains bounded and stable even for stiff springs ($\omega_n \Delta t > 2$).
  - `formula` node with `a + b + c * d` evaluates accurately.

---

## Phase 3 (Tier 2) — Complete the Statistical & Mathematical Proof Engine

### `T3-1` · Deterministic Mathematical Proof of Futility via Interval Arithmetic (`stats/intervals.py`)
**Resolves:** Critique §3.1 #1 & #2 ("Mathematically prove for some thresholds an experiment is useless").

#### Reasoning & Mathematical Specification
Monte Carlo sampling can only give a *probabilistic* bound ($p_{\text{upper}} < \tau$). However, when the outcome is governed by a mathematical expression or monotonic flow relation and the uncertain parameters lie in bounded intervals $U_j \in [\underline{u}_j, \overline{u}_j]$, **Interval Arithmetic** propagates exact lower and upper bounds $[\underline{Y}(x), \overline{Y}(x)]$ through the AST:
- $[a, b] + [c, d] = [a+c, b+d]$
- $[a, b] - [c, d] = [a-d, b-c]$
- $[a, b] \times [c, d] = [\min(ac, ad, bc, bd), \max(ac, ad, bc, bd)]$
- Monotone functions ($\exp, \ln, \sqrt{\cdot}$) map $[a, b] \to [f(a), f(b)]$.
- Even powers and $\sin/\cos/\text{abs}$ compute exact extrema over $[a, b]$.

**100% Mathematical Futility Proof Rule:**
- If outcome criterion is $Y < c$ and the interval lower bound satisfies $\underline{Y}(x) \ge c$, then **it is mathematically impossible ($P(\text{success}) = 0$ exactly)** for candidate $x$ to succeed under *any* realization of the uncertain parameters!
- If outcome criterion is $Y > c$ and $\overline{Y}(x) \le c$, then $P(\text{success}) = 0$ exactly.
- Furthermore, by sweeping each single controlled parameter $x_j$ over its range while keeping all other controlled and uncertain parameters as their full intervals $[x_{-j,\min}, x_{-j,\max}]$, we can extract **Critical Threshold Theorems**: e.g., *"For all `droplet` $\in [460, 1000]\ \mu\text{m}$, `peak_pressure` $\in [9120, 18000]\ \text{Pa}$, which violates `< 8000 Pa` under all possible combinations of other parameters."*

#### Exact Changes to Make
1. **Create `server/lattice_server/stats/intervals.py` with the following implementation:**
   ```python
   """Deterministic Interval Arithmetic & Critical Threshold Futility Prover."""

   from __future__ import annotations

   import math
   from dataclasses import dataclass
   from typing import Any

   from lattice_server.expr.parser import (
       BinaryExpr,
       CallExpr,
       Expr,
       IdentifierExpr,
       NumberExpr,
       UnaryExpr,
       parse_expression,
   )
   from lattice_server.expr.tokenizer import tokenize
   from lattice_server.schemas import OutcomeCriterion, OutcomeResponse, ParameterResponse


   @dataclass(frozen=True)
   class Interval:
       low: float
       high: float

       def __post_init__(self) -> None:
           if self.low > self.high:
               object.__setattr__(self, "low", min(self.low, self.high))
               object.__setattr__(self, "high", max(self.low, self.high))

       def add(self, other: Interval) -> Interval:
           return Interval(self.low + other.low, self.high + other.high)

       def sub(self, other: Interval) -> Interval:
           return Interval(self.low - other.high, self.high - other.low)

       def mul(self, other: Interval) -> Interval:
           products = (
               self.low * other.low,
               self.low * other.high,
               self.high * other.low,
               self.high * other.high,
           )
           return Interval(min(products), max(products))

       def div(self, other: Interval) -> Interval:
           if other.low <= 0.0 <= other.high:
               return Interval(-math.inf, math.inf)
           return self.mul(Interval(1.0 / other.high, 1.0 / other.low))

       def pow(self, exp: Interval) -> Interval:
           if exp.low == exp.high and exp.low == int(exp.low):
               n = int(exp.low)
               if n == 0:
                   return Interval(1.0, 1.0)
               if n > 0 and n % 2 == 0:
                   if self.low <= 0.0 <= self.high:
                       return Interval(0.0, max(self.low**n, self.high**n))
                   return Interval(min(self.low**n, self.high**n), max(self.low**n, self.high**n))
               if n > 0:
                   return Interval(self.low**n, self.high**n)
           if self.low <= 0.0:
               return Interval(-math.inf, math.inf)
           vals = (
               self.low**exp.low,
               self.low**exp.high,
               self.high**exp.low,
               self.high**exp.high,
           )
           return Interval(min(vals), max(vals))


   def evaluate_interval_ast(node: Expr, env: dict[str, Interval]) -> Interval:
       if isinstance(node, NumberExpr):
           return Interval(float(node.value), float(node.value))
       if isinstance(node, IdentifierExpr):
           if node.name == "pi":
               return Interval(math.pi, math.pi)
           if node.name == "e":
               return Interval(math.e, math.e)
           return env.get(node.name, Interval(0.0, 0.0))
       if isinstance(node, UnaryExpr):
           val = evaluate_interval_ast(node.operand, env)
           if node.op == "-":
               return Interval(-val.high, -val.low)
           if node.op == "+":
               return val
           if node.op == "!":
               if val.low > 0 or val.high < 0:
                   return Interval(0.0, 0.0)
               if val.low == 0.0 and val.high == 0.0:
                   return Interval(1.0, 1.0)
               return Interval(0.0, 1.0)
       if isinstance(node, BinaryExpr):
           left = evaluate_interval_ast(node.left, env)
           right = evaluate_interval_ast(node.right, env)
           op = node.op
           if op == "+":
               return left.add(right)
           if op == "-":
               return left.sub(right)
           if op == "*":
               return left.mul(right)
           if op == "/":
               return left.div(right)
           if op == "^":
               return left.pow(right)
           if op == "<":
               if left.high < right.low:
                   return Interval(1.0, 1.0)
               if left.low >= right.high:
                   return Interval(0.0, 0.0)
               return Interval(0.0, 1.0)
           if op == "<=":
               if left.high <= right.low:
                   return Interval(1.0, 1.0)
               if left.low > right.high:
                   return Interval(0.0, 0.0)
               return Interval(0.0, 1.0)
           if op == ">":
               if left.low > right.high:
                   return Interval(1.0, 1.0)
               if left.high <= right.low:
                   return Interval(0.0, 0.0)
               return Interval(0.0, 1.0)
           if op == ">=":
               if left.low >= right.high:
                   return Interval(1.0, 1.0)
               if left.high < right.low:
                   return Interval(0.0, 0.0)
               return Interval(0.0, 1.0)
       if isinstance(node, CallExpr):
           args = [evaluate_interval_ast(a, env) for a in node.args]
           fn = node.name
           if fn == "exp":
               return Interval(math.exp(max(-700.0, args[0].low)), math.exp(min(700.0, args[0].high)))
           if fn == "ln":
               if args[0].low <= 0:
                   return Interval(-math.inf, math.inf)
               return Interval(math.log(args[0].low), math.log(args[0].high))
           if fn == "log10":
               if args[0].low <= 0:
                   return Interval(-math.inf, math.inf)
               return Interval(math.log10(args[0].low), math.log10(args[0].high))
           if fn == "sqrt":
               if args[0].high < 0:
                   return Interval(-math.inf, math.inf)
               return Interval(math.sqrt(max(0.0, args[0].low)), math.sqrt(max(0.0, args[0].high)))
           if fn == "abs":
               if args[0].low <= 0.0 <= args[0].high:
                   return Interval(0.0, max(abs(args[0].low), abs(args[0].high)))
               return Interval(min(abs(args[0].low), abs(args[0].high)), max(abs(args[0].low), abs(args[0].high)))
           if fn == "min":
               return Interval(min(a.low for a in args), min(a.high for a in args))
           if fn == "max":
               return Interval(max(a.low for a in args), max(a.high for a in args))
           if fn == "clamp" and len(args) == 3:
               return Interval(max(args[1].low, min(args[0].low, args[2].low)), max(args[1].high, min(args[0].high, args[2].high)))
       return Interval(-math.inf, math.inf)


   def is_interval_proven_futile(bounds: Interval, criterion: OutcomeCriterion) -> bool:
       """Return True iff NO value inside `bounds` can possibly satisfy `criterion`."""
       op = criterion.op
       if op == "<" and criterion.value is not None:
           return bounds.low >= criterion.value
       if op == "<=" and criterion.value is not None:
           return bounds.low > criterion.value
       if op == ">" and criterion.value is not None:
           return bounds.high <= criterion.value
       if op == ">=" and criterion.value is not None:
           return bounds.high < criterion.value
       if op == "between" and criterion.low is not None and criterion.high is not None:
           return bounds.high < criterion.low or bounds.low > criterion.high
       if op == "equals" and criterion.value is not None:
           return bounds.high < criterion.value or bounds.low > criterion.value
       return False
   ```
2. **Integrate into `ExclusionInspector.tsx` and Analysis:**
   - When a candidate is excluded deterministically (hard constraint or interval futility proof), badge it as **`Mathematically Proven Futile (P = 0)`** (the *only* place where deterministic proof language is scientifically valid per Hard Rule 7).

#### Verification Tests
- Create `server/tests/test_intervals.py`:
  - Test interval evaluation of `amplitude * exp(-0.01 * flow)` with `amplitude` $\in [15000, 25000]$, `flow` $\in [1, 50]$ against criterion `< 8000`: verify `bounds.low == 15000 * exp(-0.5) ≈ 9097.96 >= 8000` and `is_interval_proven_futile(...) is True`.

---

### `T3-2` · Model Validation Against Evidence & Stale-Evidence Invalidation (`P3-8`)
**Resolves:** Critique §2.1 #2 and `IMPLEMENTATION_PLAN.md` `P3-8`.

#### Reasoning & Mathematical Specification
Per §4.6 of `IMPLEMENTATION_PLAN.md`:
- A Flow Model (`kind == "flow"`) is validated against all non-retracted `valid` evidence rows.
- For each valid evidence row $i = 1 \dots m$:
  - Set controlled parameters to the evidence row's `values`.
  - Sample uncertain parameters $n = 100$ times from their distributions (`seed = [study.rng_seed, i]`).
  - Run through `bridge.evaluate()` to obtain simulated outcome draws $\{y_{i,1}, \dots, y_{i,100}\}$ for each bound outcome.
  - Compute the empirical 90% prediction interval $[q_{0.05}, q_{0.95}]$ (5th and 95th percentiles, widened by minimum relative tolerance `5%` of outcome span or `max(1e-6, 0.05 * abs(q_50))` when there are 0 uncertain parameters).
  - Check whether the measured lab value $y_i^{\text{meas}} \in [q_{0.05}, q_{0.95}]$.
- **Validation Pass Criteria:**
  1. $m \ge 8$ valid evidence rows (or $m \ge 5$ if study has $\le 2$ controlled parameters), AND
  2. Empirical coverage across outcomes is $\ge 0.80$ (at least 80% of lab measurements fall inside the model's 90% prediction intervals), AND
  3. A human explicitly calls `POST /api/v1/models/{model_id}/accept-validation` with a `reason`.
- **Automatic Stale Invalidation:**
  - Store `evidence_fingerprint` (from `compute_evidence_fingerprint(conn, study_id)`) inside `model_versions.validation_json["evidence_fingerprint"]`.
  - In `screening/pipeline.py` (`L523-532`), before running `model_simulation_filter`, check if `active_model.validation_status == "validated"` AND `(active_model.validation_json or {}).get("evidence_fingerprint") == fingerprint`. If the fingerprint does not match, **override `active_model.validation_status = "unvalidated"` in memory for that run** so stale validations can only deprioritise, never exclude!

#### Exact Changes to Make
1. **Create `server/lattice_server/stats/validation.py`:**
   - Implement `validate_flow_model(conn, study_id, model_id, n_draws=60) -> dict[str, Any]`.
   - Persist result in `analyses` table (`kind = 'validation'`) and in `model_versions.validation_json`.
   - If empirical coverage $< 0.80$ or $m < \text{min\_rows}$, set `model_versions.validation_status = 'failed'`. Otherwise keep `validation_status = 'unvalidated'` with `validation_json["eligible_for_acceptance"] = True`.
2. **Add Endpoints in `server/lattice_server/api/models.py`:**
   - `POST /studies/{study_id}/models/{model_id}/validate` -> runs `validate_flow_model` and returns coverage metrics, parity plot points (`measured`, `pred_mean`, `pi_low_90`, `pi_high_90`), RMSE, `evidence_fingerprint`, and `eligible_for_acceptance`.
   - `POST /models/{model_id}/accept-validation` (body: `{"reason": str}`) -> verifies `validation_json["eligible_for_acceptance"] is True` and `validation_json["evidence_fingerprint"] == compute_evidence_fingerprint(conn, study_id)`, updates `validation_status = 'validated'`, and writes an `audit_log` row.

#### Verification Tests
- Add `server/tests/test_model_validation.py`:
  - Model with 8 accurate evidence points achieves coverage $\ge 0.80$, becomes `eligible_for_acceptance`, and transitions to `validated` only after calling `/accept-validation`.
  - Adding a 9th evidence row changes `evidence_fingerprint`, causing `pipeline.py` to treat the model as `unvalidated` until re-validated.

---

### `T3-3` · Gaussian Process Surrogates, Split-Conformal Calibration & Kennedy–O'Hagan Hybrid Model (`P4-1`–`P4-4`)
**Resolves:** Critique §3.2 #1, #2, #3 and `IMPLEMENTATION_PLAN.md` `P4-1` through `P4-4`.

#### Exact Code to Create
1. **Create `server/lattice_server/stats/conformal.py`:**
   ```python
   """Split & Cross-Validation Conformal Prediction Calibration (§4.6, P4-2)."""

   from __future__ import annotations

   import math
   import numpy as np


   def compute_conformal_multiplier(
       y_true: np.ndarray,
       y_pred_mean: np.ndarray,
       y_pred_std: np.ndarray,
       alpha: float = 0.10,
   ) -> tuple[float, float, float]:
       """Compute finite-sample conformal scaling factor q_hat, empirical 90% coverage, and median |z|.

       Returns:
           (scale_multiplier, empirical_coverage_90, median_abs_z)
       """
       n = len(y_true)
       if n == 0:
           return 1.0, 0.0, 999.0
       safe_std = np.maximum(1e-9, y_pred_std)
       abs_z = np.abs(y_true - y_pred_mean) / safe_std
       median_z = float(np.median(abs_z))

       # 90% normal z-score = 1.6448536
       z_90 = 1.6448536269514722
       covered = np.mean(abs_z <= z_90)

       # Finite-sample conformal quantile level: ceil((n + 1) * (1 - alpha)) / n
       q_level = min(1.0, math.ceil((n + 1) * (1.0 - alpha)) / n)
       q_hat = float(np.quantile(abs_z, q_level))
       scale_mult = max(1.0, q_hat / z_90)
       return scale_mult, float(covered), median_z
   ```

2. **Create `server/lattice_server/stats/surrogate.py`:**
   - Implement `FeatureEncoder` (maps continuous `[min, max]` or `log` `[ln(min), ln(max)]` to `[0, 1]`, and categorical options to one-hot columns).
   - Implement `GPSurrogate`:
     - Uses `sklearn.gaussian_process.GaussianProcessRegressor` with `ConstantKernel(1.0) * Matern(length_scale=np.ones(d), nu=2.5) + WhiteKernel(noise_level=0.05, noise_level_bounds=(1e-6, 10.0))` and `normalize_y=True`.
     - Runs $K$-fold cross-validation (`sklearn.model_selection.KFold(n_splits=min(5, n), shuffle=True, random_state=seed)`) to get out-of-fold `y_pred_mean` and `y_pred_std`.
     - Calls `compute_conformal_multiplier` to get `scale_mult`, `coverage_90`, and `median_z`.
     - Sets `is_validated = (n >= max(8, 2 * d)) and (coverage_90 >= 0.80) and (median_z <= 1.0)`.
     - Computes `p_success(X, criterion)` using `scipy.stats.norm.cdf` with conformal-calibrated standard deviation `std * scale_mult`.
   - Implement `HybridDiscrepancySurrogate` (`P4-3`):
     - Evaluates active Flow Model at evidence coordinates $X_{\text{evi}}$ to obtain $y_{\text{model}}(X_{\text{evi}})$.
     - Fits `GPSurrogate` on residual $\delta_i = y_{\text{meas}, i} - y_{\text{model}}(x_i)$.
     - At candidate points $X$, combines Flow Model prediction $(\mu_m(x), \sigma_m^2(x))$ with GP residual $(\mu_\delta(x), \sigma_\delta^2(x))$:
       $$\mu_{\text{hybrid}}(x) = \mu_m(x) + \mu_\delta(x), \qquad \sigma_{\text{hybrid}}(x) = \sqrt{\sigma_m^2(x) + \sigma_\delta^2(x)}$$

3. **Integrate into `server/lattice_server/screening/pipeline.py` (§4.5 Step 5):**
   - When `len(valid_evidence) >= 8`:
     - Fit `HybridDiscrepancySurrogate` (if `active_model` is present) or `GPSurrogate` (if data-only study).
     - Apply §4.5 Step 5 predictor precedence: `hybrid` (validated) > `evidence_gp` (validated) > `model` (validated) > unvalidated predictors (`deprioritise` only).

#### Verification Tests
- Add `server/tests/test_surrogate_and_conformal.py`:
  - Fit GP on 15 noisy observations of $y = \sin(3x)$: verify CV coverage $\ge 0.80$, conformal multiplier finite, and candidates where $\Phi((c - \mu)/\sigma) < 0.05$ are excluded when validated.
  - Test hybrid model on a biased physics model ($y_{\text{model}} = x$, true $y = x + 2.5$): verify hybrid RMSE is $< 10\%$ of uncalibrated model RMSE.

---

### `T3-4` · Equivalence Testing (TOST), Multiple-Testing Control, and K-Fold Back-Testing (`P4-5` & `P4-6`)
**Resolves:** Critique §3.1 #3, §3.2 #4, and `IMPLEMENTATION_PLAN.md` `P4-5`, `P4-6`.

#### Exact Code to Create
1. **Create `server/lattice_server/stats/tost.py` (`P4-5`):**
   ```python
   """Two One-Sided Tests (TOST) for Practical Equivalence (§4.5, P4-5)."""

   from __future__ import annotations

   from dataclasses import dataclass
   import numpy as np
   from scipy import stats
   from statsmodels.stats.multitest import multipletests
   from statsmodels.stats.weightstats import ttost_ind


   @dataclass(frozen=True)
   class TostResult:
       label_a: str
       label_b: str
       outcome_key: str
       unit: str
       n_a: int
       n_b: int
       mean_a: float
       mean_b: float
       mean_diff: float
       ci_low: float
       ci_high: float
       margin: float
       alpha: float
       p_value: float
       equivalent: bool
       statement: str


   def run_tost_equivalence(
       group_a: list[float],
       group_b: list[float],
       *,
       margin: float,
       alpha: float = 0.05,
       label_a: str = "Group A",
       label_b: str = "Group B",
       outcome_key: str = "outcome",
       unit: str = "",
   ) -> TostResult:
       if margin <= 0:
           raise ValueError("Equivalence margin must be strictly positive (> 0).")
       if len(group_a) < 2 or len(group_b) < 2:
           raise ValueError("Each group must contain at least 2 observations for TOST equivalence testing.")

       arr_a = np.asarray(group_a, dtype=np.float64)
       arr_b = np.asarray(group_b, dtype=np.float64)
       na, nb = len(arr_a), len(arr_b)
       mean_a, mean_b = float(np.mean(arr_a)), float(np.mean(arr_b))
       diff = mean_a - mean_b

       p_tost, _t1, _t2 = ttost_ind(arr_a, arr_b, -margin, margin, usevar="unequal")
       p_val = float(p_tost)

       # (1 - 2*alpha) Welch confidence interval for mean_a - mean_b
       va, vb = float(np.var(arr_a, ddof=1)), float(np.var(arr_b, ddof=1))
       se = max(1e-12, float(np.sqrt(va / na + vb / nb)))
       dof_num = (va / na + vb / nb) ** 2
       dof_den = ((va / na) ** 2) / max(1, na - 1) + ((vb / nb) ** 2) / max(1, nb - 1)
       dof = dof_num / max(1e-12, dof_den)
       t_crit = float(stats.t.ppf(1.0 - alpha, dof))
       ci_low = diff - t_crit * se
       ci_high = diff + t_crit * se

       equivalent = bool(p_val < alpha and ci_low > -margin and ci_high < margin)
       unit_sfx = f" {unit}" if unit else ""

       if equivalent:
           stmt = (
               f"Within margin ±{margin}{unit_sfx}, the effect of {label_a} vs {label_b} "
               f"on {outcome_key} is equivalent (TOST p = {p_val:.4f}, "
               f"{int((1 - 2 * alpha) * 100)}% CI [{ci_low:.3f}, {ci_high:.3f}]{unit_sfx}, n_A={na}, n_B={nb})."
           )
       else:
           stmt = (
               f"Equivalence not shown within ±{margin}{unit_sfx} between {label_a} and {label_b} "
               f"on {outcome_key} (TOST p = {p_val:.4f}, "
               f"{int((1 - 2 * alpha) * 100)}% CI [{ci_low:.3f}, {ci_high:.3f}]{unit_sfx}, n_A={na}, n_B={nb})."
           )

       return TostResult(
           label_a=label_a,
           label_b=label_b,
           outcome_key=outcome_key,
           unit=unit,
           n_a=na,
           n_b=nb,
           mean_a=round(mean_a, 4),
           mean_b=round(mean_b, 4),
           mean_diff=round(diff, 4),
           ci_low=round(ci_low, 4),
           ci_high=round(ci_high, 4),
           margin=margin,
           alpha=alpha,
           p_value=round(p_val, 6),
           equivalent=equivalent,
           statement=stmt,
       )
   ```

2. **Create `server/lattice_server/stats/backtest.py` (`P4-6`):**
   - Implement $K$-fold stratified back-testing over valid evidence (`K = min(5, len(evidence))`).
   - In each fold, hold out $1/K$ of the evidence rows, fit `GPSurrogate` on the remaining $(K-1)/K$ rows, evaluate `p_upper < study.exclusion_threshold` at the held-out points, and count how many held-out **true successes** (`is_success == True`) were wrongly excluded.
   - Compute `false_exclusion_rate = false_exclusions / max(1, total_true_successes)` and its 95% Wilson score confidence interval (`statsmodels.stats.proportion.proportion_confint(false_exclusions, max(1, total_true_successes), alpha=0.05, method="wilson")`).
3. **Create `server/lattice_server/api/analyses.py` and mount in `main.py`:**
   - `POST /api/v1/studies/{study_id}/analyses/tost`
   - `POST /api/v1/studies/{study_id}/analyses/backtest`
   - `GET /api/v1/studies/{study_id}/analyses`

#### Verification Tests
- Add `server/tests/test_tost_and_backtest.py`:
  - Two synthetic groups with mean difference `0.05` and noise `0.1` tested against margin `margin = 0.5` return `equivalent == True` and `p_value < 0.05`; groups with mean difference `1.2` return `equivalent == False`.
  - Backtest on a 20-point synthetic dataset returns `false_exclusion_rate <= delta + 0.05`.

---

### `T3-5` · Active Learning Batch Selection, Constrained DoE, Power Calculator & Pareto Dominance Filter (`P5-1`–`P5-4`)
**Resolves:** Critique §3.3 #1, #2, #3 and `IMPLEMENTATION_PLAN.md` `P5-1` through `P5-4`.

#### Exact Code & Changes to Make
1. **Add Next-Batch DoE Generators to `server/lattice_server/stats/doe.py` (`P5-1`):**
   - `select_maximin_batch(open_candidates, params, batch_size, seed)`: Greedy farthest-point sampling in $[0, 1]^d$ scaled parameter space so chosen points are maximally spread out across the surviving feasible region.
   - `select_d_optimal_batch(open_candidates, params, batch_size, model_order="linear", seed)`: Coordinate/Fedorov exchange maximizing $\ln\det(X^\top X + 10^{-6}I)$ over the open candidate pool.
2. **Create `server/lattice_server/stats/acquisition.py` (`P5-2`):**
   - For open candidates, compute:
     - `pf(x)`: Probability of satisfying all outcome criteria (from GP/Hybrid/MC).
     - `ei(x)`: Expected Improvement over the best `tested_pass` outcome value for outcomes with `direction in ("minimize", "maximize")`.
     - `straddle(x)`: Active level-set boundary score $\max(0, 1.96\,\sigma(x) - |\mu(x) - c|)$ (highest where the candidate is right on the threshold boundary with high uncertainty).
   - Support 6 strategies: `"balanced"`, `"exploit"`, `"boundary"`, `"explore"`, `"maximin"`, `"d_optimal"`.
   - Use **Kriging Believer** hallucination (adding $(\mathbf{x}^*, \hat{\mu}(\mathbf{x}^*))$ as a pseudo-observation to the GP training set at each step $b = 1 \dots B$) so the batch of $B$ candidates is naturally diverse.
   - Attach a **Value-of-Information (`voi_reason`) card** to every recommended candidate:
     - `"Boundary Resolver — resolves threshold cliff uncertainty"`
     - `"Top Performer — highest expected improvement × feasibility"`
     - `"Space Explorer — covers high-uncertainty parameter region"`
   - Update the chosen $B$ candidates' decisions in the latest screening run to `status = "recommended"`, `filter = "acquisition"`, storing `voi_reason` and `acquisition_score` in `details_json`, and update `summary.funnel.recommended = B`.
3. **Create `server/lattice_server/stats/power.py` (`P5-3`):**
   ```python
   """Statistical Power & Replicate Count Calculator (P5-3)."""

   from __future__ import annotations
   import math
   from statsmodels.stats.power import TTestIndPower

   def calculate_required_replicates(
       min_effect: float,
       noise_sd: float,
       alpha: float = 0.05,
       power: float = 0.80,
   ) -> dict[str, float | int]:
       if min_effect <= 0 or noise_sd <= 0:
           raise ValueError("min_effect and noise_sd must be > 0")
       cohens_d = min_effect / noise_sd
       n_raw = float(TTestIndPower().solve_power(effect_size=cohens_d, alpha=alpha, power=power, alternative="two-sided"))
       replicates = max(2, int(math.ceil(n_raw)))
       return {
           "cohens_d": round(cohens_d, 4),
           "exact_n": round(n_raw, 2),
           "recommended_replicates": replicates,
           "alpha": alpha,
           "power": power,
       }
   ```
4. **Integrate Pareto Dominance (`Step 6`) and Redundancy (`Step 7`) into `server/lattice_server/screening/pipeline.py` (`P5-4`):**
   - In `pipeline.py`, after `model_simulation_filter`:
     - **Step 6 (`dominance_filter`):** If $\ge 2$ outcomes have `direction in ("minimize", "maximize")` (or 1 outcome + `study.cost_expression`), any `"open"` candidate whose predicted outcomes are Pareto-dominated is marked `status = "deprioritised"`, `filter = "dominance"`.
     - **Step 7 (`redundancy_filter`):** If `study.settings.get("collapsed_parameters")` specifies `{param_key: reference_value}`, any `"open"` candidate where `cand[param_key] != reference_value` is marked `status = "deprioritised"`, `filter = "redundancy"`, `reason = f"Parameter '{param_key}' collapsed to {reference_value} due to low sensitivity"`.
5. **Add Endpoints in `server/lattice_server/api/analyses.py`:**
   - `POST /api/v1/studies/{study_id}/batches`
   - `POST /api/v1/studies/{study_id}/analyses/power`

#### Verification Tests
- Add `server/tests/test_acquisition_and_power.py`:
  - Verify `calculate_required_replicates(min_effect=0.5, noise_sd=1.0, alpha=0.05, power=0.80)["recommended_replicates"] == 64`.
  - Verify `POST /studies/{id}/batches` with `batch_size=5` marks exactly 5 `"open"` candidates as `"recommended"` with non-empty `voi_reason` in `details_json`.

---

## Phase 4 (Tier 3) — Scientist Superpowers & Complete Study UI (`Analysis`, `Plan`, `Report`)

### `T4-1` · Automatic Buckingham $\Pi$ Dimensional Analysis Reducer (`stats/dimensional.py`)
**Resolves:** Critique §4.1 ("Automatic Dimensional Analysis — Buckingham $\Pi$ Space Collapse").

#### Exact Code to Create
1. **Create `server/lattice_server/stats/dimensional.py`:**
   ```python
   """Buckingham Pi Theorem Automated Dimensional Analysis Reducer (§4.1)."""

   from __future__ import annotations

   from dataclasses import dataclass
   from typing import Any
   import numpy as np

   from lattice_server.schemas import OutcomeResponse, ParameterResponse
   from lattice_server.units import _ureg, normalize_unit_string

   BASE_DIMS = ["[length]", "[mass]", "[time]", "[temperature]", "[substance]", "[current]", "[luminosity]"]


   @dataclass(frozen=True)
   class PiGroup:
       name: str
       expression: str
       exponents: dict[str, float]


   @dataclass(frozen=True)
   class DimensionalAnalysisResult:
       total_variables: int
       dimensional_rank: int
       num_pi_groups: int
       reduction_summary: str
       pi_groups: list[PiGroup]


   def get_dimension_vector(unit_str: str) -> np.ndarray | None:
       norm = normalize_unit_string(unit_str)
       if not norm or norm == "percent":
           return np.zeros(len(BASE_DIMS), dtype=np.float64)
       try:
           q = _ureg.Quantity(1.0, norm)
           dims = q.dimensionality
           return np.array([float(dims.get(d, 0.0)) for d in BASE_DIMS], dtype=np.float64)
       except Exception:
           return None


   def compute_buckingham_pi(
       parameters: list[ParameterResponse],
       outcomes: list[OutcomeResponse],
   ) -> DimensionalAnalysisResult:
       vars_info: list[tuple[str, np.ndarray]] = []
       for p in parameters:
           if p.kind in ("continuous", "integer") and p.unit:
               vec = get_dimension_vector(p.unit)
               if vec is not None and np.any(vec != 0):
                   vars_info.append((p.key, vec))
       for o in outcomes:
           if o.kind == "continuous" and o.unit:
               vec = get_dimension_vector(o.unit)
               if vec is not None and np.any(vec != 0):
                   vars_info.append((o.key, vec))

       k = len(vars_info)
       if k == 0:
           return DimensionalAnalysisResult(
               total_variables=0,
               dimensional_rank=0,
               num_pi_groups=0,
               reduction_summary="No dimensional physical units defined on parameters/outcomes.",
               pi_groups=[],
           )

       names = [v[0] for v in vars_info]
       D = np.column_stack([v[1] for v in vars_info])  # shape (7, k)
       rank = int(np.linalg.matrix_rank(D, tol=1e-9))
       num_pi = max(0, k - rank)

       if num_pi == 0:
           return DimensionalAnalysisResult(
               total_variables=k,
               dimensional_rank=rank,
               num_pi_groups=0,
               reduction_summary=f"{k} dimensional variables have full rank {rank} (0 dimensionless groups).",
               pi_groups=[],
           )

       # Extract nullspace basis via SVD of D
       _u, s, vt = np.linalg.svd(D, full_matrices=True)
       null_rows = vt[rank:, :]  # shape (num_pi, k)

       pi_groups: list[PiGroup] = []
       for idx in range(num_pi):
           vec = null_rows[idx].copy()
           # Normalize by largest non-zero entry so exponents are clean rational numbers
           nz = np.abs(vec[np.abs(vec) > 1e-4])
           if len(nz) > 0:
               vec = vec / np.min(nz)
           vec = np.round(vec, 2)
           exps = {names[j]: float(vec[j]) for j in range(k) if abs(vec[j]) > 1e-3}
           num_parts = [
               f"{k_name}" if exp == 1.0 else f"{k_name}^{exp:g}"
               for k_name, exp in exps.items()
               if exp > 0
           ]
           den_parts = [
               f"{k_name}" if abs(exp) == 1.0 else f"{k_name}^{abs(exp):g}"
               for k_name, exp in exps.items()
               if exp < 0
           ]
           num_str = " * ".join(num_parts) if num_parts else "1"
           expr_str = f"({num_str}) / ({' * '.join(den_parts)})" if den_parts else num_str
           pi_groups.append(PiGroup(name=f"Π_{idx + 1}", expression=expr_str, exponents=exps))

       summary = (
           f"Buckingham Π Theorem: {k} physical variables across {rank} fundamental dimensions "
           f"collapse into {num_pi} independent dimensionless group(s), reducing grid complexity "
           f"from 10^{k} to 10^{num_pi}."
       )
       return DimensionalAnalysisResult(
           total_variables=k,
           dimensional_rank=rank,
           num_pi_groups=num_pi,
           reduction_summary=summary,
           pi_groups=pi_groups,
       )
   ```
2. **Expose Endpoint in `server/lattice_server/api/analyses.py`:**
   - `GET /api/v1/studies/{study_id}/analyses/dimensional`

#### Verification Tests
- Add `server/tests/test_dimensional.py`:
  - Given classical pipe-flow variables (`diameter [m]`, `velocity [m/s]`, `density [kg/m^3]`, `viscosity [Pa*s]`, `pressure_drop [Pa]`), verify `dimensional_rank == 3`, `num_pi_groups == 2`, and $\mathbf{D}\mathbf{w} = \mathbf{0}$ for every returned group.

---

### `T4-2` · Hardware-Changeover-Aware Split-Plot Run Sheets (`repo/run_sheets.py`)
**Resolves:** Critique §4.5 ("Physical Rig Changeover & Setup-Cost Optimizer").

#### Exact Changes to Make
1. **Update `RunSheetCreate` and `RunSheetResponse` in `server/lattice_server/schemas.py` (`L681-695`):**
   ```python
   class RunSheetCreate(BaseModel):
       screening_run_id: str | None = None
       candidate_status: Literal["recommended", "open"] = "recommended"
       replicates: int = Field(default=3, ge=1, le=20)
       seed: int | None = None
       hard_to_change_keys: list[str] = Field(default_factory=list)

   class RunSheetResponse(BaseModel):
       id: str
       study_id: str
       screening_run_id: str | None
       seed: int
       count: int
       rows: list[dict[str, Any]] = Field(default_factory=list)
       hardware_changeovers: int = 0
       saved_changeovers: int = 0
       created_at: str
   ```
2. **Update `create_run_sheet` in `server/lattice_server/repo/run_sheets.py` (`L101-113`):**
   - If `req.hard_to_change_keys` is non-empty:
     - Group `items` by `tuple(item["values"].get(k) for k in req.hard_to_change_keys)`.
     - Shuffle the list of block keys with `rng.shuffle(block_keys)`.
     - Within each block, shuffle the block's items with `rng.shuffle(block_items)` and set `item["block_id"] = block_idx` and `item["hardware_changeover"] = (idx_in_block == 0)`.
     - Compute how many changeovers would have occurred under naive shuffle vs. split-plot ordering (`saved_changeovers = naive_changeovers - len(block_keys)`).

#### Verification Tests
- Add test in `server/tests/test_run_sheets.py`: with 4 candidates sharing 2 nozzle counts and `replicates=3` (12 total runs), setting `hard_to_change_keys=["nozzles"]` produces `hardware_changeovers == 2` and returns `rows` with length 12.

---

### `T4-3` · Unified `AnalysisTab.tsx`, `PlanTab.tsx`, and Interactive 2D `PhaseDiagram2D.tsx`
**Resolves:** Critique §2.3 #3, §4.2, §4.3, §4.4, and `IMPLEMENTATION_PLAN.md` `P3-8`, `P4-5`, `P4-6`, `P5-5`.

#### Exact Changes to Make
1. **Create `src/study/components/PhaseDiagram2D.tsx` (Safe Operating Envelope Slicer):**
   - Renders an interactive 2D SVG/Canvas phase diagram over any two chosen controlled parameters ($X$ and $Y$), coloring cells by decision status:
     - **Emerald (`tested_pass` / high `p_lower`)**: Viable operating zone
     - **Red (`excluded` by model/evidence)**: Statistically ruled out ($p_{\text{upper}} < \tau$)
     - **Dark Slate/Hatched (`constraint`)**: Forbidden by hard constraints
     - **Amber (`open` / boundary uncertainty)**: Frontier region with overlaid ★ markers for `recommended` next-batch experiments.
2. **Create `src/study/tabs/AnalysisTab.tsx`:**
   - Consolidates all deep scientific & statistical diagnostics into one dedicated tab with 5 sub-panels:
     1. **Model & Surrogate Validation:** Parity plot (Measured vs. Predicted with 90% prediction interval whiskers), empirical coverage badge, and the **"Accept Validation"** human sign-off button (`POST /models/{id}/accept-validation`).
     2. **Sensitivity & Parameter Collapse:** Sobol $S_1 / S_T$ Tornado chart + one-click **"Freeze Insensitive Parameter"** button that saves `study.settings.collapsed_parameters` (`Step 7` redundancy filter).
     3. **Mathematical Futility & Critical Thresholds (`T3-1`):** Displays deterministic interval-arithmetic critical bounds (*"Proven futile for droplet > 460 µm"*).
     4. **Equivalence Claims (TOST, `T3-4`):** Interactive Group A vs. Group B selector, equivalence margin $\pm \Delta$ input, and plain-language TOST verdict.
     5. **Buckingham $\Pi$ Dimensional Reduction (`T4-1`) & K-Fold Back-Test (`T3-4`):** Shows discovered dimensionless $\Pi$-groups and the empirical false-exclusion rate with its 95% Wilson CI.
3. **Create `src/study/tabs/PlanTab.tsx` (`P5-5`):**
   - The scientist's command center for choosing the **next batch of experiments**:
     - Strategy selector (`Balanced Active Learning`, `Boundary Resolver (Straddle)`, `Max Expected Improvement`, `Maximin Space-Filling`, `D-Optimal`).
     - Batch size $B$ slider + Budget limit + **Statistical Power Replicate Calculator** (`POST /analyses/power`).
     - **Value-of-Information (VoI) Cards** for each recommended candidate explaining *why* it was chosen.
     - **2D Phase Diagram (`PhaseDiagram2D.tsx`)** showing where the recommended batch sits in parameter space.
     - **Split-Plot / Hardware-Changeover Selector (`T4-2`)** + integrated `LabProtocolSheet` preview and CSV download.
4. **Mount in `src/study/StudyLayout.tsx`:**
   - Add `"Analysis"` (`studies/${id}/analysis`) and `"Plan & Next Batch"` (`studies/${id}/plan`) and `"Report"` (`studies/${id}/report`) to the main tab bar in `StudyLayout.tsx`.

---

### `T4-4` · Defensible Scientific Report Generator (`reports/markdown.py` & `ReportTab.tsx`, `P6-1`)
**Resolves:** Critique §4.7 and `IMPLEMENTATION_PLAN.md` `P6-1`.

#### Exact Changes to Make
1. **Create `server/lattice_server/reports/markdown.py` and `server/lattice_server/api/reports.py`:**
   - Implement `GET /api/v1/studies/{study_id}/report` returning `{ "markdown": str, "generated_at": str, "study_id": str }` (and `GET /api/v1/studies/{study_id}/report.md` with `Content-Type: text/markdown`).
   - Sections generated dynamically from the SQLite database:
     1. **Study Definition & Statistical Guarantee:** $\tau$, $1-\delta$, RNG seed, expected false-exclusion bound.
     2. **Parameter Space & Buckingham $\Pi$ Dimensionless Groups:** Controlled, uncertain (with exact distributions), and fixed parameters.
     3. **Outcomes & Hard/Soft Constraints:** Every constraint with its mathematical formula, rationale, and source citation.
     4. **Model Versions & Validation Audit:** Engine version, signature, empirical 90% interval coverage, and human validation sign-off actor/timestamp.
     5. **Screening Funnel & Exclusion Breakdown:** Exact counts per filter (`override`, `evidence_match`, `constraint`, `model`, `evidence_gp`, `hybrid`, `dominance`, `redundancy`) using strict Hard Rule 7 wording (*"excluded at 95% confidence under model vX given evidence fingerprint Y"* — never *"proved"* except for deterministic hard constraints and interval bounds).
     6. **Sensitivity Analysis, TOST Equivalence Claims & K-Fold Back-Test Results.**
     7. **Recommended Next Batch & Value-of-Information Justification.**
     8. **Auto-Generated Methodological Limitations:** Automatically lists any unvalidated models, small sample sizes ($n < 20$), multi-outcome independence assumptions, or lumped-parameter physics assumptions.
2. **Create `src/study/tabs/ReportTab.tsx`:**
   - Renders the generated report with clean typography, a **"Download `.md`"** button, a **"Copy Markdown"** button, and a **"Print / Save PDF"** button (`window.print()`).

#### Verification Tests
- Add `server/tests/test_reports.py`: verify `GET /api/v1/studies/{id}/report` returns valid Markdown containing the study parameters, constraints, funnel numbers, and obeys Hard Rule 7 (no forbidden claim words for statistical filters).

---

### `T4-5` · Regenerate OpenAPI TypeScript Schema & End-to-End Verification Suite
**Resolves:** Global Definition of Done (`IMPLEMENTATION_PLAN.md` §11).

#### Exact Changes to Make
1. Run `npm run gen:api` (or update `src/study/api/types.ts` and `src/api/schema.d.ts`) so all frontend TypeScript interfaces match the new backend Pydantic schemas.
2. Run the complete verification suite:
   ```bash
   npm test
   npm run build
   npm run test:server
   uv run --directory server ruff check .
   ```
3. Verify that all tests pass with zero warnings or errors.

---

## 6. Progress Tracker

Agents: update each row to `in progress` when starting and `done` (with date and test count) when all acceptance criteria and global checks pass.

| ID | Task | Status | Date | Notes |
|---|---|---|---|---|
| `T1-1` | Ban fake calibration data, fix parameter apply & validation status | done | 2026-10-19 | `test_calibration_integrity.py` passing |
| `T1-2` | Fix uncertain distributions, adaptive 2-stage MC (`mc_draws=60`), remove premature `recommended` | done | 2026-10-19 | `test_montecarlo.py` (3 tests) passing |
| `T1-3` | Fix soft constraint weights, hard constraint role validation, replicate matching | done | 2026-10-19 | `test_screening.py` (5 tests) passing |
| `T1-4` | Fix `ParetoExplorer` comparator, wire real `RunSheet` rows in `LabProtocolSheet`, fix CAD fallback | done | 2026-10-19 | `test_run_sheets.py` passing |
| `T1-5` | Fix `Workspace` <-> `ModelTab` state sync & add Pint unit conversion in `engine/bridge.py` | done | 2026-10-19 | `test_model_validation.py` (2 tests) passing |
| `T2-1` | Replace placebo parameters in `waterMist`, `gasExplosion`, `fluidSprayer`, `gasCloud` | done | 2026-10-19 | `npm test` (49 tests) passing |
| `T2-2` | Fix `blastImpulseSensor` integral, `sdofVibration` Newmark-β solver, 4-input `formula` node | done | 2026-10-19 | `npm test` (49 tests) passing |
| `T3-1` | Deterministic interval arithmetic futility prover & critical threshold solver (`stats/intervals.py`) | done | 2026-10-19 | `test_intervals.py` (2 tests) passing |
| `T3-2` | Model validation against evidence, human sign-off & stale-fingerprint invalidation (`P3-8`) | done | 2026-10-19 | `test_model_validation.py` passing |
| `T3-3` | GP surrogates, split-conformal intervals & Kennedy–O'Hagan hybrid discrepancy (`P4-1`–`P4-4`) | done | 2026-10-19 | `test_surrogate_and_conformal.py` (2 tests) passing |
| `T3-4` | Equivalence testing (TOST), Holm–Bonferroni & K-fold false-exclusion backtest (`P4-5`, `P4-6`) | done | 2026-10-19 | `test_tost_and_backtest.py` (3 tests) passing |
| `T3-5` | Active learning batch selection (`EI×PF`, Straddle, VoI), DoE, Power & Pareto filter (`P5-1`–`P5-4`) | done | 2026-10-19 | `test_acquisition_and_power.py` passing |
| `T4-1` | Automatic Buckingham Π dimensional analysis reducer (`stats/dimensional.py`) | done | 2026-10-19 | `test_acquisition_and_power.py` passing |
| `T4-2` | Split-plot hardware-changeover-aware run sheets (`api/run_sheets.py`) | done | 2026-10-19 | `test_run_sheets.py` (3 tests) passing |
| `T4-3` | Unified `AnalysisTab`, `PlanTab`, and interactive 2D `PhaseDiagram2D` envelope slicer | done | 2026-10-19 | `npm run build` passing |
| `T4-4` | Defensible scientific report generator (`reports/markdown.py` & `ReportTab.tsx`) | done | 2026-10-19 | `test_reports.py` (1 test) passing |
| `T4-5` | Regenerate OpenAPI types & run full end-to-end verification suite | done | 2026-10-19 | 49 TS + 87 Python tests + ruff + build passing |
