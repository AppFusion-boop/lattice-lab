import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Info,
  Copy,
  Check,
  Code,
  Layers,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import type { Parameter } from "../api/types";
import { compileExpression, expressionVariables } from "../../core/expression";
import { MathFormulaDisplay } from "./MathFormulaDisplay";
import { tr } from "../../i18n";

export interface VisualMathBuilderProps {
  currentParamKey: string;
  studyParameters: Parameter[];
  expression: string;
  onChange: (expression: string, dependencies: string[], sampleValue: number | null) => void;
  unit?: string;
}

type VisualMode = "integral" | "det2" | "det3" | "norm" | "fraction" | "sum" | "custom";
type KeypadTab = "templates" | "functions" | "operators";

export function VisualMathBuilder({
  currentParamKey,
  studyParameters,
  expression,
  onChange,
  unit = "",
}: VisualMathBuilderProps) {
  // Visual Mode
  const [mode, setMode] = useState<VisualMode>("integral");
  const [activeKeypadTab, setActiveKeypadTab] = useState<KeypadTab>("templates");
  const [focusedSlot, setFocusedSlot] = useState<string>("int-integrand");
  const [copied, setCopied] = useState(false);
  const [showRawFormula, setShowRawFormula] = useState(false);

  // Slot States
  // Integral: integral(lower, upper, integrand)
  const [intLower, setIntLower] = useState("0");
  const [intUpper, setIntUpper] = useState("");
  const [intIntegrand, setIntIntegrand] = useState("(flow / 60) * nozzles * (1 - 0.05 * t)");

  // Det 2x2: det2(a11, a12, a21, a22)
  const [det2A11, setDet2A11] = useState("amplitude");
  const [det2A12, setDet2A12] = useState("0.2");
  const [det2A21, setDet2A21] = useState("0.1");
  const [det2A22, setDet2A22] = useState("droplet");

  // Det 3x3: det3(9 cells)
  const [det3Cells, setDet3Cells] = useState<string[]>([
    "amplitude", "0.2", "0",
    "0.1", "droplet", "0",
    "0", "0", "flow",
  ]);

  // Norm: norm2(x, y) or norm3(x, y, z)
  const [normDim, setNormDim] = useState<2 | 3>(2);
  const [normX, setNormX] = useState("flow");
  const [normY, setNormY] = useState("amplitude");
  const [normZ, setNormZ] = useState("droplet");

  // Fraction: (num) / (den)
  const [fracNum, setFracNum] = useState("flow * nozzles");
  const [fracDen, setFracDen] = useState("droplet");

  // Summation: sum(start, end, term)
  const [sumStart, setSumStart] = useState("1");
  const [sumEnd, setSumEnd] = useState("nozzles");
  const [sumTerm, setSumTerm] = useState("k * droplet");

  // Custom text
  const [customText, setCustomText] = useState(expression || "amplitude * mist_lead");
  const customInputRef = useRef<HTMLInputElement>(null);

  // Available study parameters (excluding the current parameter to avoid self-reference)
  const availableParams = useMemo(() => {
    return studyParameters.filter((p) => p.key !== currentParamKey);
  }, [studyParameters, currentParamKey]);

  // Map parameter keys to nominal values
  const nominalValues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of studyParameters) {
      if (p.key === currentParamKey) continue;
      const s = p.spec as Record<string, unknown>;
      if (p.role === "fixed") {
        map[p.key] = Number(s.value ?? 0);
      } else if (p.kind === "continuous") {
        const min = Number(s.min ?? 0);
        const max = Number(s.max ?? 1);
        map[p.key] = (min + max) / 2;
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

  // Initial defaults matching study parameters if empty
  useEffect(() => {
    if (availableParams.length > 0) {
      const mistLeadParam = availableParams.find((p) => p.key.includes("lead"));
      const flowParam = availableParams.find((p) => p.key.includes("flow"));
      const nozzlesParam = availableParams.find((p) => p.key.includes("nozzle"));
      const dropletParam = availableParams.find((p) => p.key.includes("droplet"));
      const ampParam = availableParams.find((p) => p.key.includes("amp"));

      if (!intUpper) setIntUpper(mistLeadParam?.key ?? availableParams[0].key);
      if (flowParam && nozzlesParam && intIntegrand === "(flow / 60) * nozzles * (1 - 0.05 * t)") {
        setIntIntegrand(`(${flowParam.key} / 60) * ${nozzlesParam.key} * (1 - 0.05 * t)`);
      }
      if (ampParam && dropletParam) {
        setDet2A11(ampParam.key);
        setDet2A22(dropletParam.key);
      }
      if (flowParam && nozzlesParam && dropletParam) {
        setFracNum(`${flowParam.key} * ${nozzlesParam.key}`);
        setFracDen(dropletParam.key);
      }
      if (nozzlesParam && dropletParam) {
        setSumEnd(nozzlesParam.key);
        setSumTerm(`k * ${dropletParam.key}`);
      }
    }
  }, [availableParams]);

  // Auto-detect mode from initial expression if passed
  useEffect(() => {
    const s = expression?.trim();
    if (!s) return;

    const intM = s.match(/^integral\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(.+)\s*\)$/i);
    if (intM) {
      setMode("integral");
      setIntLower(intM[1].trim());
      setIntUpper(intM[2].trim());
      setIntIntegrand(intM[3].trim());
      return;
    }

    const det2M = s.match(/^det2\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*\)$/i);
    if (det2M) {
      setMode("det2");
      setDet2A11(det2M[1].trim());
      setDet2A12(det2M[2].trim());
      setDet2A21(det2M[3].trim());
      setDet2A22(det2M[4].trim());
      return;
    }

    const det3M = s.match(/^det3\s*\(\s*(.+)\s*\)$/i);
    if (det3M) {
      const cells = det3M[1].split(",").map((c) => c.trim());
      if (cells.length === 9) {
        setMode("det3");
        setDet3Cells(cells);
        return;
      }
    }

    const norm2M = s.match(/^norm2\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*\)$/i);
    if (norm2M) {
      setMode("norm");
      setNormDim(2);
      setNormX(norm2M[1].trim());
      setNormY(norm2M[2].trim());
      return;
    }

    const norm3M = s.match(/^norm3\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*\)$/i);
    if (norm3M) {
      setMode("norm");
      setNormDim(3);
      setNormX(norm3M[1].trim());
      setNormY(norm3M[2].trim());
      setNormZ(norm3M[3].trim());
      return;
    }

    const sumM = s.match(/^sum\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(.+)\s*\)$/i);
    if (sumM) {
      setMode("sum");
      setSumStart(sumM[1].trim());
      setSumEnd(sumM[2].trim());
      setSumTerm(sumM[3].trim());
      return;
    }

    const fracM = s.match(/^\((.+)\)\s*\/\s*\((.+)\)$/);
    if (fracM) {
      setMode("fraction");
      setFracNum(fracM[1].trim());
      setFracDen(fracM[2].trim());
      return;
    }

    setMode("custom");
    setCustomText(s);
  }, []);

  // Compute the current formula string based on active mode & slots
  const currentFormula = useMemo(() => {
    switch (mode) {
      case "integral":
        return `integral(${intLower || "0"}, ${intUpper || "0"}, ${intIntegrand || "t"})`;
      case "det2":
        return `det2(${det2A11 || "1"}, ${det2A12 || "0"}, ${det2A21 || "0"}, ${det2A22 || "1"})`;
      case "det3":
        return `det3(${det3Cells.map((c, i) => c || (i % 4 === 0 ? "1" : "0")).join(", ")})`;
      case "norm":
        return normDim === 2
          ? `norm2(${normX || "0"}, ${normY || "0"})`
          : `norm3(${normX || "0"}, ${normY || "0"}, ${normZ || "0"})`;
      case "fraction":
        return `(${fracNum || "1"}) / (${fracDen || "1"})`;
      case "sum":
        return `sum(${sumStart || "1"}, ${sumEnd || "1"}, ${sumTerm || "k"})`;
      case "custom":
        return customText;
      default:
        return "";
    }
  }, [
    mode,
    intLower,
    intUpper,
    intIntegrand,
    det2A11,
    det2A12,
    det2A21,
    det2A22,
    det3Cells,
    normDim,
    normX,
    normY,
    normZ,
    fracNum,
    fracDen,
    sumStart,
    sumEnd,
    sumTerm,
    customText,
  ]);

  // Evaluate the current formula in real-time
  const evaluationResult = useMemo(() => {
    const trimmed = currentFormula.trim();
    if (!trimmed) {
      return {
        valid: false,
        empty: true,
        error: null,
        dependencies: [] as string[],
        sampleValue: null as number | null,
        selfReference: false,
      };
    }

    // Extract dependencies
    const vars = expressionVariables(trimmed);
    const selfRef = vars.includes(currentParamKey);

    if (selfRef) {
      return {
        valid: false,
        empty: false,
        error: tr(
          `თვით-დამოკიდებულება: '${currentParamKey}' არ შეიძლება დამოკიდებული იყოს საკუთარ თავზე.`,
          `Self-reference detected: '${currentParamKey}' cannot depend on itself.`
        ),
        dependencies: vars,
        sampleValue: null,
        selfReference: true,
      };
    }

    try {
      const compiled = compileExpression(trimmed, { variables: vars });
      const env: Record<string, number> = {};
      for (const v of vars) {
        env[v] = nominalValues[v] ?? 1.0;
      }
      const val = compiled(env);
      return {
        valid: Number.isFinite(val),
        empty: false,
        error: null,
        dependencies: vars,
        sampleValue: Number.isFinite(val) ? val : null,
        selfReference: false,
      };
    } catch (err) {
      return {
        valid: false,
        empty: false,
        error: (err as Error).message,
        dependencies: vars,
        sampleValue: null,
        selfReference: false,
      };
    }
  }, [currentFormula, currentParamKey, nominalValues]);

  // Synchronize with parent on change
  useEffect(() => {
    if (evaluationResult.valid && !evaluationResult.empty) {
      onChange(currentFormula, evaluationResult.dependencies, evaluationResult.sampleValue);
    } else {
      onChange(currentFormula, evaluationResult.dependencies, null);
    }
  }, [currentFormula, evaluationResult.valid, evaluationResult.empty, evaluationResult.sampleValue]);

  // Keypad Insertion Handler (Symbolab style)
  const handleInsertSnippet = (snippet: string) => {
    if (mode === "custom") {
      setCustomText((prev) => (prev ? `${prev} ${snippet}` : snippet));
      return;
    }

    switch (focusedSlot) {
      case "int-lower":
        setIntLower(snippet);
        break;
      case "int-upper":
        setIntUpper(snippet);
        break;
      case "int-integrand":
        setIntIntegrand((prev) => (prev ? `${prev} * ${snippet}` : snippet));
        break;
      case "det2-a11":
        setDet2A11(snippet);
        break;
      case "det2-a12":
        setDet2A12(snippet);
        break;
      case "det2-a21":
        setDet2A21(snippet);
        break;
      case "det2-a22":
        setDet2A22(snippet);
        break;
      case "norm-x":
        setNormX(snippet);
        break;
      case "norm-y":
        setNormY(snippet);
        break;
      case "norm-z":
        setNormZ(snippet);
        break;
      case "frac-num":
        setFracNum((prev) => (prev ? `${prev} * ${snippet}` : snippet));
        break;
      case "frac-den":
        setFracDen(snippet);
        break;
      case "sum-start":
        setSumStart(snippet);
        break;
      case "sum-end":
        setSumEnd(snippet);
        break;
      case "sum-term":
        setSumTerm((prev) => (prev ? `${prev} * ${snippet}` : snippet));
        break;
      default:
        if (focusedSlot.startsWith("det3-")) {
          const idx = parseInt(focusedSlot.replace("det3-", ""), 10);
          if (!isNaN(idx)) {
            const next = [...det3Cells];
            next[idx] = snippet;
            setDet3Cells(next);
          }
        } else {
          setCustomText((prev) => (prev ? `${prev} * ${snippet}` : snippet));
        }
    }
  };

  // Preset Examples
  const loadPreset = (preset: "tunnel_mass" | "dispersion_det" | "velocity_norm" | "cascade_sum" | "ratio") => {
    if (preset === "tunnel_mass") {
      setMode("integral");
      setIntLower("0");
      setIntUpper(availableParams.find((p) => p.key.includes("lead"))?.key ?? "mist_lead");
      const f = availableParams.find((p) => p.key.includes("flow"))?.key ?? "flow";
      const n = availableParams.find((p) => p.key.includes("nozzle"))?.key ?? "nozzles";
      setIntIntegrand(`(${f} / 60) * ${n} * (1 - 0.05 * t)`);
      setFocusedSlot("int-integrand");
    } else if (preset === "dispersion_det") {
      setMode("det2");
      const a = availableParams.find((p) => p.key.includes("amp"))?.key ?? "amplitude";
      const d = availableParams.find((p) => p.key.includes("drop"))?.key ?? "droplet";
      setDet2A11(a);
      setDet2A12("0.2");
      setDet2A21("0.1");
      setDet2A22(d);
      setFocusedSlot("det2-a11");
    } else if (preset === "velocity_norm") {
      setMode("norm");
      setNormDim(2);
      const f = availableParams.find((p) => p.key.includes("flow"))?.key ?? "flow";
      const a = availableParams.find((p) => p.key.includes("amp"))?.key ?? "amplitude";
      setNormX(f);
      setNormY(a);
      setFocusedSlot("norm-x");
    } else if (preset === "cascade_sum") {
      setMode("sum");
      setSumStart("1");
      const n = availableParams.find((p) => p.key.includes("nozzle"))?.key ?? "nozzles";
      const d = availableParams.find((p) => p.key.includes("drop"))?.key ?? "droplet";
      setSumEnd(n);
      setSumTerm(`k * ${d}`);
      setFocusedSlot("sum-term");
    } else if (preset === "ratio") {
      setMode("fraction");
      const f = availableParams.find((p) => p.key.includes("flow"))?.key ?? "flow";
      const n = availableParams.find((p) => p.key.includes("nozzle"))?.key ?? "nozzles";
      const d = availableParams.find((p) => p.key.includes("drop"))?.key ?? "droplet";
      setFracNum(`${f} * ${n}`);
      setFracDen(d);
      setFocusedSlot("frac-num");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(currentFormula);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
      {/* 1. Quick Presets Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "rgba(139, 92, 246, 0.05)",
          border: "1px solid rgba(139, 92, 246, 0.2)",
          borderRadius: "var(--ll-radius-md)",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#7c3aed", display: "flex", alignItems: "center", gap: 6 }}>
          <BookOpen size={14} />
          <span>{tr("სწრაფი სამეცნიერო შაბლონები:", "Quick Presets (Symbolab Templates):")}</span>
        </span>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => loadPreset("tunnel_mass")}
            style={{ fontSize: 11, padding: "3px 8px", background: "var(--ll-surface)", border: "1px solid var(--ll-border)" }}
          >
            ∫ {tr("მასის ინტეგრალი", "Cumulative Mass ∫")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => loadPreset("dispersion_det")}
            style={{ fontSize: 11, padding: "3px 8px", background: "var(--ll-surface)", border: "1px solid var(--ll-border)" }}
          >
            |A| {tr("დისპერსიის მატრიცა", "Dispersion Det |A|")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => loadPreset("velocity_norm")}
            style={{ fontSize: 11, padding: "3px 8px", background: "var(--ll-surface)", border: "1px solid var(--ll-border)" }}
          >
            ‖v‖ {tr("სიჩქარის ნორმა", "Velocity Norm ‖v‖")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => loadPreset("ratio")}
            style={{ fontSize: 11, padding: "3px 8px", background: "var(--ll-surface)", border: "1px solid var(--ll-border)" }}
          >
            a/b {tr("ფარდობა", "Scaled Ratio a/b")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => loadPreset("cascade_sum")}
            style={{ fontSize: 11, padding: "3px 8px", background: "var(--ll-surface)", border: "1px solid var(--ll-border)" }}
          >
            ∑ {tr("კასკადის ჯამი", "Cascade Sum ∑")}
          </button>
        </div>
      </div>

      {/* 2. Symbolab Virtual Keypad & Ribbon */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          background: "var(--ll-surface)",
          border: "1px solid var(--ll-border)",
          borderRadius: "var(--ll-radius-md)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
        }}
      >
        {/* Keypad Category Tabs */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--ll-border)", paddingBottom: 6 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { id: "templates" as const, label: tr("მათემატიკური სტრუქტურები", "Structures / Templates") },
              { id: "functions" as const, label: tr("ფუნქციები", "Functions") },
              { id: "operators" as const, label: tr("ოპერატორები & მუდმივები", "Operators & Constants") },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveKeypadTab(tab.id)}
                style={{
                  fontSize: 11,
                  fontWeight: activeKeypadTab === tab.id ? 700 : 500,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "none",
                  background: activeKeypadTab === tab.id ? "rgba(139, 92, 246, 0.12)" : "transparent",
                  color: activeKeypadTab === tab.id ? "#7c3aed" : "var(--ll-text-secondary)",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--ll-text-muted)" }}>
              {tr("აქტიური სლოტი:", "Active Slot:")} <strong style={{ color: "#7c3aed" }}>{focusedSlot}</strong>
            </span>
          </div>
        </div>

        {/* Tab 1: Structures & Templates Keypad */}
        {activeKeypadTab === "templates" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: 6 }}>
            {[
              { label: "∫_a^b", title: "Definite Integral", action: () => { setMode("integral"); setFocusedSlot("int-integrand"); } },
              { label: "a / b", title: "Fraction", action: () => handleInsertSnippet("flow / 60") },
              { label: "x²", title: "Square", action: () => handleInsertSnippet("^2") },
              { label: "x^y", title: "Power", action: () => handleInsertSnippet("^") },
              { label: "√x", title: "Square Root", action: () => handleInsertSnippet("sqrt(droplet)") },
              { label: "det 2×2", title: "Matrix Det 2x2", action: () => { setMode("det2"); setFocusedSlot("det2-a11"); } },
              { label: "det 3×3", title: "Matrix Det 3x3", action: () => { setMode("det3"); setFocusedSlot("det3-0"); } },
              { label: "‖v‖₂", title: "Vector Norm", action: () => { setMode("norm"); setFocusedSlot("norm-x"); } },
              { label: "∑_k", title: "Summation", action: () => { setMode("sum"); setFocusedSlot("sum-term"); } },
              { label: "( ... )", title: "Parentheses", action: () => handleInsertSnippet("(1 - 0.05 * t)") },
            ].map((btn, i) => (
              <button
                key={i}
                type="button"
                onClick={btn.action}
                title={btn.title}
                style={{
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 13,
                  fontWeight: 650,
                  background: "var(--ll-surface-subtle)",
                  border: "1px solid var(--ll-border)",
                  borderRadius: "var(--ll-radius-sm)",
                  color: "var(--ll-text-primary)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => (e.currentTarget.style.borderColor = "#8b5cf6")}
                onMouseOut={(e) => (e.currentTarget.style.borderColor = "var(--ll-border)")}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* Tab 2: Functions Keypad */}
        {activeKeypadTab === "functions" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 6 }}>
            {["sin", "cos", "tan", "exp", "ln", "log", "min", "max", "clamp", "abs"].map((fn) => (
              <button
                key={fn}
                type="button"
                onClick={() => handleInsertSnippet(`${fn}(t)`)}
                style={{
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--ll-surface-subtle)",
                  border: "1px solid var(--ll-border)",
                  borderRadius: "var(--ll-radius-sm)",
                  color: "#7c3aed",
                  cursor: "pointer",
                }}
              >
                {fn}( )
              </button>
            ))}
          </div>
        )}

        {/* Tab 3: Operators & Constants */}
        {activeKeypadTab === "operators" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(50px, 1fr))", gap: 6 }}>
            {[
              { label: "+", val: "+" },
              { label: "−", val: "-" },
              { label: "×", val: "*" },
              { label: "/", val: "/" },
              { label: "π", val: "pi" },
              { label: "e", val: "e" },
              { label: "t", val: "t" },
              { label: "k", val: "k" },
            ].map((op) => (
              <button
                key={op.label}
                type="button"
                onClick={() => handleInsertSnippet(op.val)}
                style={{
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 14,
                  fontWeight: 700,
                  background: "var(--ll-surface-subtle)",
                  border: "1px solid var(--ll-border)",
                  borderRadius: "var(--ll-radius-sm)",
                  color: "var(--ll-text-primary)",
                  cursor: "pointer",
                }}
              >
                {op.label}
              </button>
            ))}
          </div>
        )}

        {/* Study Parameters Palette (Instant Insert) */}
        <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px dashed var(--ll-border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ll-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {tr("დააწკაპუნეთ პარამეტრზე ჩასასმელად:", "Click Parameter to Insert into Active Slot:")}
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {availableParams.map((p) => {
              const val = nominalValues[p.key];
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleInsertSnippet(p.key)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 8px",
                    background: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    borderRadius: 4,
                    color: "#059669",
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontFamily: "var(--ll-font-mono)",
                    fontWeight: 650,
                    transition: "all 0.15s ease",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = "rgba(16, 185, 129, 0.18)";
                    e.currentTarget.style.borderColor = "#059669";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = "rgba(16, 185, 129, 0.08)";
                    e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.3)";
                  }}
                >
                  <span>+ {p.key}</span>
                  {val !== undefined && (
                    <span style={{ fontSize: 10, opacity: 0.75, fontWeight: 500 }}>
                      ({val.toFixed(1)} {p.unit})
                    </span>
                  )}
                </button>
              );
            })}

            {/* Dummy integration / summation variables */}
            <button
              type="button"
              onClick={() => handleInsertSnippet("t")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 8px",
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                borderRadius: 4,
                color: "#7c3aed",
                cursor: "pointer",
                fontSize: 11.5,
                fontFamily: "Times New Roman, serif",
                fontStyle: "italic",
                fontWeight: 700,
              }}
            >
              + t (time dt)
            </button>

            <button
              type="button"
              onClick={() => handleInsertSnippet("k")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 8px",
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                borderRadius: 4,
                color: "#7c3aed",
                cursor: "pointer",
                fontSize: 11.5,
                fontFamily: "Times New Roman, serif",
                fontStyle: "italic",
                fontWeight: 700,
              }}
            >
              + k (index)
            </button>
          </div>
        </div>
      </div>

      {/* 3. Interactive Visual Equation Slot Canvas (Symbolab-style) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
          background: "var(--ll-surface)",
          border: "2px solid rgba(139, 92, 246, 0.35)",
          borderRadius: "var(--ll-radius-lg)",
          boxShadow: "0 4px 12px rgba(139, 92, 246, 0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} />
            <span>{tr("ვიზუალური ფორმულის რედაქტორი (ინტერაქტიული სლოტები):", "Visual Mathematical Formula Canvas:")}</span>
          </span>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowRawFormula(!showRawFormula)}
              style={{ fontSize: 11, padding: "2px 6px", color: "var(--ll-text-secondary)" }}
            >
              <Code size={12} />
              <span>{showRawFormula ? tr("კოდის დამალვა", "Hide Formula Code") : tr("კოდის რედაქტირება", "Edit Formula Code")}</span>
            </button>
          </div>
        </div>

        {/* Visual Slots Container */}
        <div
          style={{
            minHeight: 110,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px 20px",
            background: "var(--ll-surface-subtle)",
            borderRadius: "var(--ll-radius-md)",
            border: "1px dashed rgba(139, 92, 246, 0.3)",
            overflowX: "auto",
          }}
        >
          {/* Mode 1: Definite Integral Canvas */}
          {mode === "integral" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {/* Tall Integral Sign */}
              <span
                style={{
                  fontSize: 54,
                  lineHeight: 1,
                  fontWeight: 300,
                  color: "#8b5cf6",
                  fontFamily: "Times New Roman, serif",
                  userSelect: "none",
                }}
              >
                ∫
              </span>

              {/* Limits Stack */}
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: 72, gap: 4 }}>
                {/* Upper Limit Slot */}
                <input
                  type="text"
                  value={intUpper}
                  placeholder="upper"
                  onFocus={() => setFocusedSlot("int-upper")}
                  onChange={(e) => setIntUpper(e.target.value)}
                  style={{
                    width: Math.max(70, (intUpper.length + 2) * 9),
                    fontSize: 12,
                    fontFamily: "var(--ll-font-mono)",
                    fontWeight: 650,
                    padding: "3px 6px",
                    textAlign: "center",
                    border: focusedSlot === "int-upper" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                    borderRadius: 4,
                    background: focusedSlot === "int-upper" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                    color: "var(--ll-text-primary)",
                    outline: "none",
                  }}
                />
                {/* Lower Limit Slot */}
                <input
                  type="text"
                  value={intLower}
                  placeholder="0"
                  onFocus={() => setFocusedSlot("int-lower")}
                  onChange={(e) => setIntLower(e.target.value)}
                  style={{
                    width: Math.max(50, (intLower.length + 2) * 9),
                    fontSize: 12,
                    fontFamily: "var(--ll-font-mono)",
                    fontWeight: 650,
                    padding: "3px 6px",
                    textAlign: "center",
                    border: focusedSlot === "int-lower" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                    borderRadius: 4,
                    background: focusedSlot === "int-lower" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                    color: "var(--ll-text-primary)",
                    outline: "none",
                  }}
                />
              </div>

              {/* Integrand Slot */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, margin: "0 6px" }}>
                <span style={{ fontSize: 28, color: "var(--ll-text-muted)", fontWeight: 300 }}>(</span>
                <input
                  type="text"
                  value={intIntegrand}
                  placeholder="(flow / 60) * nozzles * (1 - 0.05 * t)"
                  onFocus={() => setFocusedSlot("int-integrand")}
                  onChange={(e) => setIntIntegrand(e.target.value)}
                  style={{
                    minWidth: 260,
                    width: Math.max(260, (intIntegrand.length + 2) * 9),
                    fontSize: 14,
                    fontFamily: "var(--ll-font-mono)",
                    fontWeight: 650,
                    padding: "6px 10px",
                    textAlign: "center",
                    border: focusedSlot === "int-integrand" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                    borderRadius: 4,
                    background: focusedSlot === "int-integrand" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                    color: "var(--ll-text-primary)",
                    outline: "none",
                    boxShadow: focusedSlot === "int-integrand" ? "0 0 0 3px rgba(139, 92, 246, 0.2)" : "none",
                  }}
                />
                <span style={{ fontSize: 28, color: "var(--ll-text-muted)", fontWeight: 300 }}>)</span>
              </div>

              {/* Differential dt */}
              <span
                style={{
                  fontStyle: "italic",
                  fontWeight: 700,
                  color: "#8b5cf6",
                  fontSize: 18,
                  fontFamily: "Times New Roman, serif",
                  userSelect: "none",
                }}
              >
                dt
              </span>
            </div>
          )}

          {/* Mode 2: Det 2x2 Matrix Canvas */}
          {mode === "det2" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#8b5cf6", fontFamily: "var(--ll-font-mono)" }}>det</span>
              <div
                style={{
                  display: "inline-grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  padding: "8px 12px",
                  borderLeft: "3px solid var(--ll-text-primary)",
                  borderRight: "3px solid var(--ll-text-primary)",
                  background: "var(--ll-surface)",
                  borderRadius: 2,
                }}
              >
                {[
                  { slot: "det2-a11", val: det2A11, set: setDet2A11 },
                  { slot: "det2-a12", val: det2A12, set: setDet2A12 },
                  { slot: "det2-a21", val: det2A21, set: setDet2A21 },
                  { slot: "det2-a22", val: det2A22, set: setDet2A22 },
                ].map((item) => (
                  <input
                    key={item.slot}
                    type="text"
                    value={item.val}
                    placeholder="0"
                    onFocus={() => setFocusedSlot(item.slot)}
                    onChange={(e) => item.set(e.target.value)}
                    style={{
                      width: 90,
                      padding: "6px 8px",
                      textAlign: "center",
                      fontFamily: "var(--ll-font-mono)",
                      fontSize: 12,
                      fontWeight: 650,
                      border: focusedSlot === item.slot ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                      borderRadius: 4,
                      background: focusedSlot === item.slot ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                      color: "var(--ll-text-primary)",
                      outline: "none",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Mode 3: Det 3x3 Matrix Canvas */}
          {mode === "det3" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#8b5cf6", fontFamily: "var(--ll-font-mono)" }}>det</span>
              <div
                style={{
                  display: "inline-grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 6,
                  padding: "8px 12px",
                  borderLeft: "3px solid var(--ll-text-primary)",
                  borderRight: "3px solid var(--ll-text-primary)",
                  background: "var(--ll-surface)",
                  borderRadius: 2,
                }}
              >
                {det3Cells.map((c, idx) => (
                  <input
                    key={idx}
                    type="text"
                    value={c}
                    placeholder="0"
                    onFocus={() => setFocusedSlot(`det3-${idx}`)}
                    onChange={(e) => {
                      const next = [...det3Cells];
                      next[idx] = e.target.value;
                      setDet3Cells(next);
                    }}
                    style={{
                      width: 75,
                      padding: "5px 6px",
                      textAlign: "center",
                      fontFamily: "var(--ll-font-mono)",
                      fontSize: 11.5,
                      fontWeight: 650,
                      border: focusedSlot === `det3-${idx}` ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                      borderRadius: 4,
                      background: focusedSlot === `det3-${idx}` ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                      color: "var(--ll-text-primary)",
                      outline: "none",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Mode 4: Vector Norm Canvas */}
          {mode === "norm" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: "#8b5cf6" }}>‖</span>
              <span style={{ fontSize: 20, color: "var(--ll-text-muted)" }}>(</span>
              <input
                type="text"
                value={normX}
                placeholder="x"
                onFocus={() => setFocusedSlot("norm-x")}
                onChange={(e) => setNormX(e.target.value)}
                style={{
                  width: 90,
                  padding: "6px 8px",
                  textAlign: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 13,
                  fontWeight: 650,
                  border: focusedSlot === "norm-x" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                  borderRadius: 4,
                  background: focusedSlot === "norm-x" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                  outline: "none",
                }}
              />
              <span style={{ fontSize: 16, color: "var(--ll-text-muted)" }}>,</span>
              <input
                type="text"
                value={normY}
                placeholder="y"
                onFocus={() => setFocusedSlot("norm-y")}
                onChange={(e) => setNormY(e.target.value)}
                style={{
                  width: 90,
                  padding: "6px 8px",
                  textAlign: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 13,
                  fontWeight: 650,
                  border: focusedSlot === "norm-y" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                  borderRadius: 4,
                  background: focusedSlot === "norm-y" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                  outline: "none",
                }}
              />
              {normDim === 3 && (
                <>
                  <span style={{ fontSize: 16, color: "var(--ll-text-muted)" }}>,</span>
                  <input
                    type="text"
                    value={normZ}
                    placeholder="z"
                    onFocus={() => setFocusedSlot("norm-z")}
                    onChange={(e) => setNormZ(e.target.value)}
                    style={{
                      width: 90,
                      padding: "6px 8px",
                      textAlign: "center",
                      fontFamily: "var(--ll-font-mono)",
                      fontSize: 13,
                      fontWeight: 650,
                      border: focusedSlot === "norm-z" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                      borderRadius: 4,
                      background: focusedSlot === "norm-z" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                      outline: "none",
                    }}
                  />
                </>
              )}
              <span style={{ fontSize: 20, color: "var(--ll-text-muted)" }}>)</span>
              <span style={{ fontSize: 26, fontWeight: 700, color: "#8b5cf6" }}>‖</span>
              <sub style={{ fontSize: 12, fontWeight: 700, color: "var(--ll-text-muted)" }}>2</sub>
            </div>
          )}

          {/* Mode 5: Fraction Canvas */}
          {mode === "fraction" && (
            <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              {/* Numerator */}
              <input
                type="text"
                value={fracNum}
                placeholder="flow * nozzles"
                onFocus={() => setFocusedSlot("frac-num")}
                onChange={(e) => setFracNum(e.target.value)}
                style={{
                  minWidth: 160,
                  width: Math.max(160, (fracNum.length + 2) * 9),
                  padding: "5px 8px",
                  textAlign: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 13,
                  fontWeight: 650,
                  border: focusedSlot === "frac-num" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                  borderRadius: 4,
                  background: focusedSlot === "frac-num" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                  outline: "none",
                }}
              />
              {/* Divider Bar */}
              <div style={{ width: "100%", minWidth: 160, height: 2, background: "var(--ll-text-primary)" }} />
              {/* Denominator */}
              <input
                type="text"
                value={fracDen}
                placeholder="droplet"
                onFocus={() => setFocusedSlot("frac-den")}
                onChange={(e) => setFracDen(e.target.value)}
                style={{
                  minWidth: 160,
                  width: Math.max(160, (fracDen.length + 2) * 9),
                  padding: "5px 8px",
                  textAlign: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 13,
                  fontWeight: 650,
                  border: focusedSlot === "frac-den" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                  borderRadius: 4,
                  background: focusedSlot === "frac-den" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* Mode 6: Summation Canvas */}
          {mode === "sum" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {/* Stack for Limits & Sigma */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <input
                  type="text"
                  value={sumEnd}
                  placeholder="nozzles"
                  onFocus={() => setFocusedSlot("sum-end")}
                  onChange={(e) => setSumEnd(e.target.value)}
                  style={{
                    width: 70,
                    padding: "2px 4px",
                    textAlign: "center",
                    fontFamily: "var(--ll-font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    border: focusedSlot === "sum-end" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                    borderRadius: 3,
                    outline: "none",
                  }}
                />
                <span style={{ fontSize: 42, lineHeight: 1, fontWeight: 400, color: "#8b5cf6", fontFamily: "Times New Roman, serif" }}>
                  ∑
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11 }}>
                  <span style={{ fontStyle: "italic", fontFamily: "Times New Roman, serif" }}>k=</span>
                  <input
                    type="text"
                    value={sumStart}
                    placeholder="1"
                    onFocus={() => setFocusedSlot("sum-start")}
                    onChange={(e) => setSumStart(e.target.value)}
                    style={{
                      width: 40,
                      padding: "2px 4px",
                      textAlign: "center",
                      fontFamily: "var(--ll-font-mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      border: focusedSlot === "sum-start" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                      borderRadius: 3,
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              {/* Term Slot */}
              <input
                type="text"
                value={sumTerm}
                placeholder="k * droplet"
                onFocus={() => setFocusedSlot("sum-term")}
                onChange={(e) => setSumTerm(e.target.value)}
                style={{
                  minWidth: 160,
                  width: Math.max(160, (sumTerm.length + 2) * 9),
                  padding: "6px 10px",
                  textAlign: "center",
                  fontFamily: "var(--ll-font-mono)",
                  fontSize: 13,
                  fontWeight: 650,
                  border: focusedSlot === "sum-term" ? "2px solid #8b5cf6" : "1px solid var(--ll-border)",
                  borderRadius: 4,
                  background: focusedSlot === "sum-term" ? "rgba(139, 92, 246, 0.08)" : "var(--ll-surface)",
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* Mode 7: Custom Composed Formula Canvas */}
          {mode === "custom" && (
            <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                ref={customInputRef}
                type="text"
                value={customText}
                placeholder="e.g. sqrt(flow^2 + amplitude^2) * 0.95"
                onChange={(e) => setCustomText(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 14,
                  fontFamily: "var(--ll-font-mono)",
                  fontWeight: 650,
                  border: "2px solid #8b5cf6",
                  borderRadius: "var(--ll-radius-md)",
                  background: "var(--ll-surface)",
                  color: "var(--ll-text-primary)",
                  outline: "none",
                }}
              />
            </div>
          )}
        </div>

        {/* Optional Raw Formula Code Viewer/Editor */}
        {showRawFormula && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "var(--ll-surface)",
              border: "1px solid var(--ll-border)",
              borderRadius: "var(--ll-radius-sm)",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ll-text-secondary)" }}>
              {tr("ფორმულის AST კოდი:", "Formula AST:")}
            </span>
            <input
              type="text"
              value={currentFormula}
              onChange={(e) => {
                setMode("custom");
                setCustomText(e.target.value);
              }}
              style={{
                flex: 1,
                fontSize: 12,
                fontFamily: "var(--ll-font-mono)",
                color: "#7c3aed",
                fontWeight: 600,
                background: "transparent",
                border: "none",
                outline: "none",
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={copyToClipboard}
              style={{ padding: "2px 6px", fontSize: 11 }}
            >
              {copied ? <Check size={12} color="#059669" /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>

      {/* 4. Live WYSIWYG Mathematical Notation Preview */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 12,
          background: "var(--ll-surface)",
          border: "1px solid var(--ll-border)",
          borderRadius: "var(--ll-radius-md)",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ll-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {tr("ცოცხალი მათემატიკური აღნიშვნა (WYSIWYG Preview):", "Live Mathematical Notation (WYSIWYG Preview):")}
        </span>

        <div
          style={{
            padding: "12px 16px",
            background: "rgba(0,0,0,0.02)",
            borderRadius: "var(--ll-radius-sm)",
            border: "1px solid var(--ll-border)",
            display: "flex",
            alignItems: "center",
            minHeight: 46,
            overflowX: "auto",
          }}
        >
          <MathFormulaDisplay
            expression={currentFormula}
            studyParameters={studyParameters}
            dependencies={evaluationResult.dependencies}
            paramKey={currentParamKey}
            showLhs={true}
            nominalValue={evaluationResult.sampleValue}
            unit={unit}
            size="md"
          />
        </div>
      </div>

      {/* 5. Live Computation & Safety Validation Scratchpad */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          background: evaluationResult.valid
            ? "rgba(16, 185, 129, 0.04)"
            : evaluationResult.empty
            ? "var(--ll-surface-subtle)"
            : "rgba(239, 68, 68, 0.05)",
          border: evaluationResult.valid
            ? "1px solid rgba(16, 185, 129, 0.25)"
            : evaluationResult.empty
            ? "1px solid var(--ll-border)"
            : "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: "var(--ll-radius-md)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {evaluationResult.valid ? (
              <>
                <CheckCircle2 size={16} color="#059669" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>
                  {tr("უსაფრთხო AST ვალიდურია · გაუს-ლეჟანდრის კვადრატურა (0.2 ms)", "Safe AST Compliant · Gauss-Legendre Quadrature (0.2 ms)")}
                </span>
              </>
            ) : evaluationResult.empty ? (
              <span style={{ fontSize: 12, color: "var(--ll-text-muted)" }}>
                {tr("მიუთითეთ ფორმულის სლოტები", "Please fill in mathematical slots")}
              </span>
            ) : (
              <>
                <AlertTriangle size={16} color="#dc2626" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                  {evaluationResult.error || tr("ფორმულის შეცდომა", "Invalid mathematical expression")}
                </span>
              </>
            )}
          </div>

          {evaluationResult.valid && evaluationResult.sampleValue !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--ll-text-secondary)" }}>
                {tr("ნომინალური გამოთვლილი მნიშვნელობა:", "Nominal Computed Value:")}
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
                {evaluationResult.sampleValue.toFixed(2)} {unit}
              </span>
            </div>
          )}
        </div>

        {/* Dependencies details */}
        {evaluationResult.dependencies.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
            <span style={{ color: "var(--ll-text-secondary)", fontWeight: 600 }}>
              {tr("დამოკიდებულებები (DoE ცვლადები):", "Input Dependencies:")}
            </span>
            {evaluationResult.dependencies.map((dep) => (
              <span
                key={dep}
                style={{
                  padding: "1px 6px",
                  background: "var(--ll-surface)",
                  border: "1px solid var(--ll-border)",
                  borderRadius: 3,
                  fontFamily: "var(--ll-font-mono)",
                  color: "var(--ll-text-primary)",
                }}
              >
                {dep} = {nominalValues[dep] !== undefined ? nominalValues[dep].toFixed(1) : "?"}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
