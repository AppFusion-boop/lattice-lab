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
