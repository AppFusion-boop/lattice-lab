import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Undo2,
  Redo2,
  Trash2,
  Sparkles,
  Copy,
  Check,
  Code,
  BookOpen,
  Sliders,
  CornerDownLeft,
  Keyboard,
} from "lucide-react";
import type { Parameter } from "../api/types";
import { compileExpression, expressionVariables, formulaFunctions } from "../../core/expression";
import { tr } from "../../i18n";
import {
  type MathCursor,
  type MathNode,
  type MathOp,
  type MathRow,
  backspaceAtCursor,
   cloneMathRow,
  collectAllRows,
  countEmptySlots,
  createEmptyRow,
  createNumberNodes,
  createOpNode,
  createVarNode,
  deleteNodeById,
  findRowContext,
  insertFractionAtCursor,
  insertNodesAtCursor,
  insertPowerAtCursor,
  moveCursorLeft,
  moveCursorRight,
  moveCursorTab,
  moveCursorVertical,
  newMathId,
  parseExpressionToMathRow,
  serializeMathRowToExpression,
} from "./mathBuilderModel";

export interface VisualMathBuilderProps {
  currentParamKey: string;
  studyParameters: Parameter[];
  expression: string;
  onChange: (expression: string, dependencies: string[], sampleValue: number | null) => void;
  unit?: string;
}

type KeypadTab = "popular" | "calculus" | "matrices" | "triglog" | "piecewise" | "presets";

const OP_DISPLAY: Record<string, string> = {
  "+": "+",
  "-": "−",
  "*": "·",
  "%": "mod",
  "==": "=",
  "!=": "≠",
  "<": "<",
  ">": ">",
  "<=": "≤",
  ">=": "≥",
  "&&": "∧",
  "||": "∨",
};

const FN_DISPLAY: Record<string, string> = {
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "arcsin",
  acos: "arccos",
  atan: "arctan",
  atan2: "atan2",
  sinh: "sinh",
  cosh: "cosh",
  tanh: "tanh",
  exp: "exp",
  log: "ln",
  ln: "ln",
  log10: "log₁₀",
  erf: "erf",
  round: "round",
  sign: "sgn",
  min: "min",
  max: "max",
  clamp: "clamp",
};

export function VisualMathBuilder({
  currentParamKey,
  studyParameters,
  expression,
  onChange,
  unit = "",
}: VisualMathBuilderProps) {
  // Available study parameters (excluding self)
  const availableParams = useMemo(() => {
    return studyParameters.filter((p) => p.key !== currentParamKey);
  }, [studyParameters, currentParamKey]);

  const paramKeySet = useMemo(
    () => new Set(availableParams.map((p) => p.key)),
    [availableParams],
  );

  // Nominal values per parameter
  const nominalValues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of studyParameters) {
      if (p.key === currentParamKey) continue;
      const s = p.spec as Record<string, unknown>;
      if (p.role === "fixed") {
        map[p.key] = Number(s.value ?? 0);
      } else if (p.role === "dependent") {
        map[p.key] = Number(s.sample_value ?? 1);
      } else if (p.kind === "continuous") {
        const min = Number(s.min ?? 0);
        const max = Number(s.max ?? 1);
        const dist = s.distribution as Record<string, unknown> | undefined;
        if (p.role === "uncertain" && dist) {
          if (dist.mean !== undefined) map[p.key] = Number(dist.mean);
          else if (dist.median !== undefined) map[p.key] = Number(dist.median);
          else if (dist.mode !== undefined) map[p.key] = Number(dist.mode);
          else map[p.key] = (min + max) / 2;
        } else {
          map[p.key] = (min + max) / 2;
        }
      } else if (p.kind === "integer") {
        const min = Number(s.min ?? 0);
        const max = Number(s.max ?? 10);
        map[p.key] = Math.round((min + max) / 2);
      } else {
        map[p.key] = 1;
      }
    }
    return map;
  }, [studyParameters, currentParamKey]);

  // Build initial default formula if expression prop is empty
  const buildDefaultExpr = useCallback(() => {
    if (expression && expression.trim()) return expression.trim();
    const lead = availableParams.find((p) => p.key.includes("lead"))?.key;
    const flow = availableParams.find((p) => p.key.includes("flow"))?.key;
    const noz = availableParams.find((p) => p.key.includes("nozzle"))?.key;
    if (lead && flow && noz) {
      return `integral(0, ${lead}, (${flow} / 60) * ${noz} * (1 - 0.05 * t))`;
    }
    if (availableParams.length >= 2) {
      return `(${availableParams[0].key} / ${availableParams[1].key})`;
    }
    if (availableParams.length === 1) {
      return `sqrt(${availableParams[0].key})`;
    }
    return "";
  }, [expression, availableParams]);

  // 2D Math Tree State + Undo/Redo History
  const [rootRow, setRootRow] = useState<MathRow>(() =>
    parseExpressionToMathRow(buildDefaultExpr()),
  );
  const [cursor, setCursor] = useState<MathCursor>(() => ({
    rowId: rootRow.id,
    offset: rootRow.items.length,
  }));
  const [history, setHistory] = useState<Array<{ root: MathRow; cursor: MathCursor }>>([]);
  const [future, setFuture] = useState<Array<{ root: MathRow; cursor: MathCursor }>>([]);

  // UI States
  const [activeTab, setActiveTab] = useState<KeypadTab>("popular");
  const [canvasFocused, setCanvasFocused] = useState<boolean>(true);
  const [showRawCode, setShowRawCode] = useState<boolean>(false);
  const [rawCodeInput, setRawCodeInput] = useState<string>("");
  const [showSandbox, setShowSandbox] = useState<boolean>(false);
  const [sandboxValues, setSandboxValues] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState<boolean>(false);

  // Inline typing buffer for variable/function autocomplete (Symbolab style)
  const [typeBuffer, setTypeBuffer] = useState<string>("");

  const canvasRef = useRef<HTMLDivElement>(null);

  // Keep cursor valid if rootRow changes
  useEffect(() => {
    const ctx = findRowContext(rootRow, cursor.rowId);
    if (!ctx) {
      setCursor({ rowId: rootRow.id, offset: rootRow.items.length });
    } else if (cursor.offset > ctx.row.items.length) {
      setCursor({ rowId: ctx.row.id, offset: ctx.row.items.length });
    }
  }, [rootRow, cursor.rowId, cursor.offset]);

  // Helper to commit a tree state change with undo history
  const commitChange = useCallback(
    (next: { root: MathRow; cursor: MathCursor }) => {
      setHistory((prev) => [...prev.slice(-39), { root: cloneMathRow(rootRow), cursor }]);
      setFuture([]);
      setRootRow(next.root);
      setCursor(next.cursor);
      setTypeBuffer("");
    },
    [rootRow, cursor],
  );

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [{ root: cloneMathRow(rootRow), cursor }, ...f]);
    setRootRow(prev.root);
    setCursor(prev.cursor);
    setTypeBuffer("");
  }, [history, rootRow, cursor]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, { root: cloneMathRow(rootRow), cursor }]);
    setRootRow(next.root);
    setCursor(next.cursor);
    setTypeBuffer("");
  }, [future, rootRow, cursor]);

  const handleClear = useCallback(() => {
    const empty = createEmptyRow([]);
    commitChange({ root: empty, cursor: { rowId: empty.id, offset: 0 } });
  }, [commitChange]);

  const focusCanvas = useCallback(() => {
    setCanvasFocused(true);
    canvasRef.current?.focus();
  }, []);

  // Serialize 2D tree to expression string
  const emptyStats = useMemo(() => countEmptySlots(rootRow), [rootRow]);
  const serializedFormula = useMemo(
    () => serializeMathRowToExpression(rootRow, ""),
    [rootRow],
  );

  useEffect(() => {
    setRawCodeInput(serializedFormula);
  }, [serializedFormula]);

  // Evaluate formula in real time
  const evaluationResult = useMemo(() => {
    if (rootRow.items.length === 0) {
      return {
        valid: false,
        empty: true,
        emptySlots: 1,
        error: null as string | null,
        dependencies: [] as string[],
        sampleValue: null as number | null,
        compiledFn: null as ((vars: Record<string, number>) => number) | null,
      };
    }

    const vars = expressionVariables(serializedFormula);

    if (emptyStats.count > 0) {
      return {
        valid: false,
        empty: false,
        emptySlots: emptyStats.count,
        error: tr(
          `შეავსეთ დარჩენილი ${emptyStats.count} ცარიელი სლოტი (▢) — გამოიყენეთ Tab გადასასვლელად.`,
          `Fill in ${emptyStats.count} remaining placeholder box${emptyStats.count > 1 ? "es" : ""} (▢) — press Tab to jump between boxes.`,
        ),
        dependencies: vars,
        sampleValue: null,
        compiledFn: null,
      };
    }

    if (currentParamKey && vars.includes(currentParamKey)) {
      return {
        valid: false,
        empty: false,
        emptySlots: 0,
        error: tr(
          `თვით-დამოკიდებულება: '${currentParamKey}' ვერ იქნება დამოკიდებული საკუთარ თავზე.`,
          `Self-reference error: '${currentParamKey}' cannot depend on itself.`,
        ),
        dependencies: vars,
        sampleValue: null,
        compiledFn: null,
      };
    }

    try {
      const compiled = compileExpression(serializedFormula, { variables: vars });
      const env: Record<string, number> = {};
      for (const v of vars) {
        env[v] = sandboxValues[v] ?? nominalValues[v] ?? 1.0;
      }
      const val = compiled(env);
      const nominalEnv: Record<string, number> = {};
      for (const v of vars) {
        nominalEnv[v] = nominalValues[v] ?? 1.0;
      }
      const nomVal = compiled(nominalEnv);
      return {
        valid: Number.isFinite(val) && Number.isFinite(nomVal),
        empty: false,
        emptySlots: 0,
        error: null,
        dependencies: vars,
        sampleValue: Number.isFinite(nomVal) ? nomVal : null,
        sandboxEvaluated: Number.isFinite(val) ? val : null,
        compiledFn: compiled,
      };
    } catch (err) {
      return {
        valid: false,
        empty: false,
        emptySlots: 0,
        error: (err as Error).message,
        dependencies: vars,
        sampleValue: null,
        sandboxEvaluated: null,
        compiledFn: null,
      };
    }
  }, [
    rootRow,
    serializedFormula,
    emptyStats.count,
    currentParamKey,
    nominalValues,
    sandboxValues,
  ]);

  // Notify parent onChange
  useEffect(() => {
    if (evaluationResult.valid && !evaluationResult.empty) {
      onChange(
        serializedFormula,
        evaluationResult.dependencies,
        evaluationResult.sampleValue,
      );
    } else {
      onChange(
        emptyStats.count === 0 ? serializedFormula : "",
        evaluationResult.dependencies,
        null,
      );
    }
  }, [
    serializedFormula,
    emptyStats.count,
    evaluationResult.valid,
    evaluationResult.empty,
    evaluationResult.sampleValue,
    evaluationResult.dependencies,
  ]);

  // --- Insertion Actions for Keypad & Shortcuts ---

  const insertChar = useCallback(
    (ch: string) => {
      commitChange(insertNodesAtCursor(rootRow, cursor, createNumberNodes(ch)));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertOp = useCallback(
    (op: MathOp) => {
      commitChange(insertNodesAtCursor(rootRow, cursor, [createOpNode(op)]));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertVariable = useCallback(
    (varName: string) => {
      commitChange(insertNodesAtCursor(rootRow, cursor, [createVarNode(varName)]));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertFraction = useCallback(
    (wrapPreceding = true) => {
      commitChange(insertFractionAtCursor(rootRow, cursor, wrapPreceding));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertPower = useCallback(
    (presetExp?: string) => {
      commitChange(insertPowerAtCursor(rootRow, cursor, presetExp));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertSqrt = useCallback(() => {
    const rad = createEmptyRow([]);
    const node: MathNode = { id: newMathId("sqrt"), kind: "sqrt", radicand: rad };
    commitChange(insertNodesAtCursor(rootRow, cursor, [node], rad.id, 0));
    focusCanvas();
  }, [rootRow, cursor, commitChange, focusCanvas]);

  const insertNthRoot = useCallback(
    (presetDegree?: string) => {
      const deg = createEmptyRow(presetDegree ? createNumberNodes(presetDegree) : []);
      const rad = createEmptyRow([]);
      const node: MathNode = {
        id: newMathId("nthroot"),
        kind: "nthroot",
        degree: deg,
        radicand: rad,
      };
      commitChange(
        insertNodesAtCursor(
          rootRow,
          cursor,
          [node],
          presetDegree ? rad.id : deg.id,
          0,
        ),
      );
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertWrapper = useCallback(
    (kind: "abs" | "floor" | "ceil" | "paren") => {
      const inner = createEmptyRow([]);
      const node: MathNode = { id: newMathId(kind), kind, inner };
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], inner.id, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertIntegral = useCallback(
    (defaultLower?: string, defaultUpper?: string) => {
      const lower = createEmptyRow(defaultLower ? createNumberNodes(defaultLower) : []);
      const upper = createEmptyRow(
        defaultUpper ? [createVarNode(defaultUpper)] : [],
      );
      const integrand = createEmptyRow([]);
      const node: MathNode = {
        id: newMathId("int"),
        kind: "integral",
        lower,
        upper,
        integrand,
        dVar: "t",
      };
      const firstEmpty =
        lower.items.length === 0
          ? lower.id
          : upper.items.length === 0
          ? upper.id
          : integrand.id;
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], firstEmpty, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertSeries = useCallback(
    (kind: "sum" | "prod", defaultStart = "1") => {
      const start = createEmptyRow(defaultStart ? createNumberNodes(defaultStart) : []);
      const end = createEmptyRow([]);
      const term = createEmptyRow([]);
      const node: MathNode = {
        id: newMathId(kind),
        kind,
        indexVar: "k",
        start,
        end,
        term,
      };
      const firstFocus = start.items.length === 0 ? start.id : end.id;
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], firstFocus, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertDerivative = useCallback(
    (order: 1 | 2) => {
      const atPoint = createEmptyRow(createNumberNodes("0"));
      const body = createEmptyRow([]);
      const node: MathNode = {
        id: newMathId("deriv"),
        kind: "deriv",
        order,
        atPoint,
        body,
      };
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], body.id, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertMatrix = useCallback(
    (op: "det" | "trace" | "fnorm", size: 2 | 3) => {
      const count = size * size;
      const cells = Array.from({ length: count }, () => createEmptyRow([]));
      const node: MathNode = {
        id: newMathId("mat"),
        kind: "matrix",
        op,
        size,
        cells,
      };
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], cells[0].id, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertVecNorm = useCallback(
    (dim: 2 | 3) => {
      const coords = Array.from({ length: dim }, () => createEmptyRow([]));
      const node: MathNode = {
        id: newMathId("vnorm"),
        kind: "vecnorm",
        dim,
        coords,
      };
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], coords[0].id, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertVecDot = useCallback(
    (dim: 2 | 3) => {
      const left = Array.from({ length: dim }, () => createEmptyRow([]));
      const right = Array.from({ length: dim }, () => createEmptyRow([]));
      const node: MathNode = {
        id: newMathId("vdot"),
        kind: "vecdot",
        dim,
        left,
        right,
      };
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], left[0].id, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertLogBase = useCallback(
    (presetBase?: string) => {
      const base = createEmptyRow(presetBase ? createNumberNodes(presetBase) : []);
      const arg = createEmptyRow([]);
      const node: MathNode = {
        id: newMathId("logb"),
        kind: "logbase",
        base,
        arg,
      };
      commitChange(
        insertNodesAtCursor(
          rootRow,
          cursor,
          [node],
          presetBase ? arg.id : base.id,
          0,
        ),
      );
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  const insertBinom = useCallback(() => {
    const n = createEmptyRow([]);
    const k = createEmptyRow([]);
    const node: MathNode = { id: newMathId("binom"), kind: "binom", n, k };
    commitChange(insertNodesAtCursor(rootRow, cursor, [node], n.id, 0));
    focusCanvas();
  }, [rootRow, cursor, commitChange, focusCanvas]);

  const insertPiecewise = useCallback(() => {
    const thenRow = createEmptyRow([]);
    const cond = createEmptyRow([]);
    const elseRow = createEmptyRow([]);
    const node: MathNode = {
      id: newMathId("pw"),
      kind: "piecewise",
      cond,
      thenRow,
      elseRow,
    };
    commitChange(insertNodesAtCursor(rootRow, cursor, [node], thenRow.id, 0));
    focusCanvas();
  }, [rootRow, cursor, commitChange, focusCanvas]);

  const insertFunction = useCallback(
    (fnName: string, arity = 1) => {
      const args = Array.from({ length: arity }, () => createEmptyRow([]));
      const node: MathNode = {
        id: newMathId("fn"),
        kind: "fn",
        fn: fnName,
        args,
      };
      commitChange(insertNodesAtCursor(rootRow, cursor, [node], args[0].id, 0));
      focusCanvas();
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  // Mutate a specific composite node in place (e.g., toggling matrix 2x2 <-> 3x3 or det <-> trace)
  const mutateNodeById = useCallback(
    (nodeId: string, updater: (node: MathNode) => MathNode) => {
      const nextRoot = cloneMathRow(rootRow);
      const allRows = collectAllRows(nextRoot);
      for (const r of allRows) {
        const idx = r.items.findIndex((it) => it.id === nodeId);
        if (idx !== -1) {
          r.items[idx] = updater(r.items[idx]);
          commitChange({ root: nextRoot, cursor });
          focusCanvas();
          return;
        }
      }
    },
    [rootRow, cursor, commitChange, focusCanvas],
  );

  // Autocomplete suggestions when typing letters on keyboard
  const autocompleteItems = useMemo(() => {
    if (!typeBuffer) return [];
    const q = typeBuffer.toLowerCase();
    const list: Array<{
      label: string;
      desc: string;
      badge: string;
      apply: () => void;
    }> = [];

    for (const p of availableParams) {
      if (p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)) {
        list.push({
          label: p.key,
          desc: `${p.label}${p.unit ? ` [${p.unit}]` : ""}`,
          badge: "param",
          apply: () => insertVariable(p.key),
        });
      }
    }

    const builtInStructures: Array<{
      keys: string[];
      label: string;
      desc: string;
      badge: string;
      apply: () => void;
    }> = [
      {
        keys: ["int", "integral"],
        label: "∫ integral",
        desc: "Definite integral ∫_a^b f(t) dt",
        badge: "calculus",
        apply: () => insertIntegral(),
      },
      {
        keys: ["sum", "sigma"],
        label: "∑ sum",
        desc: "Discrete summation ∑_{k=a}^b",
        badge: "calculus",
        apply: () => insertSeries("sum"),
      },
      {
        keys: ["prod", "product"],
        label: "∏ prod",
        desc: "Indexed product ∏_{k=a}^b",
        badge: "calculus",
        apply: () => insertSeries("prod"),
      },
      {
        keys: ["deriv", "diff", "ddt"],
        label: "d/dt deriv",
        desc: "First derivative d/dt [f(t)]",
        badge: "calculus",
        apply: () => insertDerivative(1),
      },
      {
        keys: ["deriv2", "d2dt2"],
        label: "d²/dt² deriv2",
        desc: "Second derivative d²/dt² [f(t)]",
        badge: "calculus",
        apply: () => insertDerivative(2),
      },
      {
        keys: ["sqrt", "root"],
        label: "√ sqrt",
        desc: "Square root √x",
        badge: "algebra",
        apply: () => insertSqrt(),
      },
      {
        keys: ["nthroot", "cbrt"],
        label: "ⁿ√ root",
        desc: "n-th root ⁿ√x",
        badge: "algebra",
        apply: () => insertNthRoot(),
      },
      {
        keys: ["frac", "div"],
        label: "a/b fraction",
        desc: "Vertical stacked fraction",
        badge: "algebra",
        apply: () => insertFraction(false),
      },
      {
        keys: ["det", "det2", "matrix"],
        label: "|A|₂ₓ₂ det2",
        desc: "2×2 Matrix determinant",
        badge: "matrix",
        apply: () => insertMatrix("det", 2),
      },
      {
        keys: ["det3", "matrix3"],
        label: "|A|₃ₓ₃ det3",
        desc: "3×3 Matrix determinant",
        badge: "matrix",
        apply: () => insertMatrix("det", 3),
      },
      {
        keys: ["trace", "tr", "mat2trace"],
        label: "tr(A) trace",
        desc: "2×2 Matrix trace",
        badge: "matrix",
        apply: () => insertMatrix("trace", 2),
      },
      {
        keys: ["norm", "norm2", "vec"],
        label: "‖v‖₂ norm2",
        desc: "2D Euclidean vector norm",
        badge: "vector",
        apply: () => insertVecNorm(2),
      },
      {
        keys: ["norm3"],
        label: "‖v‖₃ norm3",
        desc: "3D Euclidean vector norm",
        badge: "vector",
        apply: () => insertVecNorm(3),
      },
      {
        keys: ["dot", "dot2"],
        label: "u · v dot2",
        desc: "2D Vector dot product",
        badge: "vector",
        apply: () => insertVecDot(2),
      },
      {
        keys: ["piecewise", "if", "cases"],
        label: "{ piecewise",
        desc: "Conditional piecewise function",
        badge: "logic",
        apply: () => insertPiecewise(),
      },
      {
        keys: ["binom", "choose", "ncr"],
        label: "(n k) binom",
        desc: "Binomial coefficient nCr",
        badge: "algebra",
        apply: () => insertBinom(),
      },
      {
        keys: ["pi"],
        label: "π (pi)",
        desc: "3.141592653589793",
        badge: "const",
        apply: () => insertVariable("pi"),
      },
      {
        keys: ["e"],
        label: "e (Euler)",
        desc: "2.718281828459045",
        badge: "const",
        apply: () => insertVariable("e"),
      },
      {
        keys: ["t"],
        label: "t (dummy var)",
        desc: "Integration / derivative variable t",
        badge: "var",
        apply: () => insertVariable("t"),
      },
      {
        keys: ["k"],
        label: "k (index var)",
        desc: "Summation / product index k",
        badge: "var",
        apply: () => insertVariable("k"),
      },
    ];

    for (const s of builtInStructures) {
      if (s.keys.some((k) => k.startsWith(q)) || s.label.toLowerCase().includes(q)) {
        list.push({
          label: s.label,
          desc: s.desc,
          badge: s.badge,
          apply: s.apply,
        });
      }
    }

    for (const fn of ["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "ln", "log10", "exp", "erf", "fact", "min", "max", "clamp"]) {
      if (fn.startsWith(q)) {
        const arity = fn === "clamp" ? 3 : fn === "min" || fn === "max" ? 2 : 1;
        list.push({
          label: `${fn}( )`,
          desc: `${arity}-argument function`,
          badge: "fn",
          apply: () => insertFunction(fn, arity),
        });
      }
    }

    return list.slice(0, 8);
  }, [
    typeBuffer,
    availableParams,
    insertVariable,
    insertIntegral,
    insertSeries,
    insertDerivative,
    insertSqrt,
    insertNthRoot,
    insertFraction,
    insertMatrix,
    insertVecNorm,
    insertVecDot,
    insertPiecewise,
    insertBinom,
    insertFunction,
  ]);

  // Keyboard event handler on the 2D canvas
  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      handleRedo();
      return;
    }

    // If typeBuffer is active, handle buffer completion or backspace
    if (typeBuffer) {
      if (e.key === "Backspace") {
        e.preventDefault();
        setTypeBuffer((b) => b.slice(0, -1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTypeBuffer("");
        return;
      }
      if (e.key === "Enter" || e.key === "Tab" || e.key === "(") {
        e.preventDefault();
        if (autocompleteItems.length > 0) {
          autocompleteItems[0].apply();
          return;
        }
        commitChange(insertNodesAtCursor(rootRow, cursor, [createVarNode(typeBuffer)]));
        return;
      }
      if (/^[a-zA-Z0-9_]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const nextBuf = typeBuffer + e.key;
        // Exact match on a study parameter or pi? Still allow user to press Enter or continue if prefix of another
        setTypeBuffer(nextBuf);
        return;
      }
      // If user typed an operator (+, -, *, /, ^) while typeBuffer has a valid variable name, commit the variable first!
      if (["+", "-", "*", "/", "^", ")"].includes(e.key)) {
        const matchedParam = availableParams.find((p) => p.key === typeBuffer);
        const varToCommit = matchedParam
          ? matchedParam.key
          : ["pi", "e", "t", "k"].includes(typeBuffer)
          ? typeBuffer
          : typeBuffer;
        const afterVar = insertNodesAtCursor(rootRow, cursor, [
          createVarNode(varToCommit),
        ]);
        setTypeBuffer("");
        if (e.key === "/") {
          e.preventDefault();
          commitChange(insertFractionAtCursor(afterVar.root, afterVar.cursor, true));
          return;
        }
        if (e.key === "^") {
          e.preventDefault();
          commitChange(insertPowerAtCursor(afterVar.root, afterVar.cursor));
          return;
        }
        if (e.key === "+" || e.key === "-" || e.key === "*") {
          e.preventDefault();
          commitChange(
            insertNodesAtCursor(afterVar.root, afterVar.cursor, [
              createOpNode(e.key as MathOp),
            ]),
          );
          return;
        }
        commitChange(afterVar);
        return;
      }
    }

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        setCursor((c) => moveCursorRight(rootRow, c));
        return;
      case "ArrowLeft":
        e.preventDefault();
        setCursor((c) => moveCursorLeft(rootRow, c));
        return;
      case "ArrowUp":
        e.preventDefault();
        setCursor((c) => moveCursorVertical(rootRow, c, "up"));
        return;
      case "ArrowDown":
        e.preventDefault();
        setCursor((c) => moveCursorVertical(rootRow, c, "down"));
        return;
      case "Tab":
        e.preventDefault();
        setCursor((c) => moveCursorTab(rootRow, c, e.shiftKey));
        return;
      case "Backspace":
        e.preventDefault();
        commitChange(backspaceAtCursor(rootRow, cursor));
        return;
      case "Delete": {
        e.preventDefault();
        const stepped = moveCursorRight(rootRow, cursor);
        if (stepped.rowId !== cursor.rowId || stepped.offset !== cursor.offset) {
          commitChange(backspaceAtCursor(rootRow, stepped));
        }
        return;
      }
      case "/":
        e.preventDefault();
        insertFraction(true);
        return;
      case "^":
        e.preventDefault();
        insertPower();
        return;
      case "(":
        e.preventDefault();
        insertWrapper("paren");
        return;
      case ")":
        e.preventDefault();
        setCursor((c) => moveCursorRight(rootRow, c));
        return;
      case "|":
        e.preventDefault();
        insertWrapper("abs");
        return;
      case "+":
      case "-":
      case "*":
      case "%":
      case "<":
      case ">":
        e.preventDefault();
        insertOp(e.key as MathOp);
        return;
      case "=": {
        e.preventDefault();
        // Check if previous node in row is `<`, `>`, or `!` to combine into `<=`, `>=`, `!=`, `==`
        const ctx = findRowContext(rootRow, cursor.rowId);
        if (ctx && cursor.offset > 0) {
          const prev = ctx.row.items[cursor.offset - 1];
          if (prev.kind === "op" && (prev.op === "<" || prev.op === ">")) {
            const nextRoot = cloneMathRow(rootRow);
            const nextCtx = findRowContext(nextRoot, cursor.rowId)!;
            nextCtx.row.items[cursor.offset - 1] = createOpNode(
              (prev.op + "=") as MathOp,
            );
            commitChange({ root: nextRoot, cursor });
            return;
          }
        }
        insertOp("==");
        return;
      }
      default:
        break;
    }

    if (/^[0-9.]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      insertChar(e.key);
      return;
    }

    if (/^[a-zA-Z_]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      // Single-letter dummy variables t or k or e: if user types t or k, start typeBuffer so they can either press space/operator or pick a parameter starting with t/k
      setTypeBuffer(e.key);
    }
  };

  // Load a rich scientific preset into the 2D canvas (or insert at cursor if shift-clicked)
  const loadScientificPreset = (exprStr: string, appendAtCursor = false) => {
    const parsedRow = parseExpressionToMathRow(exprStr);
    if (appendAtCursor && rootRow.items.length > 0) {
      commitChange(insertNodesAtCursor(rootRow, cursor, parsedRow.items));
    } else {
      commitChange({
        root: parsedRow,
        cursor: { rowId: parsedRow.id, offset: parsedRow.items.length },
      });
    }
    focusCanvas();
  };

  // Compute 1D response curve for the primary dependency parameter
  const responseCurveData = useMemo(() => {
    if (!evaluationResult.valid || !evaluationResult.compiledFn) return null;
    const deps = evaluationResult.dependencies;
    if (deps.length === 0) return null;

    const primaryParam =
      availableParams.find((p) => p.key === deps[0] && p.kind !== "categorical") ||
      availableParams.find((p) => deps.includes(p.key));
    if (!primaryParam) return null;

    const s = primaryParam.spec as Record<string, unknown>;
    const min = Number(s.min ?? 0.1);
    const max = Number(s.max ?? 100);
    if (!(max > min)) return null;

    const pts: Array<{ x: number; y: number }> = [];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const x = min + (i / steps) * (max - min);
      const env: Record<string, number> = {};
      for (const v of deps) {
        env[v] = v === primaryParam.key ? x : (sandboxValues[v] ?? nominalValues[v] ?? 1);
      }
      try {
        const y = evaluationResult.compiledFn(env);
        if (Number.isFinite(y)) {
          pts.push({ x, y });
        }
      } catch {
        // skip non-finite point
      }
    }
    if (pts.length < 2) return null;
    return { param: primaryParam, points: pts };
  }, [evaluationResult, availableParams, nominalValues, sandboxValues]);

  // --- Recursive 2D Interactive Canvas Renderer ---

  const renderCaret = (key: string) => (
    <span
      key={key}
      className="symbolab-caret"
      style={{
        display: "inline-block",
        width: 2,
        height: "1.25em",
        background: "#7c3aed",
        verticalAlign: "middle",
        margin: "0 1px",
        borderRadius: 1,
        animation: canvasFocused ? "ll-caret-blink 1s step-end infinite" : "none",
        opacity: canvasFocused ? 1 : 0.35,
      }}
    />
  );

  const renderInteractiveRow = (
    row: MathRow,
    depth = 0,
    slotHint?: string,
  ): React.ReactNode => {
    const isRowActive = cursor.rowId === row.id;
    const isRoot = row.id === rootRow.id;
    const scale = Math.max(0.76, Math.pow(0.92, Math.min(depth, 3)));

    if (row.items.length === 0) {
      return (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setCursor({ rowId: row.id, offset: 0 });
            setTypeBuffer("");
            focusCanvas();
          }}
          title={slotHint || tr("დააწკაპუნეთ შესავსებად", "Click slot to fill")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: isRoot ? 120 : Math.round(24 * scale),
            minHeight: isRoot ? 34 : Math.round(22 * scale),
            padding: isRoot ? "4px 10px" : "2px 6px",
            border: isRowActive
              ? "2px solid #7c3aed"
              : "1.5px dashed rgba(139, 92, 246, 0.55)",
            borderRadius: 4,
            background: isRowActive
              ? "rgba(139, 92, 246, 0.12)"
              : "rgba(139, 92, 246, 0.04)",
            boxShadow: isRowActive ? "0 0 0 3px rgba(139, 92, 246, 0.18)" : "none",
            cursor: "text",
            verticalAlign: "middle",
            transition: "all 0.12s ease",
            color: "var(--ll-text-muted)",
            fontSize: `${11 * scale}px`,
            fontFamily: "var(--ll-font-mono)",
          }}
        >
          {isRowActive ? (
            <>
              {renderCaret(`caret-empty-${row.id}`)}
              {typeBuffer && (
                <span style={{ color: "#7c3aed", fontWeight: 700 }}>{typeBuffer}</span>
              )}
            </>
          ) : isRoot ? (
            <span style={{ opacity: 0.7, fontStyle: "italic" }}>
              {tr("აკრიფეთ ფორმულა ან აირჩიეთ სიმბოლო...", "Type math or click a Symbolab block above...")}
            </span>
          ) : (
            <span style={{ opacity: 0.55, fontSize: `${10 * scale}px` }}>
              {slotHint || "▢"}
            </span>
          )}
        </span>
      );
    }

    const elements: React.ReactNode[] = [];
    for (let i = 0; i <= row.items.length; i++) {
      if (isRowActive && cursor.offset === i) {
        elements.push(renderCaret(`caret-${row.id}-${i}`));
        if (typeBuffer) {
          elements.push(
            <span
              key={`buf-${row.id}-${i}`}
              style={{
                padding: "1px 4px",
                background: "rgba(139, 92, 246, 0.16)",
                border: "1px dashed #7c3aed",
                borderRadius: 3,
                color: "#7c3aed",
                fontFamily: "var(--ll-font-mono)",
                fontWeight: 700,
                fontSize: `${12.5 * scale}px`,
              }}
            >
              {typeBuffer}
            </span>,
          );
        }
      }
      if (i < row.items.length) {
        const node = row.items[i];
        elements.push(
          <span
            key={node.id}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const clickRight = e.clientX - rect.left > rect.width / 2;
              setCursor({ rowId: row.id, offset: clickRight ? i + 1 : i });
              setTypeBuffer("");
              focusCanvas();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              verticalAlign: "middle",
            }}
          >
            {renderInteractiveNode(node, depth, scale)}
          </span>,
        );
      }
    }

    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          setCursor({ rowId: row.id, offset: row.items.length });
          setTypeBuffer("");
          focusCanvas();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          verticalAlign: "middle",
          minHeight: Math.round(24 * scale),
          padding: "1px 3px",
          borderRadius: 4,
          background:
            isRowActive && !isRoot ? "rgba(139, 92, 246, 0.06)" : "transparent",
          outline:
            isRowActive && !isRoot
              ? "1.5px solid rgba(139, 92, 246, 0.4)"
              : "none",
          cursor: "text",
        }}
      >
        {elements}
      </span>
    );
  };

  const renderInteractiveNode = (
    node: MathNode,
    depth: number,
    s: number,
  ): React.ReactNode => {
    switch (node.kind) {
      case "char":
        return (
          <span
            style={{
              fontFamily: "var(--ll-font-mono)",
              fontWeight: 650,
              fontSize: `${14.5 * s}px`,
              color: "var(--ll-text-primary)",
              padding: "0 0.5px",
            }}
          >
            {node.char}
          </span>
        );

      case "var": {
        if (node.name === "pi") {
          return (
            <span
              style={{
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 700,
                fontSize: `${16.5 * s}px`,
                color: "#7c3aed",
                padding: "0 2px",
              }}
            >
              π
            </span>
          );
        }
        if (node.name === "e" || node.name === "t" || node.name === "k") {
          return (
            <span
              style={{
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 700,
                fontSize: `${16 * s}px`,
                color: "#7c3aed",
                padding: "0 2px",
              }}
            >
              {node.name}
            </span>
          );
        }
        const isParam = paramKeySet.has(node.name);
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: `${2 * s}px ${6 * s}px`,
              background: isParam
                ? "rgba(16, 185, 129, 0.12)"
                : "rgba(239, 68, 68, 0.1)",
              color: isParam ? "#059669" : "#dc2626",
              border: isParam
                ? "1px solid rgba(16, 185, 129, 0.38)"
                : "1px solid rgba(239, 68, 68, 0.35)",
              borderRadius: 4,
              fontWeight: 650,
              fontSize: `${12.5 * s}px`,
              fontFamily: "var(--ll-font-mono)",
              margin: "0 2px",
              userSelect: "none",
            }}
          >
            {node.name}
          </span>
        );
      }

      case "op":
        return (
          <span
            style={{
              color: "#6d28d9",
              fontWeight: 700,
              fontSize: `${14.5 * s}px`,
              margin: node.op === "*" ? "0 3px" : "0 5px",
              userSelect: "none",
            }}
          >
            {OP_DISPLAY[node.op] || node.op}
          </span>
        );

      case "frac":
        return (
          <span
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              verticalAlign: "middle",
              margin: "2px 4px",
            }}
          >
            <span
              style={{
                padding: "1px 6px 3px 6px",
                borderBottom: "2px solid var(--ll-text-primary)",
                width: "100%",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {renderInteractiveRow(node.num, depth + 1, "num")}
            </span>
            <span
              style={{
                padding: "3px 6px 1px 6px",
                width: "100%",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {renderInteractiveRow(node.den, depth + 1, "den")}
            </span>
          </span>
        );

      case "pow": {
        const baseHasOp = node.base.items.some(
          (it) => it.kind === "op" || it.kind === "frac",
        );
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              margin: "0 2px",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              {baseHasOp && (
                <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>
                  (
                </span>
              )}
              {renderInteractiveRow(node.base, depth, "x")}
              {baseHasOp && (
                <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>
                  )
                </span>
              )}
            </span>
            <sup
              style={{
                display: "inline-flex",
                transform: "translateY(-0.45em)",
                marginLeft: 2,
              }}
            >
              {renderInteractiveRow(node.exp, depth + 1, "n")}
            </sup>
          </span>
        );
      }

      case "sqrt":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "stretch",
              verticalAlign: "middle",
              margin: "2px 3px",
            }}
          >
            <svg
              width={13 * s}
              viewBox="0 0 14 28"
              preserveAspectRatio="none"
              style={{
                display: "block",
                overflow: "visible",
                color: "#7c3aed",
                marginRight: -1,
              }}
            >
              <path
                d="M 1 16 L 4.5 16 L 8 26 L 13.5 1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                borderTop: "2px solid #7c3aed",
                padding: "3px 6px 2px 4px",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {renderInteractiveRow(node.radicand, depth + 1, "x")}
            </span>
          </span>
        );

      case "nthroot":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              verticalAlign: "middle",
              margin: "2px 3px",
            }}
          >
            <sup
              style={{
                transform: "translateY(-0.55em)",
                marginRight: -3,
                zIndex: 1,
              }}
            >
              {renderInteractiveRow(node.degree, depth + 2, "n")}
            </sup>
            <span style={{ display: "inline-flex", alignItems: "stretch" }}>
              <svg
                width={13 * s}
                viewBox="0 0 14 28"
                preserveAspectRatio="none"
                style={{
                  display: "block",
                  overflow: "visible",
                  color: "#7c3aed",
                  marginRight: -1,
                }}
              >
                <path
                  d="M 1 16 L 4.5 16 L 8 26 L 13.5 1.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                style={{
                  borderTop: "2px solid #7c3aed",
                  padding: "3px 6px 2px 4px",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                {renderInteractiveRow(node.radicand, depth + 1, "x")}
              </span>
            </span>
          </span>
        );

      case "abs":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "2.2px solid #7c3aed",
              borderRight: "2.2px solid #7c3aed",
              padding: "2px 6px",
              margin: "0 3px",
            }}
          >
            {renderInteractiveRow(node.inner, depth, "x")}
          </span>
        );

      case "floor":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "2.2px solid #7c3aed",
              borderRight: "2.2px solid #7c3aed",
              borderBottom: "2.2px solid #7c3aed",
              padding: "2px 6px",
              margin: "0 3px",
            }}
          >
            {renderInteractiveRow(node.inner, depth, "x")}
          </span>
        );

      case "ceil":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "2.2px solid #7c3aed",
              borderRight: "2.2px solid #7c3aed",
              borderTop: "2.2px solid #7c3aed",
              padding: "2px 6px",
              margin: "0 3px",
            }}
          >
            {renderInteractiveRow(node.inner, depth, "x")}
          </span>
        );

      case "paren":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              margin: "0 2px",
            }}
          >
            <span
              style={{
                fontSize: `${18 * s}px`,
                color: "#7c3aed",
                fontWeight: 500,
                paddingRight: 2,
                userSelect: "none",
              }}
            >
              (
            </span>
            {renderInteractiveRow(node.inner, depth, "…")}
            <span
              style={{
                fontSize: `${18 * s}px`,
                color: "#7c3aed",
                fontWeight: 500,
                paddingLeft: 2,
                userSelect: "none",
              }}
            >
              )
            </span>
          </span>
        );

      case "integral":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              margin: "2px 4px",
              padding: "2px 4px",
              borderRadius: 6,
              background: "rgba(139, 92, 246, 0.03)",
            }}
          >
            <span
              style={{
                fontSize: `${40 * s}px`,
                lineHeight: 0.9,
                color: "#7c3aed",
                fontFamily: "'Times New Roman', Georgia, serif",
                userSelect: "none",
              }}
            >
              ∫
            </span>
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 6,
                marginRight: 2,
              }}
            >
              <span>{renderInteractiveRow(node.upper, depth + 2, "b")}</span>
              <span>{renderInteractiveRow(node.lower, depth + 2, "a")}</span>
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 4px",
              }}
            >
              {renderInteractiveRow(node.integrand, depth, "f(t)")}
            </span>
            <span
              style={{
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 700,
                color: "#7c3aed",
                fontSize: `${15 * s}px`,
                marginLeft: 2,
                userSelect: "none",
              }}
            >
              d{node.dVar || "t"}
            </span>
          </span>
        );

      case "sum":
      case "prod": {
        const sym = node.kind === "sum" ? "∑" : "∏";
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              margin: "2px 4px",
              padding: "2px 4px",
              borderRadius: 6,
              background: "rgba(139, 92, 246, 0.03)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <span>{renderInteractiveRow(node.end, depth + 2, "N")}</span>
              <span
                style={{
                  fontSize: `${30 * s}px`,
                  lineHeight: 0.9,
                  color: "#7c3aed",
                  fontFamily: "'Times New Roman', Georgia, serif",
                  userSelect: "none",
                }}
              >
                {sym}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  fontSize: `${11 * s}px`,
                  color: "var(--ll-text-secondary)",
                }}
              >
                <i
                  style={{
                    fontFamily: "'Times New Roman', serif",
                    fontWeight: 700,
                    color: "#7c3aed",
                  }}
                >
                  {node.indexVar || "k"}=
                </i>
                {renderInteractiveRow(node.start, depth + 2, "1")}
              </span>
            </span>
            <span style={{ padding: "2px 4px" }}>
              {renderInteractiveRow(node.term, depth, "a_k")}
            </span>
          </span>
        );
      }

      case "deriv":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              margin: "2px 4px",
              padding: "2px 4px",
              borderRadius: 6,
              background: "rgba(139, 92, 246, 0.03)",
            }}
          >
            <span
              onClick={(e) => {
                e.stopPropagation();
                mutateNodeById(node.id, (n) =>
                  n.kind === "deriv" ? { ...n, order: n.order === 1 ? 2 : 1 } : n,
                );
              }}
              title={tr("დააწკაპუნეთ 1-ლი / მე-2 წარმოებულის გადასართავად", "Click to toggle 1st / 2nd derivative")}
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                lineHeight: 1,
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 700,
                color: "#7c3aed",
                fontSize: `${13 * s}px`,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <span style={{ borderBottom: "1.5px solid #7c3aed", padding: "0 3px 1px 3px" }}>
                d{node.order === 2 ? "²" : ""}
              </span>
              <span style={{ paddingTop: 1 }}>dt{node.order === 2 ? "²" : ""}</span>
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderLeft: "1.8px solid var(--ll-text-secondary)",
                borderRight: "2px solid #7c3aed",
                padding: "2px 6px",
              }}
            >
              {renderInteractiveRow(node.body, depth, "f(t)")}
            </span>
            <sub
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                color: "#7c3aed",
                fontSize: `${10.5 * s}px`,
              }}
            >
              <i style={{ fontFamily: "'Times New Roman', serif", fontWeight: 700 }}>t=</i>
              {renderInteractiveRow(node.atPoint, depth + 2, "t₀")}
            </sub>
          </span>
        );

      case "matrix": {
        const nextOpMap: Record<"det" | "trace" | "fnorm", "det" | "trace" | "fnorm"> = {
          det: "trace",
          trace: "fnorm",
          fnorm: "det",
        };
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              margin: "3px 5px",
              verticalAlign: "middle",
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                mutateNodeById(node.id, (n) =>
                  n.kind === "matrix" ? { ...n, op: nextOpMap[n.op] } : n,
                );
              }}
              title={tr(
                "დააწკაპუნეთ მატრიცის ოპერაციის შესაცვლელად (det / tr / ‖A‖_F)",
                "Click to cycle Matrix operation (det → tr → ‖A‖_F)",
              )}
              style={{
                fontSize: `${11 * s}px`,
                fontWeight: 700,
                color: "#7c3aed",
                background: "rgba(139, 92, 246, 0.1)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                borderRadius: 4,
                padding: "2px 5px",
                cursor: "pointer",
                fontFamily: "var(--ll-font-mono)",
              }}
            >
              {node.op === "det" ? "det" : node.op === "trace" ? "tr" : "‖·‖_F"}
            </button>

            <span
              style={{
                display: "inline-grid",
                gridTemplateColumns: `repeat(${node.size}, auto)`,
                gap: 5,
                padding: "5px 8px",
                borderLeft:
                  node.op === "det"
                    ? "2.5px solid var(--ll-text-primary)"
                    : "2.5px solid #7c3aed",
                borderRight:
                  node.op === "det"
                    ? "2.5px solid var(--ll-text-primary)"
                    : "2.5px solid #7c3aed",
                borderRadius: node.op === "det" ? 0 : 4,
                background: "var(--ll-surface)",
              }}
            >
              {node.cells.map((cell, idx) => {
                const r = Math.floor(idx / node.size) + 1;
                const c = (idx % node.size) + 1;
                return (
                  <span key={cell.id} style={{ display: "flex", justifyContent: "center" }}>
                    {renderInteractiveRow(cell, depth + 1, `a${r}${c}`)}
                  </span>
                );
              })}
            </span>
          </span>
        );
      }

      case "vecnorm":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              margin: "2px 4px",
              verticalAlign: "middle",
            }}
          >
            <span style={{ fontSize: `${22 * s}px`, fontWeight: 700, color: "#7c3aed" }}>
              ‖
            </span>
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "3px 6px",
                borderLeft: "1.5px solid var(--ll-text-secondary)",
                borderRight: "1.5px solid var(--ll-text-secondary)",
                borderRadius: 6,
                background: "var(--ll-surface)",
              }}
            >
              {node.coords.map((c, idx) => (
                <span key={c.id}>
                  {renderInteractiveRow(
                    c,
                    depth + 1,
                    idx === 0 ? "x" : idx === 1 ? "y" : "z",
                  )}
                </span>
              ))}
            </span>
            <span style={{ fontSize: `${22 * s}px`, fontWeight: 700, color: "#7c3aed" }}>
              ‖
            </span>
            <sub
              onClick={(e) => {
                e.stopPropagation();
                mutateNodeById(node.id, (n) => {
                  if (n.kind !== "vecnorm") return n;
                  if (n.dim === 2) {
                    return { ...n, dim: 3, coords: [...n.coords, createEmptyRow([])] };
                  }
                  return { ...n, dim: 2, coords: n.coords.slice(0, 2) };
                });
              }}
              title={tr("2D / 3D გადართვა", "Click to toggle 2D / 3D vector")}
              style={{
                fontSize: `${10 * s}px`,
                fontWeight: 700,
                color: "#7c3aed",
                cursor: "pointer",
              }}
            >
              2 ({node.dim}D)
            </sub>
          </span>
        );

      case "vecdot":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              margin: "2px 4px",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "3px 6px",
                borderLeft: "2px solid var(--ll-text-primary)",
                borderRight: "2px solid var(--ll-text-primary)",
                borderRadius: 6,
                background: "var(--ll-surface)",
              }}
            >
              {node.left.map((c, i) => (
                <span key={c.id}>{renderInteractiveRow(c, depth + 1, `u${i + 1}`)}</span>
              ))}
            </span>
            <span style={{ fontSize: `${18 * s}px`, fontWeight: 800, color: "#7c3aed" }}>
              ·
            </span>
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "3px 6px",
                borderLeft: "2px solid var(--ll-text-primary)",
                borderRight: "2px solid var(--ll-text-primary)",
                borderRadius: 6,
                background: "var(--ll-surface)",
              }}
            >
              {node.right.map((c, i) => (
                <span key={c.id}>{renderInteractiveRow(c, depth + 1, `v${i + 1}`)}</span>
              ))}
            </span>
          </span>
        );

      case "logbase":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              margin: "0 2px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--ll-font-mono)",
                fontWeight: 700,
                color: "#7c3aed",
                fontSize: `${13.5 * s}px`,
              }}
            >
              log
            </span>
            <sub style={{ transform: "translateY(0.35em)", marginRight: 2 }}>
              {renderInteractiveRow(node.base, depth + 2, "b")}
            </sub>
            <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>(</span>
            {renderInteractiveRow(node.arg, depth, "x")}
            <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>)</span>
          </span>
        );

      case "binom":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "2px solid #7c3aed",
              borderRight: "2px solid #7c3aed",
              borderRadius: 10,
              padding: "2px 7px",
              margin: "0 3px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
              }}
            >
              <span>{renderInteractiveRow(node.n, depth + 1, "n")}</span>
              <span>{renderInteractiveRow(node.k, depth + 1, "k")}</span>
            </span>
          </span>
        );

      case "piecewise":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              margin: "3px 5px",
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(139, 92, 246, 0.03)",
            }}
          >
            <span
              style={{
                fontSize: `${36 * s}px`,
                color: "#7c3aed",
                fontWeight: 300,
                lineHeight: 0.9,
                fontFamily: "serif",
                userSelect: "none",
              }}
            >
              {"{"}
            </span>
            <span
              style={{
                display: "inline-grid",
                gridTemplateColumns: "auto auto",
                columnGap: 10,
                rowGap: 5,
                alignItems: "center",
              }}
            >
              <span>{renderInteractiveRow(node.thenRow, depth + 1, "val₁")}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: `${11.5 * s}px`,
                  color: "#7c3aed",
                  fontWeight: 600,
                }}
              >
                <span>if</span>
                {renderInteractiveRow(node.cond, depth + 1, "x > 0")}
              </span>
              <span>{renderInteractiveRow(node.elseRow, depth + 1, "val₂")}</span>
              <span
                style={{
                  fontSize: `${11.5 * s}px`,
                  color: "var(--ll-text-muted)",
                  fontStyle: "italic",
                }}
              >
                otherwise
              </span>
            </span>
          </span>
        );

      case "fn": {
        if (node.fn === "fact" && node.args.length === 1) {
          return (
            <span style={{ display: "inline-flex", alignItems: "center", margin: "0 2px" }}>
              <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>(</span>
              {renderInteractiveRow(node.args[0], depth, "n")}
              <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>)</span>
              <span
                style={{
                  fontWeight: 800,
                  color: "#7c3aed",
                  fontSize: `${15 * s}px`,
                  marginLeft: 1,
                }}
              >
                !
              </span>
            </span>
          );
        }
        const label = FN_DISPLAY[node.fn] || node.fn;
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              margin: "0 2px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--ll-font-mono)",
                fontWeight: 700,
                color: "#7c3aed",
                fontSize: `${13.5 * s}px`,
                marginRight: 1,
                userSelect: "none",
              }}
            >
              {label}
            </span>
            <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>(</span>
            {node.args.map((arg, idx) => (
              <React.Fragment key={arg.id}>
                {idx > 0 && (
                  <span
                    style={{
                      color: "var(--ll-text-muted)",
                      fontWeight: 700,
                      margin: "0 3px",
                    }}
                  >
                    ,
                  </span>
                )}
                {renderInteractiveRow(
                  arg,
                  depth,
                  node.fn === "clamp"
                    ? idx === 0
                      ? "x"
                      : idx === 1
                      ? "min"
                      : "max"
                    : "x",
                )}
              </React.Fragment>
            ))}
            <span style={{ color: "var(--ll-text-muted)", fontSize: `${15 * s}px` }}>)</span>
          </span>
        );
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      <style>{`
        @keyframes ll-caret-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .symbolab-key-btn {
          height: 40px;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2px 6px;
          background: var(--ll-surface-subtle);
          border: 1px solid var(--ll-border);
          border-radius: 6px;
          color: var(--ll-text-primary);
          cursor: pointer;
          transition: all 0.12s ease;
          user-select: none;
          position: relative;
        }
        .symbolab-key-btn:hover {
          border-color: #8b5cf6;
          background: rgba(139, 92, 246, 0.08);
          transform: translateY(-1px);
          box-shadow: 0 2px 6px rgba(139, 92, 246, 0.12);
        }
        .symbolab-key-btn:active {
          transform: translateY(0);
        }
      `}</style>

      {/* 1. Symbolab Categorized Math Pad & Toolbar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          background: "var(--ll-surface)",
          border: "1px solid var(--ll-border)",
          borderRadius: "var(--ll-radius-md)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
        }}
      >
        {/* Top Category Ribbon + Undo/Redo/Clear */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--ll-border)",
            paddingBottom: 8,
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(
              [
                {
                  id: "popular",
                  label: tr("★ ძირითადი & ალგებრა", "★ Popular & Algebra"),
                },
                {
                  id: "calculus",
                  label: tr("∫ ∑ ∏ კალკულუსი & მწკრივები", "∫ ∑ ∏ Calculus & Series"),
                },
                {
                  id: "matrices",
                  label: tr("|A| ‖v‖ მატრიცები & ვექტორები", "|A| ‖v‖ Matrices & Vectors"),
                },
                {
                  id: "triglog",
                  label: tr("sin ln ტრიგონომეტრია & ლოგ", "sin ln Trig & Log"),
                },
                {
                  id: "piecewise",
                  label: tr("{if} პირობითი & საზღვრები", "{if} Piecewise & Bounds"),
                },
                {
                  id: "presets",
                  label: tr("📚 სამეცნიერო შაბლონები", "📚 Scientific Templates"),
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  fontSize: 11.5,
                  fontWeight: activeTab === tab.id ? 700 : 550,
                  padding: "5px 9px",
                  borderRadius: 5,
                  border:
                    activeTab === tab.id
                      ? "1px solid rgba(139, 92, 246, 0.35)"
                      : "1px solid transparent",
                  background:
                    activeTab === tab.id ? "rgba(139, 92, 246, 0.12)" : "transparent",
                  color: activeTab === tab.id ? "#6d28d9" : "var(--ll-text-secondary)",
                  cursor: "pointer",
                  transition: "all 0.12s ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* History & Utility Actions */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleUndo}
              disabled={history.length === 0}
              title="Undo (Ctrl+Z)"
              style={{ padding: "4px 6px", opacity: history.length === 0 ? 0.35 : 1 }}
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleRedo}
              disabled={future.length === 0}
              title="Redo (Ctrl+Y)"
              style={{ padding: "4px 6px", opacity: future.length === 0 ? 0.35 : 1 }}
            >
              <Redo2 size={14} />
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                commitChange(backspaceAtCursor(rootRow, cursor));
                focusCanvas();
              }}
              title="Backspace"
              style={{ padding: "4px 7px", fontSize: 11, fontWeight: 600 }}
            >
              ⌫
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleClear}
              title={tr("გასუფთავება", "Clear formula canvas")}
              style={{ padding: "4px 6px", color: "var(--ll-rose)" }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* TAB 1: Popular & Algebra */}
        {activeTab === "popular" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
              gap: 6,
            }}
          >
            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertFraction(true)}
              title="Stacked Fraction (Shortcut: /)"
            >
              <span style={{ fontSize: 11, lineHeight: 1, borderBottom: "1.5px solid currentColor", padding: "0 3px" }}>▢</span>
              <span style={{ fontSize: 11, lineHeight: 1, paddingTop: 1 }}>▢</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertPower()}
              title="Exponent / Superscript (Shortcut: ^)"
            >
              <span style={{ fontSize: 13, fontWeight: 650 }}>
                x<sup style={{ fontSize: 10, color: "#7c3aed" }}>▢</sup>
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertPower("2")}
              title="Square x²"
            >
              <span style={{ fontSize: 13, fontWeight: 650 }}>
                x<sup style={{ fontSize: 10, color: "#7c3aed" }}>2</sup>
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertPower("3")}
              title="Cube x³"
            >
              <span style={{ fontSize: 13, fontWeight: 650 }}>
                x<sup style={{ fontSize: 10, color: "#7c3aed" }}>3</sup>
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertPower("-1")}
              title="Reciprocal x⁻¹"
            >
              <span style={{ fontSize: 13, fontWeight: 650 }}>
                x<sup style={{ fontSize: 9.5, color: "#7c3aed" }}>−1</sup>
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={insertSqrt}
              title="Square Root √x"
            >
              <span style={{ fontSize: 13, fontWeight: 650 }}>
                <span style={{ color: "#7c3aed" }}>√</span>
                <span style={{ borderTop: "1.4px solid #7c3aed", paddingTop: 1 }}>▢</span>
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertNthRoot()}
              title="n-th Root ⁿ√x"
            >
              <span style={{ fontSize: 12.5, fontWeight: 650 }}>
                <sup style={{ fontSize: 9, color: "#7c3aed" }}>▢</sup>
                <span style={{ color: "#7c3aed" }}>√</span>
                <span style={{ borderTop: "1.4px solid #7c3aed", paddingTop: 1 }}>▢</span>
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertWrapper("abs")}
              title="Absolute Value |x| (Shortcut: |)"
            >
              <span style={{ fontSize: 13, fontWeight: 650, color: "#7c3aed" }}>|▢|</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertWrapper("paren")}
              title="Parentheses (x) (Shortcut: ()"
            >
              <span style={{ fontSize: 13, fontWeight: 650 }}>(▢)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertIntegral()}
              title="Definite Integral ∫_a^b f(t) dt"
            >
              <span style={{ fontSize: 13.5, fontWeight: 650, color: "#7c3aed", fontFamily: "serif" }}>
                ∫<sub style={{ fontSize: 8 }}>a</sub><sup style={{ fontSize: 8 }}>b</sup>▢
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertSeries("sum")}
              title="Summation ∑_{k=a}^b"
            >
              <span style={{ fontSize: 13.5, fontWeight: 650, color: "#7c3aed", fontFamily: "serif" }}>
                ∑<sub style={{ fontSize: 8 }}>k</sub>▢
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertSeries("prod")}
              title="Product ∏_{k=a}^b"
            >
              <span style={{ fontSize: 13.5, fontWeight: 650, color: "#7c3aed", fontFamily: "serif" }}>
                ∏<sub style={{ fontSize: 8 }}>k</sub>▢
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertMatrix("det", 2)}
              title="2×2 Matrix Determinant |A|"
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, borderLeft: "1.8px solid #7c3aed", borderRight: "1.8px solid #7c3aed", padding: "0 4px" }}>
                2×2
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertFunction("fact", 1)}
              title="Factorial / Gamma n!"
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>▢!</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={insertBinom}
              title="Binomial Coefficient (n choose k)"
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>(ⁿₖ)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVariable("pi")}
              title="Pi Constant π ≈ 3.14159"
            >
              <span style={{ fontSize: 15, fontStyle: "italic", fontFamily: "serif", fontWeight: 700, color: "#7c3aed" }}>
                π
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVariable("e")}
              title="Euler's Number e ≈ 2.71828"
            >
              <span style={{ fontSize: 14, fontStyle: "italic", fontFamily: "serif", fontWeight: 700, color: "#7c3aed" }}>
                e
              </span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertOp("+")}
              title="Add +"
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>+</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertOp("-")}
              title="Subtract −"
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>−</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertOp("*")}
              title="Multiply ·"
            >
              <span style={{ fontSize: 16, fontWeight: 700 }}>·</span>
            </button>
          </div>
        )}

        {/* TAB 2: Calculus & Series */}
        {activeTab === "calculus" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
              gap: 6,
            }}
          >
            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertIntegral()}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                ∫<sub>▢</sub><sup>▢</sup> ▢ dt
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Definite Integral</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() =>
                insertIntegral(
                  "0",
                  availableParams.find((p) => p.key.includes("lead"))?.key,
                )
              }
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                ∫<sub>0</sub><sup>T</sup> f(t) dt
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Time Integral [0..T]</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertDerivative(1)}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                d/dt [▢] |<sub>t=▢</sub>
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>1st Derivative</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertDerivative(2)}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                d²/dt² [▢] |<sub>t=▢</sub>
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>2nd Derivative</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertSeries("sum", "1")}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                ∑<sub>k=1</sub><sup>▢</sup> ▢
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Summation (Sigma)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertSeries("prod", "1")}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                ∏<sub>k=1</sub><sup>▢</sup> ▢
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Indexed Product (Pi)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVariable("t")}
            >
              <span style={{ fontSize: 14, fontStyle: "italic", fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                t
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Dummy var (dt)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVariable("k")}
            >
              <span style={{ fontSize: 14, fontStyle: "italic", fontWeight: 700, color: "#7c3aed", fontFamily: "serif" }}>
                k
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Index var (∑/∏)</span>
            </button>
          </div>
        )}

        {/* TAB 3: Matrices & Vectors */}
        {activeTab === "matrices" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(115px, 1fr))",
              gap: 6,
            }}
          >
            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertMatrix("det", 2)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                det | 2×2 |
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>2×2 Determinant</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertMatrix("det", 3)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                det | 3×3 |
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>3×3 Determinant</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertMatrix("trace", 2)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                tr [ 2×2 ]
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>2×2 Matrix Trace</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertMatrix("trace", 3)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                tr [ 3×3 ]
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>3×3 Matrix Trace</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertMatrix("fnorm", 2)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                ‖ A₂ₓ₂ ‖_F
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Frobenius Norm 2×2</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertMatrix("fnorm", 3)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                ‖ A₃ₓ₃ ‖_F
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Frobenius Norm 3×3</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVecNorm(2)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                ‖ (x, y) ‖₂
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>2D Euclidean Norm</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVecNorm(3)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                ‖ (x, y, z) ‖₂
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>3D Euclidean Norm</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVecDot(2)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                u₂ · v₂
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>2D Dot Product</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertVecDot(3)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                u₃ · v₃
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>3D Dot Product</span>
            </button>
          </div>
        )}

        {/* TAB 4: Trig, Log & Special */}
        {activeTab === "triglog" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))",
              gap: 6,
            }}
          >
            {[
              { label: "sin(▢)", action: () => insertFunction("sin", 1) },
              { label: "cos(▢)", action: () => insertFunction("cos", 1) },
              { label: "tan(▢)", action: () => insertFunction("tan", 1) },
              { label: "sin⁻¹", action: () => insertFunction("asin", 1) },
              { label: "cos⁻¹", action: () => insertFunction("acos", 1) },
              { label: "tan⁻¹", action: () => insertFunction("atan", 1) },
              { label: "atan2", action: () => insertFunction("atan2", 2) },
              { label: "sinh(▢)", action: () => insertFunction("sinh", 1) },
              { label: "cosh(▢)", action: () => insertFunction("cosh", 1) },
              { label: "tanh(▢)", action: () => insertFunction("tanh", 1) },
              { label: "ln(▢)", action: () => insertFunction("ln", 1) },
              { label: "log₁₀(▢)", action: () => insertFunction("log10", 1) },
              { label: "log_b(▢)", action: () => insertLogBase() },
              { label: "log₂(▢)", action: () => insertLogBase("2") },
              { label: "exp(▢)", action: () => insertFunction("exp", 1) },
              { label: "erf(▢)", action: () => insertFunction("erf", 1) },
            ].map((b, idx) => (
              <button
                key={idx}
                type="button"
                className="symbolab-key-btn"
                onClick={b.action}
                style={{ fontFamily: "var(--ll-font-mono)", fontSize: 12, fontWeight: 650, color: "#6d28d9" }}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}

        {/* TAB 5: Piecewise, Bounds & Logic */}
        {activeTab === "piecewise" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 6,
            }}
          >
            <button
              type="button"
              className="symbolab-key-btn"
              onClick={insertPiecewise}
              style={{ gridColumn: "span 2" }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                {"{ ▢ if ▢ ; ▢ otherwise"}
              </span>
              <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)" }}>Piecewise Function</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertFunction("min", 2)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>min(▢, ▢)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertFunction("max", 2)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>max(▢, ▢)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertFunction("clamp", 3)}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#7c3aed" }}>clamp(x,a,b)</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertWrapper("floor")}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>⌊▢⌋ floor</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertWrapper("ceil")}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>⌈▢⌉ ceil</span>
            </button>

            <button
              type="button"
              className="symbolab-key-btn"
              onClick={() => insertFunction("round", 1)}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>round(▢)</span>
            </button>

            {(
              [
                { label: "<", op: "<" },
                { label: "≤", op: "<=" },
                { label: ">", op: ">" },
                { label: "≥", op: ">=" },
                { label: "=", op: "==" },
                { label: "≠", op: "!=" },
                { label: "∧ (AND)", op: "&&" },
                { label: "∨ (OR)", op: "||" },
              ] as const
            ).map((item) => (
              <button
                key={item.op}
                type="button"
                className="symbolab-key-btn"
                onClick={() => insertOp(item.op)}
                style={{ fontSize: 13, fontWeight: 700 }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* TAB 6: Scientific Presets */}
        {activeTab === "presets" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(195px, 1fr))",
              gap: 6,
            }}
          >
            {(() => {
              const f = availableParams.find((p) => p.key.includes("flow"))?.key ?? availableParams[0]?.key ?? "a";
              const n = availableParams.find((p) => p.key.includes("nozzle"))?.key ?? availableParams[1]?.key ?? "b";
              const d = availableParams.find((p) => p.key.includes("drop"))?.key ?? availableParams[0]?.key ?? "a";
              const lead = availableParams.find((p) => p.key.includes("lead"))?.key ?? availableParams[2]?.key ?? "1";
              const amp = availableParams.find((p) => p.key.includes("amp"))?.key ?? availableParams[0]?.key ?? "a";

              const presets = [
                {
                  title: "∫ Cumulative Impulse / Mass",
                  subtitle: `∫_0^${lead} (${f}/60)·${n}·e^(-0.05t) dt`,
                  expr: `integral(0, ${lead}, (${f} / 60) * ${n} * exp(-0.05 * t))`,
                },
                {
                  title: "∏ Multi-Stage Survival Product",
                  subtitle: `∏_{k=1}^${n} (1 - 0.03 / √k)`,
                  expr: `prod(1, ${n}, 1 - (0.03 / sqrt(k)))`,
                },
                {
                  title: "∑ Harmonic Nozzle Cascade",
                  subtitle: `∑_{k=1}^${n} (${d} / k²)`,
                  expr: `sum(1, ${n}, ${d} / (k^2))`,
                },
                {
                  title: "|A|₂ₓ₂ Coupled Jacobian Det",
                  subtitle: `det2(${amp}, 0.25·${f}, 0.1, ${d})`,
                  expr: `det2(${amp}, 0.25 * ${f}, 0.1, ${d})`,
                },
                {
                  title: "|A|₃ₓ₃ 3D Dispersion Matrix Det",
                  subtitle: "3×3 coupled stiffness / dispersion",
                  expr: `det3(${amp}, 0.2, 0, 0.2, ${d}, 0.1, 0, 0.1, ${f})`,
                },
                {
                  title: "‖v‖₂ Combined Flux & Root",
                  subtitle: `√(${f}² + ${d}²) / ${n}`,
                  expr: `norm2(${f}, ${d}) / ${n}`,
                },
                {
                  title: "{if} Piecewise Regime Law",
                  subtitle: "Laminar vs. turbulent transition",
                  expr: `if(${f} <= 50, 0.85 * sqrt(${f}), 1.25 * ln(${f}) * ${n})`,
                },
                {
                  title: "d/dt Instantaneous Rate",
                  subtitle: "Derivative of decay law at t = 0.5",
                  expr: `deriv(0.5, ${amp} * exp(-0.15 * t) * cos(2 * pi * t))`,
                },
              ];

              return presets.map((pr, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => loadScientificPreset(pr.expr, false)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: "7px 10px",
                    background: "var(--ll-surface-subtle)",
                    border: "1px solid var(--ll-border)",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.12s ease",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.borderColor = "#8b5cf6")}
                  onMouseOut={(e) => (e.currentTarget.style.borderColor = "var(--ll-border)")}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#6d28d9" }}>
                    {pr.title}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: "var(--ll-text-secondary)",
                      fontFamily: "var(--ll-font-mono)",
                      marginTop: 2,
                    }}
                  >
                    {pr.subtitle}
                  </span>
                </button>
              ));
            })()}
          </div>
        )}

        {/* Study Parameter Chips Bar (Always visible for 1-click insertion at cursor) */}
        <div
          style={{
            marginTop: 2,
            paddingTop: 8,
            borderTop: "1px dashed var(--ll-border)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "var(--ll-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
              }}
            >
              {tr(
                "კვლევის პარამეტრები (დააწკაპუნეთ კურსორის პოზიციაზე ჩასასმელად):",
                "Study Parameters (Click to insert at cursor):",
              )}
            </span>
            <span style={{ fontSize: 10.5, color: "var(--ll-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Keyboard size={12} />
              <span>
                {tr(
                  "მალსახმობები: / წილადი · ^ ხარისხი · ( ფრჩხილი · Tab შემდეგი სლოტი ▢",
                  "Shortcuts:  / fraction  ·  ^ power  ·  ( ) parens  ·  Tab next ▢",
                )}
              </span>
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {availableParams.map((p) => {
              const val = nominalValues[p.key];
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => insertVariable(p.key)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 8px",
                    background: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.32)",
                    borderRadius: 5,
                    color: "#059669",
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontFamily: "var(--ll-font-mono)",
                    fontWeight: 650,
                    transition: "all 0.12s ease",
                  }}
                >
                  <span>+ {p.key}</span>
                  {val !== undefined && (
                    <span style={{ fontSize: 10, opacity: 0.78, fontWeight: 500 }}>
                      ({Number(val).toFixed(1)}
                      {p.unit ? ` ${p.unit}` : ""})
                    </span>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => insertVariable("t")}
              style={{
                padding: "3px 8px",
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                borderRadius: 5,
                color: "#7c3aed",
                cursor: "pointer",
                fontSize: 11.5,
                fontFamily: "'Times New Roman', serif",
                fontStyle: "italic",
                fontWeight: 700,
              }}
            >
              + t
            </button>

            <button
              type="button"
              onClick={() => insertVariable("k")}
              style={{
                padding: "3px 8px",
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                borderRadius: 5,
                color: "#7c3aed",
                cursor: "pointer",
                fontSize: 11.5,
                fontFamily: "'Times New Roman', serif",
                fontStyle: "italic",
                fontWeight: 700,
              }}
            >
              + k
            </button>
          </div>
        </div>
      </div>

      {/* 2. Interactive 2D WYSIWYG Symbolab Canvas */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 14,
          background: "var(--ll-surface)",
          border: canvasFocused
            ? "2px solid #8b5cf6"
            : "2px solid rgba(139, 92, 246, 0.32)",
          borderRadius: "var(--ll-radius-lg)",
          boxShadow: canvasFocused
            ? "0 0 0 3px rgba(139, 92, 246, 0.12)"
            : "0 2px 8px rgba(0,0,0,0.03)",
          transition: "all 0.15s ease",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: "#6d28d9",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Sparkles size={14} />
            <span>
              {tr(
                "2D ინტერაქტიული ფორმულის რედაქტორი (დააწკაპუნეთ ნებისმიერ სლოტზე ▢):",
                "Interactive 2D Formula Canvas (Click any slot ▢ or use arrow keys):",
              )}
            </span>
          </span>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {emptyStats.count > 0 && emptyStats.firstEmptyRowId && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setCursor({ rowId: emptyStats.firstEmptyRowId!, offset: 0 });
                  focusCanvas();
                }}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  color: "#7c3aed",
                  background: "rgba(139, 92, 246, 0.1)",
                  border: "1px solid rgba(139, 92, 246, 0.3)",
                }}
              >
                <span>
                  {tr(
                    `შემდეგ ▢ სლოტზე გადასვლა (${emptyStats.count})`,
                    `Jump to next ▢ (${emptyStats.count} left)`,
                  )}
                </span>
              </button>
            )}

            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowSandbox((s) => !s)}
              style={{
                fontSize: 11,
                padding: "2px 7px",
                color: showSandbox ? "#059669" : "var(--ll-text-secondary)",
              }}
            >
              <Sliders size={12} />
              <span>{tr("What-If სიმულატორი", "What-If Sandbox")}</span>
            </button>

            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowRawCode((s) => !s)}
              style={{ fontSize: 11, padding: "2px 7px", color: "var(--ll-text-secondary)" }}
            >
              <Code size={12} />
              <span>{showRawCode ? tr("კოდის დამალვა", "Hide Text AST") : tr("ტექსტური კოდი", "Text / Paste")}</span>
            </button>
          </div>
        </div>

        {/* Focusable 2D Equation Surface */}
        <div
          ref={canvasRef}
          tabIndex={0}
          onFocus={() => setCanvasFocused(true)}
          onBlur={() => setCanvasFocused(false)}
          onKeyDown={handleCanvasKeyDown}
          onClick={() => {
            setCursor({ rowId: rootRow.id, offset: rootRow.items.length });
            setTypeBuffer("");
            focusCanvas();
          }}
          style={{
            minHeight: 96,
            padding: "16px 20px",
            background: "var(--ll-surface-subtle)",
            borderRadius: "var(--ll-radius-md)",
            border: "1px solid var(--ll-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            overflowX: "auto",
            outline: "none",
            cursor: "text",
          }}
        >
          {/* LHS Function Signature */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              marginRight: 10,
              userSelect: "none",
              color: "var(--ll-text-secondary)",
              fontFamily: "'Times New Roman', Georgia, serif",
              fontSize: 16,
              fontStyle: "italic",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            <span style={{ color: "var(--ll-text-primary)" }}>
              {currentParamKey || "f"}
            </span>
            <span style={{ fontStyle: "normal", color: "var(--ll-text-muted)", margin: "0 1px" }}>
              (
            </span>
            <span
              style={{
                fontStyle: "normal",
                fontFamily: "var(--ll-font-mono)",
                fontSize: 11.5,
                color: "#059669",
              }}
            >
              {evaluationResult.dependencies.length > 0
                ? evaluationResult.dependencies.join(", ")
                : "…"}
            </span>
            <span style={{ fontStyle: "normal", color: "var(--ll-text-muted)", margin: "0 1px" }}>
              )
            </span>
            <span style={{ fontStyle: "normal", margin: "0 8px", color: "var(--ll-text-primary)" }}>
              =
            </span>
          </span>

          {/* Interactive 2D Tree */}
          <div style={{ display: "inline-flex", alignItems: "center", flex: 1 }}>
            {renderInteractiveRow(rootRow, 0)}
          </div>
        </div>

        {/* Floating Autocomplete Dropdown when typing letters on keyboard */}
        {typeBuffer && autocompleteItems.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 8,
              background: "var(--ll-surface)",
              border: "1px solid #8b5cf6",
              borderRadius: 6,
              boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ll-text-muted)" }}>
              <span>
                {tr("ავტო-შევსება", "Autocomplete for")} <strong>"{typeBuffer}"</strong> (Press Enter or Tab to insert top match):
              </span>
              <span>Esc to cancel</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {autocompleteItems.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => item.apply()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: i === 0 ? "1.5px solid #7c3aed" : "1px solid var(--ll-border)",
                    background:
                      i === 0 ? "rgba(139, 92, 246, 0.12)" : "var(--ll-surface-subtle)",
                    fontSize: 11.5,
                    fontWeight: 650,
                    color: "var(--ll-text-primary)",
                    cursor: "pointer",
                  }}
                >
                  {i === 0 && <CornerDownLeft size={11} color="#7c3aed" />}
                  <span style={{ fontFamily: "var(--ll-font-mono)", color: "#6d28d9" }}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--ll-text-muted)", fontWeight: 400 }}>
                    {item.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bidirectional Raw Expression / Paste Bar */}
        {showRawCode && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "var(--ll-surface-subtle)",
              border: "1px solid var(--ll-border)",
              borderRadius: 6,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ll-text-secondary)", whiteSpace: "nowrap" }}>
              {tr("AST კოდი:", "Formula Code:")}
            </span>
            <input
              type="text"
              value={rawCodeInput}
              placeholder="e.g. integral(0, mist_lead, (flow / 60) * nozzles * exp(-0.05 * t))"
              onChange={(e) => {
                const val = e.target.value;
                setRawCodeInput(val);
                const parsed = parseExpressionToMathRow(val);
                if (parsed.items.length > 0 || !val.trim()) {
                  setRootRow(parsed);
                  setCursor({ rowId: parsed.id, offset: parsed.items.length });
                }
              }}
              style={{
                flex: 1,
                fontSize: 12,
                fontFamily: "var(--ll-font-mono)",
                color: "#6d28d9",
                fontWeight: 600,
                background: "var(--ll-surface)",
                border: "1px solid var(--ll-border)",
                borderRadius: 4,
                padding: "4px 8px",
                outline: "none",
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                navigator.clipboard.writeText(serializedFormula);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              style={{ padding: "3px 6px", fontSize: 11 }}
              title="Copy expression"
            >
              {copied ? <Check size={13} color="#059669" /> : <Copy size={13} />}
            </button>
          </div>
        )}
      </div>

      {/* 3. Live Validation & Nominal Computation Status Bar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          background: evaluationResult.valid
            ? "rgba(16, 185, 129, 0.05)"
            : evaluationResult.empty || evaluationResult.emptySlots > 0
            ? "rgba(139, 92, 246, 0.05)"
            : "rgba(239, 68, 68, 0.05)",
          border: evaluationResult.valid
            ? "1px solid rgba(16, 185, 129, 0.28)"
            : evaluationResult.empty || evaluationResult.emptySlots > 0
            ? "1px solid rgba(139, 92, 246, 0.28)"
            : "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: "var(--ll-radius-md)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {evaluationResult.valid ? (
              <>
                <CheckCircle2 size={16} color="#059669" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>
                  {tr(
                    "ფორმულა ვალიდურია · უსაფრთხო AST კომპილატორი",
                    "Formula Valid · Safe AST & Gauss-Legendre Quadrature Ready",
                  )}
                </span>
              </>
            ) : evaluationResult.empty ? (
              <span style={{ fontSize: 12, color: "var(--ll-text-muted)" }}>
                {tr(
                  "ააგეთ ფორმულა ზედა სიმბოლოებით ან კლავიატურით",
                  "Build your formula using the Symbolab keypad above or keyboard",
                )}
              </span>
            ) : (
              <>
                <AlertTriangle
                  size={16}
                  color={evaluationResult.emptySlots > 0 ? "#7c3aed" : "#dc2626"}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 650,
                    color: evaluationResult.emptySlots > 0 ? "#6d28d9" : "#dc2626",
                  }}
                >
                  {evaluationResult.error}
                </span>
              </>
            )}
          </div>

          {evaluationResult.valid && evaluationResult.sampleValue !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11.5, color: "var(--ll-text-secondary)" }}>
                {tr("ნომინალური მნიშვნელობა:", "Nominal Output:")}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 750,
                  fontFamily: "var(--ll-font-mono)",
                  color: "#059669",
                  background: "rgba(16, 185, 129, 0.12)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                }}
              >
                {Number(evaluationResult.sampleValue).toPrecision(5).replace(/\.?0+$/, "")}{" "}
                {unit}
              </span>
            </div>
          )}
        </div>

        {/* Interactive What-If Sandbox + Mini 1D Response Curve */}
        {(showSandbox || (evaluationResult.valid && evaluationResult.dependencies.length > 0)) &&
          evaluationResult.dependencies.length > 0 && (
            <div
              style={{
                marginTop: 4,
                paddingTop: 8,
                borderTop: "1px solid var(--ll-border)",
                display: "grid",
                gridTemplateColumns: responseCurveData ? "1fr 180px" : "1fr",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ll-text-secondary)" }}>
                    {tr(
                      "პარამეტრების სიმულაცია (გადაადგილეთ სლაიდერი შესამოწმებლად):",
                      "Input Dependencies & Live What-If Sliders:",
                    )}
                  </span>
                  {Object.keys(sandboxValues).length > 0 && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setSandboxValues({})}
                      style={{ fontSize: 10.5, padding: "1px 6px" }}
                    >
                      <RotateCcw size={10} />
                      <span>{tr("საწყისზე დაბრუნება", "Reset Nominal")}</span>
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {evaluationResult.dependencies.map((depKey) => {
                    const paramObj = availableParams.find((p) => p.key === depKey);
                    const s = (paramObj?.spec || {}) as Record<string, unknown>;
                    const min = Number(s.min ?? 0);
                    const max = Number(s.max ?? 100);
                    const curVal = sandboxValues[depKey] ?? nominalValues[depKey] ?? 1;
                    return (
                      <div
                        key={depKey}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "110px 1fr 80px",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 11,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--ll-font-mono)",
                            fontWeight: 650,
                            color: "#059669",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {depKey}
                        </span>
                        {paramObj && paramObj.kind !== "categorical" && max > min ? (
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={(max - min) / 100}
                            value={curVal}
                            onChange={(e) =>
                              setSandboxValues((prev) => ({
                                ...prev,
                                [depKey]: parseFloat(e.target.value),
                              }))
                            }
                            style={{ accentColor: "#7c3aed", height: 4, cursor: "pointer" }}
                          />
                        ) : (
                          <span style={{ color: "var(--ll-text-muted)", fontSize: 10.5 }}>
                            fixed / external
                          </span>
                        )}
                        <span
                          style={{
                            fontFamily: "var(--ll-font-mono)",
                            textAlign: "right",
                            color: "var(--ll-text-primary)",
                            fontWeight: 600,
                          }}
                        >
                          {Number(curVal).toFixed(2)} {paramObj?.unit || ""}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {Object.keys(sandboxValues).length > 0 &&
                  evaluationResult.sandboxEvaluated !== null &&
                  evaluationResult.sandboxEvaluated !== undefined && (
                    <div style={{ fontSize: 11.5, color: "#6d28d9", fontWeight: 700, marginTop: 2 }}>
                      {tr("სიმულირებული შედეგი:", "What-If Output:")}{" "}
                      <span style={{ fontFamily: "var(--ll-font-mono)" }}>
                        {Number(evaluationResult.sandboxEvaluated).toPrecision(5)}{" "}
                        {unit}
                      </span>
                    </div>
                  )}
              </div>

              {/* Mini SVG Response Curve */}
              {responseCurveData && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "var(--ll-surface)",
                    border: "1px solid var(--ll-border)",
                    borderRadius: 6,
                    padding: "6px 8px",
                  }}
                >
                  <span style={{ fontSize: 9.5, color: "var(--ll-text-muted)", marginBottom: 2 }}>
                    {currentParamKey || "f"} vs. {responseCurveData.param.key}
                  </span>
                  {(() => {
                    const pts = responseCurveData.points;
                    const xs = pts.map((p) => p.x);
                    const ys = pts.map((p) => p.y);
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    const spanX = Math.max(1e-9, maxX - minX);
                    const spanY = Math.max(1e-9, maxY - minY);
                    const w = 156;
                    const h = 48;
                    const dPath = pts
                      .map((p, i) => {
                        const px = 4 + ((p.x - minX) / spanX) * (w - 8);
                        const py = h - 4 - ((p.y - minY) / spanY) * (h - 8);
                        return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
                      })
                      .join(" ");
                    return (
                      <svg width={w} height={h} style={{ overflow: "visible" }}>
                        <path
                          d={dPath}
                          fill="none"
                          stroke="#7c3aed"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
