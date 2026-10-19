# Lattice Lab — Comprehensive Scientific & Developer Critique

> **Perspective:** Dual-hat evaluation as a **Principal Experimental Scientist** (evaluating utility, statistical validity, physical realism, and lab ergonomics) and a **Principal Systems Architect / Developer** (auditing code correctness, mathematical implementation, state management, and UX).

---

## 1. Executive Verdict: The Vision vs. The Reality Today

### Why the Premise is Brilliant
The core value proposition of **Lattice Lab**—helping a scientist go from *"I have an idea with 10,000 possible experimental combinations"* to *"9,400 are mathematically or statistically ruled out with bounded risk, and these 18 experiments will give the maximum information per dollar"*—is **genuinely high-value**.

Most tools fall into one of two extremes:
1. **Heavy Physics Solvers (COMSOL, ANSYS Fluent, OpenFOAM):** Take days to set up a single geometry, ignore historical lab data, and do not tell you which experiment to run next.
2. **Classical DoE Software (JMP, Design-Expert, Minitab):** Disconnected from physics models, awkward at handling non-linear feasibility constraints, and weak at sequential Bayesian elimination.

By combining **deterministic hard constraints**, **fast low-order physics/formula graphs**, **immutable lab evidence**, **probabilistic exclusion bounds**, and **sequential active learning**, Lattice Lab targets a real, underserved gap in R&D.

### The Honest Reality Check Today
If a domain scientist (in blast mitigation, chemical engineering, thermal management, or pharmacology) sat down to use Lattice Lab **as it exists in the codebase right now**, they would be impressed for the first 5 minutes—and then **hit a wall of broken math, theatrical physics, and silent mock data within 15 minutes**:

1. **Statistical exclusions literally cannot fire under default settings** (`mc_draws = 5` makes the 95% Clopper–Pearson upper bound $p_{\text{upper}} \ge 0.4507$, which can never drop below $\tau = 0.05$).
2. **Several physical sliders in the flagship demos are "placebo controls"** that change 3D visuals but are completely ignored by the underlying math (`droplet`, `flow`, and `nozzles` in `waterMist`; `fuel` and `fuelMass` in `gasExplosion`).
3. **The "Auto-Calibrate" feature violates Hard Rule #1 and #6:** if no lab evidence exists, it **silently invents 3 fake data points**, claims calibration succeeded, fails to write the calibrated parameter back to the model, and stamps the model as `"validated"`.
4. **The Bench Protocol sheet and CAD exporter render hardcoded mock data** (`CAND-103..124` and a 5-fin microchannel cold plate) regardless of what study the scientist is actually running.

Below is the complete, unvarnished breakdown of **where the app fails today**, **what core scientific functionality is missing**, **where the UX is cumbersome**, and **what features would make Lattice Lab a category-defining scientific tool**.

---

## 2. Where Lattice Lab Currently Fails (Code & Math Audit)

### 2.1 Scientific Integrity & Statistical Bugs (Where the Math Lies or Fails)

#### 1. The `mc_draws = 5` Clopper–Pearson Trap (Statistical Exclusion Never Fires)
- **Where:** [`src/study/tabs/OverviewTab.tsx`](../src/study/tabs/OverviewTab.tsx#L50), [`server/lattice_server/screening/pipeline.py`](../server/lattice_server/screening/pipeline.py#L548), [`server/lattice_server/stats/montecarlo.py`](../server/lattice_server/stats/montecarlo.py#L194-L211), [`server/lattice_server/stats/bounds.py`](../server/lattice_server/stats/bounds.py#L9-L23).
- **The Flaw:** To rule out a candidate at confidence $1 - \delta = 0.95$ with threshold $\tau = 0.05$, the one-sided Clopper–Pearson upper bound for $k = 0$ successes in $n$ Monte Carlo trials is:
  $$p_{\text{upper}}(0, n) = 1 - \delta^{1/n} = 1 - (0.05)^{1/n}$$
  For $p_{\text{upper}} < 0.05$, you mathematically require:
  $$n > \frac{\ln(0.05)}{\ln(0.95)} \approx 58.4 \implies n \ge 59 \text{ clean draws}$$
  Yet both the frontend (`OverviewTab.tsx:50`) and backend (`pipeline.py:548`) default `mc_draws` to **`5`**, where even $k = 0$ successes yields $p_{\text{upper}} = 0.4507 \not< 0.05$.
- **Impact:** A scientist validates their model, clicks **"Run Screening"**, and gets **zero statistical exclusions**—with no UI warning explaining that `mc_draws = 5` is mathematically incapable of excluding anything at 95% confidence. Furthermore, adaptive two-stage sampling (rounds of 20 up to 200 with early stopping when $p_{\text{upper}} < \tau$ or $p_{\text{lower}} > \tau$) was never implemented.

#### 2. Fabricated Evidence & Broken Model Calibration (Violates Hard Rules #1 and #6)
- **Where:** [`server/lattice_server/api/calibration.py`](../server/lattice_server/api/calibration.py#L81-L186), [`src/study/components/CalibrationWizard.tsx`](../src/study/components/CalibrationWizard.tsx).
- **The Flaws:**
  1. **Silent Data Fabrication (`calibration.py:81-106`):** If a scientist runs "Auto-Calibrate" when no matching physical evidence exists, the server **fabricates 3 synthetic observations** (`base_measured`, `base_measured + 0.12`, `base_measured - 0.09` evaluated at `0.42` of the parameter bounds) and tells the user it converged across `n_evidence_points: 3`.
  2. **No-Op Parameter Apply (`calibration.py:167-180`):** When the user clicks **"Apply & Upgrade Model Version"**, `apply_calibrated_model` deep-copies `latest_model.project` (`L168`) **without ever writing `req.calibrated_value` into the target node field**! The "upgraded" model version is identical to the old uncalibrated one.
  3. **Illegal Auto-Validation (`calibration.py:182-186`):** Immediately after creating that unchanged model version, it executes `UPDATE model_versions SET validation_status = 'validated'`, bypassing all empirical interval coverage checks ($\ge 8$ evidence rows, $\ge 80\%$ coverage of 90% prediction intervals).

#### 3. Unvalidated Models Prematurely Marking Candidates `"recommended"`
- **Where:** [`server/lattice_server/stats/montecarlo.py`](../server/lattice_server/stats/montecarlo.py#L212-L217).
- **The Flaw:** Any candidate with $\hat{p} \ge 0.70$ in Monte Carlo simulation is immediately marked `status = "recommended"`—even if the model is **unvalidated**, and without running any Design of Experiments (DoE), Pareto dominance, or active-learning batch selection. If 800 grid points have $\hat{p} \ge 0.70$, all 800 are marked `"recommended"`.

#### 4. Broken Uncertain Parameter Distributions
- **Where:** [`server/lattice_server/stats/montecarlo.py`](../server/lattice_server/stats/montecarlo.py#L39-L66).
- **The Flaw:** While the UI and schema allow uncertain parameters to have `uniform`, `normal`, `lognormal`, `triangular`, or `discrete` distributions, `sample_uncertain_parameter()` only implements `normal` (`L46`) and **silently falls back to `rng.uniform(min_v, max_v)` for `lognormal`, `triangular`, and `discrete`**! In fields like aerosol physics (`droplet` size is log-normal) or pharmacology (IC50 / dose is log-normal), silently replacing a log-normal distribution with a linear uniform distribution invalidates the Monte Carlo results.

#### 5. Soft Constraint Weights, Evidence Replicates, and False-Exclusion Bounds
- **Soft constraint weights ignored (`pipeline.py:312, 362`):** Violating a soft constraint always adds `1.0` instead of `_constraint.penalty`.
- **Replicate evidence ignored (`pipeline.py:393`):** When matching lab evidence to candidates, the loop breaks on the first matching row rather than aggregating replicates (e.g., majority pass/fail or confidence interval over replicates).
- **Hardcoded `expected_false_exclusions_bound = 0.0` (`pipeline.py:654`):** Never computes the actual per-candidate or family-wise false-exclusion risk bound.

#### 6. Pareto Frontier Sorting Bug
- **Where:** [`src/study/components/ParetoExplorer.tsx`](../src/study/components/ParetoExplorer.tsx#L100-L103).
- **The Flaw:** Sorts the Pareto frontier points using `(a.outcomes[xKey] ?? 0) - (b.outcomes[yKey] ?? 0)` (subtracting outcome **Y** of point B from outcome **X** of point A!). Whenever X and Y have different units/scales (e.g., Temperature in °C vs. Pressure Drop in Pa), the Pareto line zig-zags randomly across the chart.

#### 7. Hardcoded Mock Data in Bench Protocol & CAD Exporter
- **Where:** [`src/study/components/LabProtocolSheet.tsx`](../src/study/components/LabProtocolSheet.tsx#L277-L405) and [`src/study/tabs/CandidatesTab.tsx`](../src/study/tabs/CandidatesTab.tsx#L96-L135).
- **The Flaw:** Opening the Bench Protocol view in **any** study (even a drug screen or tunnel blast study) renders a hardcoded microchannel cold-plate checklist (*"Thermocouple calibrated"*, *"TIM 50µm applied"*) and 8 fake rows (`CAND-103` to `CAND-124`) instead of reading `activeRunSheet.rows`. Similarly, clicking "Export CAD" on a candidate in `CandidatesTab.tsx` ignores the candidate's actual parameter values and generates a hardcoded 5-fin heatsink.

---

### 2.2 The "Theatrical Physics" Problem in the Flow & 3D Engine

A scientist who opens the Flow Studio expects either (a) honest low-order analytical/lumped-parameter physics or (b) clear warnings when a parameter is purely visual. Currently, the engine mixes real equations with ignored parameters:

1. **Placebo Parameters in Scene Events ([`src/core/scene-events.ts`](../src/core/scene-events.ts)):**
   - **`waterMist` (`L114-147`):** Exposes `flow` (L/min), `droplet` (µm), `nozzles`, `angle` (deg), and `fallSpeed` (m/s). **None of these are read in `effect()` (`L141-146`)**—pressure attenuation is simply `weight * (reduction / 100) * fill`. If a scientist binds `droplet` or `flow` in a Study to optimize water mist mitigation, **every single candidate produces the exact same pressure curve!**
   - **`gasExplosion` (`L278-333`):** Exposes `fuel` (`Methane`, `Propane`, `Hydrogen`, `Acetylene`, `Coal Dust`) and `fuelMass` (kg). **Neither is used in `effect()` (`L311-332`)**; only the manual `overpressure` field matters.
   - **`fluidSprayer` (`L335-388`):** Ignores `flow`, `nozzles`, and `fallSpeed`.
   - **`gasCloud` (`L390-418`):** Ignores the `gas` species selector.
2. **3D Scene Geometry is 100% Decoupled from Physics ([`src/SceneEditor.tsx`](../src/SceneEditor.tsx), [`src/core/scene-events.ts`](../src/core/scene-events.ts#L472-L503)):**
   - Placing walls, baffles, tunnels, or structural columns in `SceneEditor.tsx` only draws shapes on the canvas. `applySceneEvents()` computes free-space Euclidean distance `Math.hypot(dx, dy, dz)` and never inspects `scene.objects`.
3. **Physics & Numerical Bugs in Domain Nodes ([`src/core/registry.ts`](../src/core/registry.ts), [`src/core/sensor-model.ts`](../src/core/sensor-model.ts)):**
   - **`blastImpulseSensor` (`sensor-model.ts:11, 28, 103-119`):** Blast impulse is the time integral $I(t) = \int_0^t \Delta P(\tau)\,d\tau$ ($\text{Pa}\cdot\text{s}$). Instead, `blastImpulseSensor` runs the exact same code as `pressure`, outputting instantaneous pressure in $\text{Pa}$ but mislabeling the unit as `"Pa·s"`.
   - **`sdofVibration` (`registry.ts:1616-1626`):** Integrates $m\ddot{x} + c\dot{x} + kx = F(t)$ using mixed-step velocity/position updates that become numerically unstable unless $\omega_n \Delta t \ll 1$.
   - **`dropletEvaporation` (`registry.ts:1487`):** Computes evaporated fraction as `min(0.98, 0.8 / max(0.01, tau))`—a time-independent heuristic with an arbitrary `0.8` numerator.
   - **`fftSpectrum` (`registry.ts:1740-1759`):** Uses a naive $O(N^2)$ double loop (up to $10^8$ trig operations at $N=10,000$) and stuffs frequencies (Hz) into `Signal.times` (s).
4. **Architectural Constraints Blocking Real Scientific Modeling:**
   - **No Feedback Loops Allowed (`runtime.ts:107`):** `createsCycle()` rejects any cyclic wire. As a result, the **`pidController` node (`registry.ts:1851`) cannot actually be used in a closed control loop**, and coupled dynamical systems (e.g., exothermic reactor temperature feeding back into Arrhenius reaction rate) cannot be wired.
   - **Binary-Only `formula` Node (`registry.ts:616-639`):** Because `formula` only accepts two inputs (`a` and `b`), implementing a standard 5-variable engineering correlation requires chaining 8 to 15 separate `formula` nodes into an unreadable binary tree (as seen in `skyscraper-demo.ts` and `microchannel-demo.ts`).

---

### 2.3 UX & Researcher Ergonomics (Where It Is Cumbersome to Use)

1. **The Split-Brain Storage Trap (`localStorage` vs. SQLite):**
   - The Flow Studio (`Workspace.tsx`) stores its state in browser `localStorage["lattice-studio-v3"]`, while Studies live in SQLite on the Python server.
   - If a scientist is in a Study (`ModelTab.tsx:212`) and clicks **"Edit Flow Graph in Studio"**, `Workspace.tsx` opens **whatever project was last in `localStorage`**, *not* the Study's model!
   - Even if they open the right model, tweaking a node or formula in the Studio does **not** update the Study until they click **"Link to Study"** and manually re-enter every parameter and outcome binding in `BindingDialog.tsx`.
2. **Missing Unit Conversion Across the Model Bridge:**
   - Although `pint` is used for evidence imports, [`engine/bridge.py`](../server/lattice_server/engine/bridge.py) passes Study parameter values straight into Flow node fields without unit conversion. If a scientist defines `droplet_diameter` in `mm` in the Study (`0.1 mm`) and binds it to `waterMist.droplet` which expects `µm` (`10–1000 µm`), the engine fails with a range error (`0.1 < 10`) instead of converting `0.1 mm -> 100 µm`.
3. **Hidden & Fragmented Analysis Tools:**
   - **Sensitivity Analysis (`TornadoChart.tsx`)** is hidden as a toggle button inside the `Parameters` tab (and ignores `uncertain` parameters!).
   - **Pareto Trade-off (`ParetoExplorer.tsx`)** is hidden inside the `Candidates` tab.
   - **Bench Protocol (`LabProtocolSheet.tsx`)** is hidden inside the `Evidence` tab.
   - There is no dedicated **Analysis**, **Plan (Next Batch)**, or **Report** tab as designed in `IMPLEMENTATION_PLAN.md`.
4. **High-Friction Constraint Authoring:**
   - In `ConstraintsTab.tsx`, users must type exact snake_case parameter keys from memory without autocomplete, pill tokens, live syntax checking, or dimensional consistency checking (e.g., preventing a user from adding a `Pa` variable to a `L/min` variable).

---

## 3. What Functionality Is Missing (To Fulfill the Core Scientific Promise)

To truly allow a scientist to **mathematically prove an experiment is useless beyond a threshold**, **rule out unnecessary scenarios**, and **statistically prioritize the minimum number of experiments**, the following core capabilities are currently missing:

### 3.1 Mathematical Proof of "Uselessness" (Deterministic & Statistical Futility)
Right now, Lattice Lab only has point-evaluated hard constraints on controlled inputs (`flow * nozzles <= 600`) and basic Monte Carlo sampling. A scientist needs **three distinct ways to prove a regime is useless**:

1. **Interval Arithmetic & Monotonicity Pruning (100% Mathematical Proof Over Outcomes):**
   - Suppose an outcome $Y = f(x_{\text{controlled}}, u_{\text{uncertain}})$ is evaluated via a formula or flow graph, and the success criterion is $Y < Y_{\max}$.
   - Using **Interval Arithmetic** (evaluating each node/expression over intervals $[\underline{u}, \overline{u}]$ rather than point draws), the engine can compute rigorous analytical bounds $[\underline{Y}(x), \overline{Y}(x)]$.
   - **Mathematical Proof:** If the analytical lower bound $\underline{Y}(x) > Y_{\max}$, then **no possible realization** of the uncertain parameters can ever succeed. That candidate (or entire continuous hyper-rectangle of candidates!) is **mathematically proven futile** in a single evaluation—requiring 0 Monte Carlo draws and having 0% false-exclusion risk.
2. **Threshold Boundary / Critical Value Solver ("Below X, It Cannot Work"):**
   - Scientists rarely just want a table of 5,000 excluded grid points; they want a **threshold law**: *"For any droplet diameter $> 420\ \mu\text{m}$, peak pressure cannot be reduced below $8\ \text{kPa}$ even at maximum pump flow."*
   - Missing: A 1D/2D root-finding & quantifier-elimination pass that extracts explicit **critical threshold rules** ($x_i < c_{\min}$ or $x_i > c_{\max}$) from the model and displays them as human-readable scientific boundary statements.
3. **Equivalence Testing (TOST) for "Parameter Has No Meaningful Effect":**
   - Planned in `P4-5` (`stats/tost.py`) but not yet built.
   - When lab data or Sobol sensitivity shows that changing nozzle count from 10 to 24 changes peak pressure by less than the practical noise margin $\pm \Delta$, **Two One-Sided Tests (TOST)** with Holm–Bonferroni multiplicity correction statistically establish **practical equivalence** within $\pm \Delta$, allowing the scientist to collapse that dimension and reduce the experiment matrix by $6\times$–$10\times$.
4. **Sequential Replicate Futility Stopping (Predictive Probability of Success):**
   - If a candidate requires 5 lab replicates to reach statistical power, and the first 2 replicates fail badly, should the scientist run replicates 3, 4, and 5?
   - Missing: **Bayesian Predictive Probability of Success (PPoS)** that flags in-progress candidates where $P(\text{pass criterion after } R \text{ replicates} \mid y_1, y_2) < 1\%$, saving lab consumables immediately.

### 3.2 Small-Data Machine Learning & Calibration (Phase 4)
1. **Gaussian Process (GP) Surrogates (`stats/surrogate.py`):**
   - Essential when the scientist has **no physics model** (e.g., biology, formulation chemistry, empirical materials science) or when the model is slow.
   - Needs anisotropic Matérn $\nu = 5/2$ kernels, log-transform handling, and heteroscedastic noise (using replicate variance $\sigma_i^2$ from evidence).
2. **Hybrid Physics + GP Discrepancy Modeling (Kennedy–O'Hagan):**
   - Every low-order physics model is wrong, but its *shape/trends* are often useful.
   - Fitting a GP to the residual $\delta(x) = Y_{\text{lab}}(x) - Y_{\text{model}}(x, \hat{\theta})$ combines the physical laws of the flow graph with empirical lab reality—preventing the physics model from making overconfident exclusions where it disagrees with lab measurements.
3. **Split / Cross-Conformal Prediction (`stats/conformal.py`):**
   - Gaussian Process variance assumptions can be optimistic on non-stationary lab responses. Wrapping surrogate predictions in **conformal prediction intervals** provides distribution-free, finite-sample coverage guarantees ($P(Y_{\text{new}} \in \hat{C}_{1-\alpha}(X_{\text{new}})) \ge 1 - \alpha$).
4. **Automated K-Fold Back-Testing (`stats/backtest.py`):**
   - To trust an exclusion engine, a scientist must see: *"When we hid 20% of your actual lab results and ran the screening pipeline on the remaining 80%, Lattice excluded **0% of real successes** (95% CI: 0–4.2%) while eliminating **78% of failures**."*

### 3.3 Optimal Experiment Prioritization & Batch Selection (Phase 5)
Currently, Lattice Lab has **no algorithm to pick the next batch of $B$ experiments**. It needs:
1. **Constrained Bayesian Active Learning (`stats/acquisition.py`):**
   - **Boundary Estimation (Straddle / Active Level-Set heuristic):** Pick experiments where $\mu(x) \approx \text{threshold}$ and $\sigma(x)$ is large ($|\mu(x) - c| / \sigma(x)$ is small) to rapidly lock down the exact boundary between viable and useless scenarios.
   - **Optimization + Feasibility (`EI × PF`):** Expected Improvement weighted by Probability of Feasibility across all outcome criteria.
   - **Batch Diversification (Kriging Believer / Determinantal Point Processes):** So a batch of 10 recommended experiments doesn't pick 10 nearly identical points.
2. **Classical Constrained DoE Generators (`stats/doe.py`):**
   - When starting with **zero evidence and no validated model**, the first batch of 8–16 experiments should be a **D-optimal**, **Maximin space-filling**, or **Fractional Factorial (Resolution IV/V)** subset of the *feasible* candidates (those surviving hard constraints).
3. **Statistical Power & Replicate Calculator (`stats/power.py`):**
   - Estimate measurement noise $\hat{\sigma}_{\text{noise}}$ from existing replicate evidence (or instrument spec) and compute the minimum replicate count $r$ needed to detect a minimum scientifically meaningful effect $\Delta$ at power $1 - \beta = 0.80$ and $\alpha = 0.05$.

---

## 4. Amazing Features That Would Make Lattice Lab a Game-Changer

Beyond completing the missing items in `IMPLEMENTATION_PLAN.md`, here are the high-leverage features that would make scientists fall in love with Lattice Lab:

### 4.1 Automatic Dimensional Analysis (Buckingham $\Pi$ Space Collapse)
- **Why Scientists Would Love It:** Lattice Lab already forces users to attach `pint`-validated physical units (`Pa`, `m/s`, `µm`, `kg/m^3`, `Pa*s`) to every parameter and outcome.
- **How It Works:** Using the dimensional matrix of the study's parameters (Mass $M$, Length $L$, Time $T$, Temperature $\Theta$, Amount $N$), a single linear-algebra null-space computation (Buckingham $\Pi$ theorem) can automatically discover the **dimensionless groups** governing the experiment (e.g., Reynolds number $Re$, Weber number $We$, Damköhler number $Da$, Stokes number $St$).
- **The Payoff:** Collapsing 7 dimensional variables into 3 dimensionless $\Pi$-groups shrinks a $10^7$ experiment grid down to $10^3$ **before running a single lab test**, grounded in 100% rigorous physics!

### 4.2 Interactive 2D/3D "Feasibility Phase Diagrams" (Safe Operating Envelope Slicer)
- **Why Scientists Would Love It:** Tables of 5,000 rows (`CandidatesTab.tsx`) are cognitively overwhelming. Scientists think in **phase diagrams** and **operating envelopes**.
- **How It Works:** An interactive 2D contour plot (with sliders for the remaining parameters) that colors the parameter space into four crisp zones:
  - **Green (Certified Viable):** $p_{\text{lower}}(x) \ge 1 - \delta$ (proven to work).
  - **Red Hatched (Hard-Constraint Forbidden):** Violates physical/safety/budget constraints.
  - **Crimson (Statistically Excluded):** $p_{\text{upper}}(x) < \tau$ at $95\%$ confidence.
  - **Amber Fog (High Epistemic Uncertainty — "Test Here Next"):** Where $p_{\text{lower}} < \tau < p_{\text{upper}}$, overlaid with star markers showing the recommended next batch.

### 4.3 "Why Run This Experiment?" Value-of-Information (VoI) Cards
- **Why Scientists Would Love It:** Principal Investigators and lab techs hate black-box recommendations. Every recommended experiment in a batch should have a plain-English badge and metric explaining *why* it won a slot in the batch:
  - *"🎯 **Boundary Resolver:** Expected to eliminate ~420 neighboring candidates if it fails, or confirm a new low-flow regime if it passes."*
  - *"🏆 **Top Performer Confirmation:** Highest predicted pressure reduction ($74\% \pm 6\%$) at $30\%$ lower cost than current best trial."*
  - *"🧭 **Blind-Spot Explorer:** Highest model uncertainty ($\sigma = 2.4\ \text{kPa}$) in the high-nozzle, fine-mist quadrant."*

### 4.4 Pre-Lab "Counterfactual Impact Simulator" (Expected Space Reduction)
- **Why Scientists Would Love It:** Before spending \$20,000 and two weeks in the lab running a batch of 12 experiments, a scientist wants to know: *"Is a batch of 12 enough, or can I get 90% of the elimination power with just 6 experiments?"*
- **How It Works:** A curve plotting **Batch Size ($B = 1 \dots 30$) vs. Expected Percentage of Remaining Candidates Eliminated** (computed via look-ahead GP variance reduction). The scientist can visually pick the "knee of the curve" where additional experiments yield diminishing returns.

### 4.5 Physical Rig Changeover & Setup-Cost Optimizer (Smart Run Sheets)
- **Why Scientists Would Love It:** Standard statistical software completely randomizes run order. In a real lab, **some parameters are "hard-to-change"** (e.g., swapping out 24 physical mist nozzles or synthesizing a new catalyst takes 4 hours) while **other parameters are "easy-to-change"** (e.g., turning a pump flow dial takes 10 seconds).
- **How It Works:** Allow parameters to have a `changeover_cost` / difficulty tag (`easy` vs. `hard / split-plot`). Generate **Split-Plot / Minimum-Changeover Run Sheets** that group hard-to-change hardware configurations into blocks while randomizing easy-to-change settings within each block—and accounting for block effects in the statistical analysis!

### 4.6 Multi-Input Formula Node + Coupled ODE Block in the Flow Studio
- **Why Scientists Would Love It:** Fixing the two biggest limitations of the visual flow graph would make the built-in simulator 10× more useful:
  1. **Multi-Variable `expression` Node:** Allow a single formula node to dynamically add named input ports (`P_in`, `T_amb`, `d_nozzle`, `flow`) and write `0.62 * A * sqrt(2 * P_in / rho)` in one node instead of 7 chained binary `a, b` nodes.
  2. **State / Integrator Feedback Loop (RK45 Solver):** Allow state variables ($d\mathbf{y}/dt = \mathbf{f}(\mathbf{y}, \mathbf{u}, t)$) so thermal mass, chemical batch kinetics, and closed-loop PID control can be simulated accurately over time.

### 4.7 One-Click "Reviewer #2 / Grant Defense" Markdown & PDF Dossier
- **Why Scientists Would Love It:** When a scientist publishes a paper or defends an R&D down-selection to management, they get asked: *"How do you know you didn't miss the optimal configuration in the 9,500 experiments you skipped?"*
- **How It Works:** Auto-generate a rigorous, citation-ready methodological report containing:
  - The exact exclusion funnel with reproducible hashes and RNG seeds.
  - Every hard constraint with its physical rationale and source citation.
  - Model validation parity plots (Predicted vs. Measured with 90% coverage intervals).
  - K-fold back-test proof showing the empirical false-exclusion rate vs. the theoretical $\delta$ bound.
  - TOST equivalence tables justifying why insensitive parameters were fixed.

---

## 5. Prioritized Roadmap: What to Fix & Build First

### Tier 1 — Immediate Scientific Integrity & Bug Fixes (Stop the Bleeding)
1. **Remove fake data fabrication in `server/lattice_server/api/calibration.py` (`L81-106`)** and fix `apply_calibrated_model` (`L167-186`) so it (a) requires real evidence, (b) actually writes `calibrated_value` into the bound node field of the new `ModelVersion.project`, and (c) does **not** set `validation_status = 'validated'` without running the `P3-8` coverage check.
2. **Fix the `mc_draws` default and implement Adaptive Two-Stage Monte Carlo (`stats/montecarlo.py`, `OverviewTab.tsx`):** Change default `mc_draws` from `5` to adaptive rounds of `20` up to `100` (minimum `60` for zero-success exclusion at $\tau=0.05, 1-\delta=0.95$), and warn in the UI whenever `mc_draws` is too small to mathematically cross $\tau$.
3. **Implement `lognormal`, `triangular`, and `discrete` sampling in `stats/montecarlo.py` (`L39-66`)** using `scipy.stats`.
4. **Stop marking candidates with $\hat{p} \ge 0.70$ as `"recommended"` inside `montecarlo.py` (`L212`)**; keep them `"open"` until batch selection runs.
5. **Fix the placebo physics parameters (`P3-6` and beyond) in `src/core/scene-events.ts` & `sensor-model.ts`:**
   - Implement the parametric mode in `waterMist` (`droplet`, `flow`, `nozzles`) and wire up `fuelMass`/`flow` in `gasExplosion`/`fluidSprayer` (clearly badged as *illustrative/unvalidated* until calibrated).
   - Fix `blastImpulseSensor` (`sensor-model.ts:103`) so it integrates $\int \Delta P(t)\,dt$ over time.
6. **Fix `ParetoExplorer.tsx` (`L101`)** sorting comparator (`b.outcomes[xKey]` instead of `b.outcomes[yKey]`) and wire `LabProtocolSheet.tsx` to render actual `activeRunSheet.rows` instead of hardcoded mock rows.
7. **Fix the Studio <-> Study state sync (`ModelTab.tsx`, `Workspace.tsx`)** and add **Pint unit conversion** in `engine/bridge.py` when applying parameter bindings.

### Tier 2 — Complete the Core Statistical Engine (Phases 3–5)
1. **Model & Surrogate Validation (`P3-8`, `P4-2`):** Prediction interval coverage checks ($\ge 80\%$ on 90% intervals), LOO/K-fold cross-validation, and automatic invalidation when new evidence arrives.
2. **Gaussian Process Surrogates + Conformal Prediction + Hybrid Discrepancy (`P4-1`, `P4-2`, `P4-3`, `P4-4`):** Enable data-only studies and physics-plus-residual learning.
3. **Equivalence Testing (TOST) + Back-Testing (`P4-5`, `P4-6`):** Let scientists prove negligible effects within $\pm \Delta$ and verify false-exclusion rates empirically.
4. **Batch Selection, Power Analysis & Unified `Plan` / `Analysis` / `Report` Tabs (`P5-1`..`P6-1`):** Close the active-learning loop so Lattice Lab genuinely recommends the minimal next batch of experiments.

### Tier 3 — Differentiating Scientist Superpowers
1. **Interval Arithmetic / Monotonic Bound Pruner** for 100% deterministic mathematical elimination over outcome ranges.
2. **Buckingham $\Pi$ Dimensional Collapse** using existing `pint` parameter units.
3. **Interactive 2D Feasibility Phase Diagrams** & **Value-of-Information Cards**.
4. **Multi-Variable Formula Node & Coupled ODE Solver** in the Flow Studio.
5. **Split-Plot / Hardware-Changeover-Aware Run Sheets**.

