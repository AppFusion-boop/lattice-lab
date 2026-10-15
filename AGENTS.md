# Instructions for AI Agents in Lattice Lab

Before doing any work, read the full [Implementation Plan](docs/IMPLEMENTATION_PLAN.md).

## Commands (§3.2)
- `npm install` — frontend dependencies
- `uv sync --directory server` — Python dependencies into `server/.venv`
- `npm run dev:all` — Vite (:5173) + API (:8765) concurrently
- `npm test` — TypeScript test suite (Node 20 compatible via `tsx`)
- `npm run test:server` — Python test suite (`pytest`)
- `npm run build` — `tsc --noEmit && vite build`
- `npm run gen:api` — regenerate `src/api/schema.d.ts` from FastAPI OpenAPI

## Hard Rules (§10 verbatim)
1. **Never invent scientific data.** No made-up coefficients, thresholds, toxicity values, or literature citations. Templates and examples use obviously illustrative values and say so in the UI. If a real value is needed, ask the human.
2. **Never use `eval`/`exec`/`new Function`** (TS or Python) on user-provided text. Expressions go through the safe compilers only.
3. **Evidence and audit log are append-only.** Never write code that deletes or edits evidence values; never drop or rewrite migrations that have been applied; add a new migration instead.
4. **Never delete studies or the database.** Archive only. Any destructive maintenance operation requires explicit human approval.
5. **Exclusions must be explainable.** Every `excluded`/`deprioritised` decision stores `filter`, a human-readable `reason`, and enough `details_json` to reproduce it (model version id, evidence fingerprint, p_hat, p_upper, n draws, seed).
6. **Unvalidated predictors may only deprioritise, never exclude.** Validation acceptance is a human action.
7. **Language in UI and reports:** say "excluded at 95% confidence under model M given evidence D", "equivalence shown within ±M". Never "proved", "guaranteed", "impossible" (except for hard constraints, which are "violates constraint <label>").
8. **Do not change persisted IDs** (node kinds, field keys, select option values, port ids, packet types, localStorage key) — they are part of saved projects.
9. **Keep `Workspace.tsx` changes minimal**; put new UI in `src/study/` or `src/app/`.
10. **Bind the server to `127.0.0.1` only** until Phase 6 authentication exists.
11. **No new heavy dependencies** beyond those listed here (e.g. no PyTorch/BoTorch, no chart libraries) without a note in the progress tracker explaining why.
12. **Determinism:** all randomness is seeded from `study.rng_seed` plus stable per-item offsets; store seeds with results.

## Workflow Discipline
Always work on one task at a time. Check and update the [Progress tracker](docs/IMPLEMENTATION_PLAN.md#13-progress-tracker) in `docs/IMPLEMENTATION_PLAN.md` when starting (`in progress`) and finishing (`done`) every task.
