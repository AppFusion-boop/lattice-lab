# Lattice Studio 2.0

A focused, browser-local visual workflow builder. The former instrument dashboard, missions, XP, and laboratory pages have been removed from the application and source.

## Run

```sh
npm install
npm run dev
npm test
npm run build
```

React 19, TypeScript, React Flow, Vite, and a lazily loaded Three.js scene editor. Execution runs in a Web Worker; formulas use a restricted arithmetic parser, never JavaScript evaluation.

## Workflow model

The catalog is a shared schema registry. Each definition declares category, label, icon, typed ports, parameter fields, help text, and evaluator. The catalog, inspector, port rendering, connection checking and worker use that definition. See [extension guide](docs/EXTENDING.md).

28 built-in nodes:

- Triggers: manual and interval (finite simulation-time events).
- Scenes: independent 2D and 3D environments.
- Data: number, boolean, text, vector3, CSV, table-to-signal, waveform generator.
- Sensors: ideal pressure, temperature, accelerometer, microphone, illuminance models.
- Processing: formula, low-pass filter, resample, statistics.
- Logic/events: threshold crossings, event delay, compare, gate.
- Outputs: two-channel scope, value display, data table, event monitor.

Types: event, number, boolean, text, vector3, signal, table, scene. Inputs may declare unions. Formula result type follows connected scalar/signal inputs. Every concrete packet is rechecked at execution. Units are explicit metadata, not a dimensional-analysis engine. Formulas declare their output unit; vector positions require meters. Combining two signals requires the same time grid; Resample aligns imported data.

The scheduler evaluates a finite directed acyclic graph, caches each node result for the run, isolates node errors, and marks downstream nodes as waiting. Feedback loops, persistent state, real hardware drivers, network integrations, background jobs and multi-user editing are not implemented. Adding these requires explicit runtime capabilities, not just a new UI card.

## Scenes

Build boxes, spheres and wave sources. Place sensors with 2D dragging or numeric coordinates; orbit, zoom and select in 3D. Import local OBJ triangle meshes up to 2 MB / 10,000 triangles. Imported geometry is centered, normalized and embedded as vertices in the workflow JSON. Materials, textures, animations and remote assets are not imported. Sensor positions supplied by vector nodes are read-only in the scene and edited at their source.

Scene geometry is a visual environment. Sensor values use simple ideal analytical fields: free-field acoustic delay/attenuation, a synthetic temperature gradient/oscillation, damped acceleration, and distance-varying illuminance. Sensitivity, bias and first-order response are applied. Obstacles do not affect the analytical fields. No methane chemistry, reacting CFD, droplet model, collision or heat solver is present, and no injury model is included.

## Formulas

Inputs a and b each accept numbers or sampled signals; missing inputs use configurable scalar fallbacks. Scalar values broadcast over a signal. t is the sample time, or zero for a scalar-only expression. Constants pi/e, arithmetic, comparisons, logical operators, trigonometry, logarithms, min/max, pow, clamp and lazy if are supported. Invalid syntax is editable and saveable; runtime errors appear per node. Saving a formula as a reusable node adds it to the workflow's catalog and its portable JSON.

## Storage and limits

Save explicitly stores the current project in this browser under lattice-studio-v2. JSON export/import preserves nodes, connections, parameters, custom formulas and embedded geometry. Run JSON exports the graph with typed results; signal/table outputs export CSV. JSON is validated on import, save and run; executable code is never imported.

Limits: 100 nodes, 300 wires, 30 reusable formulas, 40 objects per scene, 5 MB project text, 500 KB CSV / 10,000 rows / 20 columns, and 10,001 samples per run. Browser storage quotas may be smaller than project limits; keep exports of important projects. The old v1 storage keys are not consumed or deleted.

## Verification

17 tests cover expression syntax and domains, node-order-independent execution, all starter templates, signal mapping, sensor positions, type errors, feedback detection, event timing, data parsing, resampling contracts, custom formula persistence, malformed imports, OBJ normalization and draft-error isolation.

Browser checks cover desktop/mobile layouts, scene rendering and primitives, spatial parameter edits, CSV analysis, reusable formula creation, save/reload, and execution error recovery. Scene and instrument output remains a demonstration, not scientific validation.
