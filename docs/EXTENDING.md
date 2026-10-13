# Adding nodes to Lattice Studio

Add a NodeDefinition to definitions in src/core/registry.ts. The same registry is imported by the editor and worker. No separate palette, inspector or execution switch is required.

A definition contains:

- Stable id and category (one of the categories in types.ts).
- title, description, icon (an existing icon key; unknown names fall back to Box), help.
- inputs/outputs arrays: stable port id, label, allowed packet types, optional flag for inputs.
- fields: number, text, select, expression or csv, with defaults, limits and options.
- evaluate(context): a pure function returning a map keyed by output port id.

Example scalar node:

```ts
{
  id: 'square-number',
  title: 'Square number',
  description: 'Square a scalar value',
  category: 'Processing',
  icon: 'Sigma',
  inputs: [{id: 'value', label: 'Value', types: ['number']}],
  outputs: [{id: 'result', label: 'Result', types: ['number']}],
  fields: [],
  help: 'Squares a scalar. The unit expression is explicit metadata.',
  evaluate: ({inputs}) => {
    const p = inputs.value;
    if (p?.type !== 'number') throw Error('Connect a number');
    return {result: {type: 'number', value: p.value ** 2, unit: '(' + p.unit + ')²'}};
  }
}
```

Keep evaluators deterministic and side-effect-free. Validate domain constraints and units explicitly. Throw a useful error for invalid inputs; the scheduler isolates the error and blocks downstream nodes. The worker passes duration, sampleRate, times, params, inputs and node. Use the supplied times for compatible generated signals.

Adding a new packet type requires extending Packet/DataType, typeColors, PacketView and any import validation for its persisted configuration. Adding a custom scene solver should use a new registry node consuming a scene; keep geometry separate from physical solver assumptions.

Registry metadata is data; evaluate is trusted application code. Do not accept arbitrary evaluator JavaScript in imported workflows. The in-app reusable-node feature deliberately stores only validated formula expressions.

After adding a node, write a test asserting meaningful mathematical behavior and a failure case, then run npm test and npm run build. Project schema changes must increment version and provide an explicit migration path. Unsupported schema versions are rejected instead of silently dropping data.

Official APIs used: [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [typed handles](https://reactflow.dev/learn/customization/handles), [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), [OBJLoader](https://threejs.org/docs/pages/OBJLoader.html).

## Scene event plugins

Add one SceneEventDefinition to sceneEvents in src/core/scene-events.ts. It supplies id, title, description, icon, color, type-specific fields, measurement channels, an additive or multiplicative mode, and a pure effect({params, age, distance, channel}) function. Shared schedule and spatial fields are added automatically. The registry generates its workflow node, typed sceneEvent output, catalog entry, both parameter editors and timeline representation. No new component or scene switch is required.

- effect returns a field contribution for additive events or a removed fraction for multiplicative events. Spatial weighting is applied centrally.
- Optional validate(params, sampleRate) rejects invalid sampling or parameter combinations.
- Optional tailTime(params) extends propagation after the local duration.
- Optional front(params, age) supplies an expanding front radius for the 2D preview.
- Starts come from every connected trigger timestamp plus the configured offset, or just the offset if unconnected. Disabling an event produces an empty schedule.
- New events targeting existing measurements require only this registry entry. New physical quantities require a typed measurement channel and corresponding sensor implementation as well.

Example:

```ts
{
  id: 'steady-heater', title: 'Steady heater', description: 'A prescribed thermal offset',
  icon: 'Thermometer', color: '#c46d79', channels: ['temperature'], mode: 'add',
  fields: [{key: 'delta', label: 'Temperature change', kind: 'number',
    default: 10, min: -100, max: 200, unit: '°C', step: 1}],
  help: 'Adds a prescribed thermal offset during each active interval.',
  effect: ({params}) => Number(params.delta),
}
```

## Dynamic ports and multiple connections

Use nodeDefinition(node, project), not just getDefinition(kind), whenever rendering or checking a graph instance. Scene output IDs use sensorOutputId(sensor.id), so renaming a sensor preserves connections. pruneSceneConnections removes wires whose dynamic ports disappeared. Input ports with multiple: true receive their full packet array in context.inputLists[portId]; context.inputs[portId] retains the first packet for ordinary nodes.

Canvas measurements are view state. reconcileCanvasNodes preserves unchanged node identities and measured dimensions; retainExecutionProject prevents a position-only drag from invalidating run results. Avoid reconstructing fresh React Flow nodes from the project every render.

## Integrated scene playback

SceneSimulation reads the active Project and its current Run; it does not own a parallel hardcoded simulation. Scenes are chosen from actual scene nodes, effects from their attached event nodes, and measurements from the selected dynamic sensor output. Preparing a run and playing it are separate operations. visibleSampleIndex is the inclusive time boundary for live readings and charts. Parameter edits invalidate the run and reset playback.

The tunnel starter in core/tunnel-demo.ts is an ordinary portable Project. The environment selector activates the locally bundled Kenney corridor geometry. Water and methane are registry definitions, with visual styles resolved by EventVisuals. Field appearance is not a CFD solver; maintain explicit model assumptions when adding physical effects.

Localization uses core/ka.ts for existing schema metadata and display labels. Persisted type IDs, select values, units and formulas remain stable. New definitions may provide Georgian metadata directly.
