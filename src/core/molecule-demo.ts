import * as THREE from "three";
import { blankProject, type Project, type Object3D, type Vec3 } from "./types.ts";
import { makeNode } from "./runtime.ts";

/**
 * Helper to create a 3D atom sphere.
 */
function createAtom(
  id: string,
  name: string,
  pos: [number, number, number],
  radius: number,
  color: string,
): Object3D {
  return {
    id,
    name,
    shape: "sphere",
    position: { x: pos[0], y: pos[1], z: pos[2] },
    size: { x: radius * 2, y: radius * 2, z: radius * 2 },
    rotation: 0,
    color,
  };
}

/**
 * Helper to create a 3D covalent bond cylinder connecting two atom positions.
 */
function createBond(
  id: string,
  name: string,
  p1: [number, number, number],
  p2: [number, number, number],
  color: string = "#64748b",
): Object3D {
  const v1 = new THREE.Vector3(...p1);
  const v2 = new THREE.Vector3(...p2);
  const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
  const diff = new THREE.Vector3().subVectors(v2, v1);
  const length = diff.length();

  const up = new THREE.Vector3(0, 1, 0);
  const dir = diff.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
  const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");

  return {
    id,
    name,
    shape: "cylinder",
    position: { x: Number(mid.x.toFixed(3)), y: Number(mid.y.toFixed(3)), z: Number(mid.z.toFixed(3)) },
    size: { x: 0.16, y: Number(length.toFixed(3)), z: 0.16 },
    rotation: 0,
    rotationVec: {
      x: Number((euler.x * (180 / Math.PI)).toFixed(2)),
      y: Number((euler.y * (180 / Math.PI)).toFixed(2)),
      z: Number((euler.z * (180 / Math.PI)).toFixed(2)),
    },
    color,
  };
}

/**
 * Generates an illustrative 3D kinase inhibitor drug lead docked in an active binding pocket.
 */
export function molecularProject(): Project {
  const p = blankProject();
  p.name = "სამიზნე კინაზას ჯიბე და მოლეკულა (Target Kinase Pocket & Drug Lead)";
  p.duration = 5;
  p.sampleRate = 100;

  // 1. Define 3D Molecular Structure (Gefitinib/Erlotinib Kinase Lead Analogue)
  // Coordinates centered around (10, 10, 10) in 20x20x20 space
  const atomCoords: Record<string, { name: string; pos: [number, number, number]; r: number; color: string }> = {
    // Quinazoline Bicyclic Core (C: #334155, N: #3b82f6)
    C1: { name: "C1 (Core)", pos: [8.8, 10.0, 9.3], r: 0.42, color: "#334155" },
    C2: { name: "C2 (Core)", pos: [9.9, 10.0, 8.6], r: 0.42, color: "#334155" },
    N3: { name: "N3 (Pyridine N)", pos: [11.0, 10.0, 9.3], r: 0.39, color: "#3b82f6" },
    C4: { name: "C4 (Hinge Interface)", pos: [11.0, 10.0, 10.7], r: 0.42, color: "#334155" },
    C4a: { name: "C4a (Ring Junction)", pos: [9.9, 10.0, 11.4], r: 0.42, color: "#334155" },
    C8a: { name: "C8a (Ring Junction)", pos: [8.8, 10.0, 10.7], r: 0.42, color: "#334155" },
    N1: { name: "N1 (Quinazoline N)", pos: [7.7, 10.0, 11.4], r: 0.39, color: "#3b82f6" },
    C2p: { name: "C2' (Core)", pos: [6.6, 10.0, 10.7], r: 0.42, color: "#334155" },
    C3p: { name: "C3' (Core)", pos: [6.6, 10.0, 9.3], r: 0.42, color: "#334155" },
    N4p: { name: "N4' (Core)", pos: [7.7, 10.0, 8.6], r: 0.39, color: "#3b82f6" },

    // Aniline Linker & Aromatic Ring (Pharmacophore)
    N_nh: { name: "NH (H-Bond Donor)", pos: [12.2, 10.3, 11.4], r: 0.39, color: "#3b82f6" },
    H_nh: { name: "H (Donor Hydrogen)", pos: [12.2, 11.0, 11.0], r: 0.28, color: "#f8fafc" },
    C_ph1: { name: "C1' (Phenyl)", pos: [13.4, 10.1, 12.1], r: 0.42, color: "#334155" },
    C_ph2: { name: "C2' (Phenyl)", pos: [14.6, 10.4, 11.4], r: 0.42, color: "#334155" },
    C_ph3: { name: "C3' (Phenyl)", pos: [15.7, 10.2, 12.1], r: 0.42, color: "#334155" },
    Cl_sub: { name: "Cl (Chlorine Halogen)", pos: [17.1, 10.5, 11.2], r: 0.52, color: "#22c55e" },
    C_ph4: { name: "C4' (Phenyl)", pos: [15.7, 9.7, 13.5], r: 0.42, color: "#334155" },
    F_sub: { name: "F (Fluorine Halogen)", pos: [16.8, 9.5, 14.2], r: 0.36, color: "#06b6d4" },
    C_ph5: { name: "C5' (Phenyl)", pos: [14.6, 9.4, 14.2], r: 0.42, color: "#334155" },
    C_ph6: { name: "C6' (Phenyl)", pos: [13.4, 9.6, 13.5], r: 0.42, color: "#334155" },

    // Methoxy Ether Substituent
    O_met: { name: "O (Methoxy Acceptor)", pos: [5.4, 10.0, 11.4], r: 0.39, color: "#ef4444" },
    C_met: { name: "C (Methyl Carbon)", pos: [4.3, 10.0, 10.6], r: 0.40, color: "#334155" },

    // Propoxy-Morpholine Solubilizing Side-Chain
    O_tail: { name: "O (Ether Acceptor)", pos: [5.4, 10.0, 8.6], r: 0.39, color: "#ef4444" },
    C_t1: { name: "C (Propyl 1)", pos: [4.3, 10.0, 9.3], r: 0.40, color: "#334155" },
    C_t2: { name: "C (Propyl 2)", pos: [3.2, 10.0, 8.6], r: 0.40, color: "#334155" },
    N_morph: { name: "N (Morpholine Amine)", pos: [2.1, 10.0, 9.3], r: 0.39, color: "#3b82f6" },
    C_m1: { name: "C (Morpholine)", pos: [1.3, 10.8, 8.8], r: 0.40, color: "#334155" },
    C_m2: { name: "C (Morpholine)", pos: [0.2, 10.8, 9.6], r: 0.40, color: "#334155" },
    O_morph: { name: "O (Morpholine Ether)", pos: [0.0, 10.0, 10.7], r: 0.39, color: "#ef4444" },
    C_m3: { name: "C (Morpholine)", pos: [0.9, 9.2, 11.2], r: 0.40, color: "#334155" },
    C_m4: { name: "C (Morpholine)", pos: [2.0, 9.2, 10.4], r: 0.40, color: "#334155" },
  };

  const bondPairs: [string, string][] = [
    // Quinazoline core bonds
    ["C1", "C2"], ["C2", "N3"], ["N3", "C4"], ["C4", "C4a"], ["C4a", "C8a"], ["C8a", "C1"],
    ["C8a", "N1"], ["N1", "C2p"], ["C2p", "C3p"], ["C3p", "N4p"], ["N4p", "C1"],
    // Hinge linker & phenyl
    ["C4", "N_nh"], ["N_nh", "H_nh"], ["N_nh", "C_ph1"],
    ["C_ph1", "C_ph2"], ["C_ph2", "C_ph3"], ["C_ph3", "Cl_sub"],
    ["C_ph3", "C_ph4"], ["C_ph4", "F_sub"], ["C_ph4", "C_ph5"],
    ["C_ph5", "C_ph6"], ["C_ph6", "C_ph1"],
    // Methoxy
    ["C2p", "O_met"], ["O_met", "C_met"],
    // Tail
    ["C3p", "O_tail"], ["O_tail", "C_t1"], ["C_t1", "C_t2"], ["C_t2", "N_morph"],
    // Morpholine ring
    ["N_morph", "C_m1"], ["C_m1", "C_m2"], ["C_m2", "O_morph"],
    ["O_morph", "C_m3"], ["C_m3", "C_m4"], ["C_m4", "N_morph"],
  ];

  const objects: Object3D[] = [];

  // Add 3D atoms
  for (const [id, a] of Object.entries(atomCoords)) {
    objects.push(createAtom(`atom_${id}`, a.name, a.pos, a.r, a.color));
  }

  // Add 3D covalent bond cylinders
  for (let i = 0; i < bondPairs.length; i++) {
    const [k1, k2] = bondPairs[i];
    const a1 = atomCoords[k1];
    const a2 = atomCoords[k2];
    if (a1 && a2) {
      objects.push(createBond(`bond_${k1}_${k2}`, `Bond: ${k1}-${k2}`, a1.pos, a2.pos));
    }
  }

  // Add Target Receptor Binding Cavity Anchors (Active Site Cavity)
  objects.push({
    id: "site_met793",
    name: "Target Residue: Met793 (Hinge Region)",
    shape: "sphere",
    position: { x: 11.8, y: 12.0, z: 9.0 },
    size: { x: 1.2, y: 1.2, z: 1.2 },
    rotation: 0,
    color: "#8b5cf6",
  });

  objects.push({
    id: "site_thr790",
    name: "Target Residue: Thr790 (Gatekeeper Pocket)",
    shape: "sphere",
    position: { x: 14.5, y: 12.5, z: 13.5 },
    size: { x: 1.3, y: 1.3, z: 1.3 },
    rotation: 0,
    color: "#f59e0b",
  });

  objects.push({
    id: "site_lys745",
    name: "Target Residue: Lys745 (Catalytic Triad)",
    shape: "sphere",
    position: { x: 9.0, y: 12.2, z: 12.5 },
    size: { x: 1.2, y: 1.2, z: 1.2 },
    rotation: 0,
    color: "#ec4899",
  });

  // 2. Build LabNodes in Canvas
  const add = (
    id: string,
    kind: string,
    x: number,
    y: number,
    params: Record<string, unknown>,
    label?: string,
  ) => {
    const n = makeNode(kind, x, y);
    n.id = id;
    n.params = { ...n.params, ...params };
    if (label) n.label = label;
    p.nodes.push(n);
    return n;
  };

  // 3D Scene Node
  add(
    "scene_pocket",
    "scene3d",
    400,
    60,
    {
      width: 20,
      depth: 20,
      height: 20,
      environment: "Molecular",
      temperature: 310.15,
      objects,
    },
    "3D სამიზნე ჯიბე და მოლეკულა (Target Kinase Pocket & Molecule)",
  );

  // Parameter Input Formula Nodes
  add(
    "node_mw_calc",
    "formula",
    40,
    60,
    { expression: "a", a: 446.9, b: 0, unit: "Da" },
    "მოლეკულური მასა (MW)",
  );

  add(
    "node_logp_calc",
    "formula",
    40,
    180,
    { expression: "a", a: 3.2, b: 0, unit: "" },
    "ლიპოფილურობა (LogP)",
  );

  add(
    "node_tpsa_calc",
    "formula",
    40,
    300,
    { expression: "a", a: 68.7, b: 0, unit: "Å²" },
    "პოლარული ზედაპირი (TPSA)",
  );

  add(
    "node_hbd_calc",
    "formula",
    40,
    420,
    { expression: "a", a: 1, b: 0, unit: "" },
    "H-დონორები (HBD)",
  );

  add(
    "node_hba_calc",
    "formula",
    40,
    540,
    { expression: "a", a: 8, b: 0, unit: "" },
    "H-აქცეპტორები (HBA)",
  );

  add(
    "node_rot_bonds_calc",
    "formula",
    40,
    660,
    { expression: "a", a: 7, b: 0, unit: "" },
    "ბრუნვადი ბმები (RotBonds)",
  );

  // Pharmacokinetic & Safety Outcome Prediction Models
  // Caco-2 Permeability Model (Papp in nm/s)
  add(
    "node_perm",
    "formula",
    840,
    180,
    {
      expression: "clamp(100 * (1 / (1 + exp(-1.2 * (a - 1.5)))) * (1 / (1 + exp(0.04 * (b - 100)))), 2, 120)",
      a: 3.2,
      b: 68.7,
      unit: "nm/s",
    },
    "Caco-2 გამტარობის მოდელი (Papp)",
  );

  // Cytotoxicity Risk Model (0 = safe, 1 = cytotoxic)
  add(
    "node_tox",
    "formula",
    840,
    460,
    {
      expression: "if(a > 5.5, 1, if(b > 750, 1, 0))",
      a: 3.2,
      b: 446.9,
      unit: "",
    },
    "ციტოტოქსიკურობის რისკის ფილტრი (Tox)",
  );

  // 3. Connect Edges
  const link = (
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ) =>
    p.edges.push({
      id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
      source,
      sourceHandle,
      target,
      targetHandle,
    });

  // Link parameter outputs into pharmacokinetic predictors
  link("node_logp_calc", "result", "node_perm", "a");
  link("node_tpsa_calc", "result", "node_perm", "b");

  link("node_logp_calc", "result", "node_tox", "a");
  link("node_mw_calc", "result", "node_tox", "b");

  return p;
}
