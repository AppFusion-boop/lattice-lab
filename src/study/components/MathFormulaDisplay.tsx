import React from "react";
import type { Parameter } from "../api/types";

export interface MathFormulaDisplayProps {
  expression: string;
  studyParameters?: Parameter[];
  dependencies?: string[];
  paramKey?: string;
  showLhs?: boolean;
  nominalValue?: number | null;
  unit?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Pure CSS/SVG/HTML high-fidelity mathematical typography renderer.
 * Renders formulas in authentic scientific notation (Symbolab / WolframAlpha style):
 * - Tall integral symbols ∫ with stacked limits and dt
 * - Determinants |A| with clean vertical matrix bars
 * - Vertical stacked fractions with horizontal division bars
 * - Square roots with vinculum overline
 * - Summations ∑ with stacked limits and index variable
 * - Study parameter chips and evaluated nominal values
 */
export function MathFormulaDisplay({
  expression,
  studyParameters = [],
  dependencies = [],
  paramKey,
  showLhs = false,
  nominalValue,
  unit = "",
  size = "md",
}: MathFormulaDisplayProps) {
  const trimmed = expression?.trim() || "";

  if (!trimmed) {
    return <span style={{ color: "var(--ll-text-muted)", fontStyle: "italic", fontSize: 12 }}>—</span>;
  }

  // Base font size scaling
  const scale = size === "sm" ? 0.85 : size === "lg" ? 1.2 : 1.0;
  const fontSize = 13 * scale;

  // Helper to render a token (variable, number, power, function, or sub-expression)
  const renderToken = (tok: string, key?: React.Key): React.ReactNode => {
    const t = tok.trim();
    if (!t) return null;

    // Is it a study parameter?
    const isParam = studyParameters.some((p) => p.key === t);
    if (isParam) {
      return (
        <span
          key={key}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 5px",
            background: "rgba(16, 185, 129, 0.12)",
            color: "#059669",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: 3,
            fontWeight: 650,
            fontSize: `${11 * scale}px`,
            fontFamily: "var(--ll-font-mono)",
            margin: "0 1px",
          }}
        >
          {t}
        </span>
      );
    }

    // Dummy integration / index variables
    if (t === "t" || t === "k" || t === "i") {
      return (
        <span
          key={key}
          style={{
            fontStyle: "italic",
            fontFamily: "Times New Roman, serif",
            fontWeight: 600,
            color: "#7c3aed",
            padding: "0 1px",
          }}
        >
          {t}
        </span>
      );
    }

    // Constants
    if (t === "pi") {
      return <span key={key} style={{ color: "#7c3aed", fontWeight: 700, fontStyle: "italic", fontFamily: "Times New Roman, serif" }}>π</span>;
    }
    if (t === "e") {
      return <span key={key} style={{ color: "#7c3aed", fontWeight: 700, fontStyle: "italic", fontFamily: "Times New Roman, serif" }}>e</span>;
    }

    // Power / Exponent: base^exp
    const powMatch = t.match(/^([a-zA-Z0-9_]+)\^([a-zA-Z0-9_.]+)$/);
    if (powMatch) {
      return (
        <span key={key} style={{ display: "inline-flex", alignItems: "baseline", margin: "0 1px" }}>
          <span>{renderToken(powMatch[1])}</span>
          <sup style={{ fontSize: `${9.5 * scale}px`, fontWeight: 600, color: "var(--ll-text-secondary)" }}>
            {powMatch[2]}
          </sup>
        </span>
      );
    }

    // Square root: sqrt(...)
    const sqrtMatch = t.match(/^sqrt\((.+)\)$/);
    if (sqrtMatch) {
      return (
        <span key={key} style={{ display: "inline-flex", alignItems: "center", margin: "0 2px" }}>
          <span style={{ fontSize: `${15 * scale}px`, fontWeight: 300, fontFamily: "Times New Roman, serif", marginRight: 1 }}>√</span>
          <span style={{ borderTop: "1.2px solid currentColor", padding: "1px 2px 0 2px", fontSize: `${11.5 * scale}px` }}>
            {renderIntegrand(sqrtMatch[1])}
          </span>
        </span>
      );
    }

    // Sub-fraction inside token: e.g. (flow / 60)
    const fracMatch = t.match(/^\(?\s*([a-zA-Z0-9_]+)\s*\/\s*([a-zA-Z0-9_.]+)\s*\)?$/);
    if (fracMatch) {
      return (
        <span
          key={key}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            verticalAlign: "middle",
            padding: "0 3px",
            margin: "0 2px",
            lineHeight: 1.1,
          }}
        >
          <span style={{ borderBottom: "1.2px solid currentColor", paddingBottom: 1, fontSize: `${11 * scale}px`, fontWeight: 600 }}>
            {renderToken(fracMatch[1])}
          </span>
          <span style={{ paddingTop: 1, fontSize: `${11 * scale}px`, opacity: 0.85, fontWeight: 500 }}>
            {fracMatch[2]}
          </span>
        </span>
      );
    }

    // Multiplication dot
    if (t === "*") {
      return <span key={key} style={{ color: "var(--ll-text-secondary)", margin: "0 3px", fontSize: `${12 * scale}px` }}>·</span>;
    }

    // Standard number or operator
    return (
      <span key={key} style={{ fontFamily: "var(--ll-font-mono)", color: "var(--ll-text-primary)" }}>
        {t}
      </span>
    );
  };

  // Helper to render complex integrand / sub-expression
  const renderIntegrand = (expr: string) => {
    // Split on parentheses, operators, spaces
    const parts = expr.split(/(\([^)]+\)|\b[a-zA-Z_][a-zA-Z0-9_]*\b|[+\-*/^]|\s+)/g).filter(Boolean);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
        {parts.map((p, idx) => {
          const trimmedP = p.trim();
          if (!trimmedP) return null;

          // Check if parenthesized sub-expression
          if (trimmedP.startsWith("(") && trimmedP.endsWith(")")) {
            const inner = trimmedP.slice(1, -1).trim();
            // Check for fraction inside parenthesized: e.g. (flow / 60)
            const fracMatch = inner.match(/^([a-zA-Z0-9_]+)\s*\/\s*([a-zA-Z0-9_.]+)$/);
            if (fracMatch) {
              return (
                <span key={idx} style={{ display: "inline-flex", alignItems: "center" }}>
                  <span style={{ fontSize: `${14 * scale}px`, color: "var(--ll-text-muted)" }}>(</span>
                  {renderToken(inner)}
                  <span style={{ fontSize: `${14 * scale}px`, color: "var(--ll-text-muted)" }}>)</span>
                </span>
              );
            }
            return (
              <span key={idx} style={{ display: "inline-flex", alignItems: "center" }}>
                <span style={{ fontSize: `${13 * scale}px`, color: "var(--ll-text-muted)" }}>(</span>
                {renderIntegrand(inner)}
                <span style={{ fontSize: `${13 * scale}px`, color: "var(--ll-text-muted)" }}>)</span>
              </span>
            );
          }

          if (trimmedP === "*") {
            return <span key={idx} style={{ color: "var(--ll-text-secondary)", margin: "0 2px" }}>·</span>;
          }

          return renderToken(trimmedP, idx);
        })}
      </span>
    );
  };

  // Optional LHS renderer: f(dep1, dep2, ...) =
  const renderLhs = () => {
    if (!showLhs) return null;
    const depsToUse = dependencies.length > 0 ? dependencies : studyParameters.filter(p => expression.includes(p.key)).map(p => p.key);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", marginRight: 6, userSelect: "none" }}>
        <span style={{ fontStyle: "italic", fontFamily: "Times New Roman, serif", fontWeight: 600, color: "var(--ll-text-primary)", fontSize: `${13 * scale}px` }}>
          {paramKey ? paramKey : "f"}
        </span>
        <span style={{ color: "var(--ll-text-muted)", fontSize: `${12 * scale}px` }}>(</span>
        {depsToUse.map((d, i) => (
          <React.Fragment key={d}>
            {i > 0 && <span style={{ color: "var(--ll-text-muted)", marginRight: 2 }}>, </span>}
            <span style={{ color: "#059669", fontFamily: "var(--ll-font-mono)", fontWeight: 600, fontSize: `${11 * scale}px` }}>
              {d}
            </span>
          </React.Fragment>
        ))}
        <span style={{ color: "var(--ll-text-muted)", fontSize: `${12 * scale}px` }}>) = </span>
      </span>
    );
  };

  // Optional RHS Evaluated Nominal Badge
  const renderNominalBadge = () => {
    if (nominalValue === undefined || nominalValue === null) return null;
    return (
      <span
        style={{
          marginLeft: 8,
          fontSize: `${11 * scale}px`,
          fontWeight: 700,
          fontFamily: "var(--ll-font-mono)",
          color: "#059669",
          background: "rgba(16, 185, 129, 0.08)",
          padding: "2px 6px",
          borderRadius: 4,
          border: "1px solid rgba(16, 185, 129, 0.25)",
          whiteSpace: "nowrap",
        }}
      >
        = {Number(nominalValue).toFixed(2)} {unit}
      </span>
    );
  };

  // 1. Definite Integral: integral(lower, upper, integrand)
  const intMatch = trimmed.match(/^integral\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(.+)\s*\)$/i);
  if (intMatch) {
    const lower = intMatch[1].trim();
    const upper = intMatch[2].trim();
    const integrand = intMatch[3].trim();

    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle" }}>
        {renderLhs()}
        {/* Big Integral Sign */}
        <span
          style={{
            fontSize: `${30 * scale}px`,
            lineHeight: 1,
            fontWeight: 300,
            color: "#8b5cf6",
            fontFamily: "Times New Roman, serif",
            userSelect: "none",
          }}
        >
          ∫
        </span>

        {/* Upper and Lower Limits */}
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: `${32 * scale}px`,
            fontSize: `${10.5 * scale}px`,
            marginRight: 2,
            lineHeight: 1,
          }}
        >
          <span style={{ verticalAlign: "top" }}>{renderToken(upper)}</span>
          <span style={{ verticalAlign: "bottom" }}>{renderToken(lower)}</span>
        </div>

        {/* Integrand */}
        <span style={{ padding: "0 2px", fontSize: `${fontSize}px` }}>
          {renderIntegrand(integrand)}
        </span>

        {/* Differential dt */}
        <span
          style={{
            fontStyle: "italic",
            fontWeight: 650,
            color: "#8b5cf6",
            fontSize: `${12 * scale}px`,
            marginLeft: 2,
            fontFamily: "Times New Roman, serif",
          }}
        >
          dt
        </span>

        {renderNominalBadge()}
      </div>
    );
  }

  // 2. Summation: sum(start, end, term)
  const sumMatch = trimmed.match(/^sum\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(.+)\s*\)$/i);
  if (sumMatch) {
    const start = sumMatch[1].trim();
    const end = sumMatch[2].trim();
    const term = sumMatch[3].trim();

    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle" }}>
        {renderLhs()}
        <span
          style={{
            fontSize: `${26 * scale}px`,
            lineHeight: 1,
            fontWeight: 400,
            color: "#8b5cf6",
            fontFamily: "Times New Roman, serif",
            userSelect: "none",
          }}
        >
          ∑
        </span>

        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: `${32 * scale}px`,
            fontSize: `${10.5 * scale}px`,
            marginRight: 3,
            lineHeight: 1,
          }}
        >
          <span>{renderToken(end)}</span>
          <span style={{ fontSize: `${9.5 * scale}px`, color: "var(--ll-text-secondary)" }}>
            k={renderToken(start)}
          </span>
        </div>

        <span style={{ padding: "0 2px", fontSize: `${fontSize}px` }}>
          {renderIntegrand(term)}
        </span>

        {renderNominalBadge()}
      </div>
    );
  }

  // 3. Matrix 2x2 Determinant: det2(a, b, c, d)
  const det2Match = trimmed.match(/^det2\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*\)$/i);
  if (det2Match) {
    const [, a, b, c, d] = det2Match;
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}>
        {renderLhs()}
        <span style={{ fontSize: `${11 * scale}px`, fontWeight: 700, color: "#8b5cf6", fontFamily: "var(--ll-font-mono)" }}>
          det
        </span>
        <div
          style={{
            display: "inline-grid",
            gridTemplateColumns: "auto auto",
            columnGap: 10,
            rowGap: 2,
            padding: "2px 6px",
            borderLeft: "2px solid var(--ll-text-primary)",
            borderRight: "2px solid var(--ll-text-primary)",
            background: "rgba(0,0,0,0.02)",
            borderRadius: 2,
            fontSize: `${11.5 * scale}px`,
          }}
        >
          <span>{renderToken(a)}</span>
          <span>{renderToken(b)}</span>
          <span>{renderToken(c)}</span>
          <span>{renderToken(d)}</span>
        </div>

        {renderNominalBadge()}
      </div>
    );
  }

  // 4. Matrix 3x3 Determinant: det3(...)
  const det3Match = trimmed.match(/^det3\s*\(\s*(.+)\s*\)$/i);
  if (det3Match) {
    const cells = det3Match[1].split(",").map((s) => s.trim());
    if (cells.length === 9) {
      return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}>
          {renderLhs()}
          <span style={{ fontSize: `${11 * scale}px`, fontWeight: 700, color: "#8b5cf6", fontFamily: "var(--ll-font-mono)" }}>
            det
          </span>
          <div
            style={{
              display: "inline-grid",
              gridTemplateColumns: "auto auto auto",
              columnGap: 8,
              rowGap: 2,
              padding: "2px 6px",
              borderLeft: "2px solid var(--ll-text-primary)",
              borderRight: "2px solid var(--ll-text-primary)",
              background: "rgba(0,0,0,0.02)",
              borderRadius: 2,
              fontSize: `${11 * scale}px`,
            }}
          >
            {cells.map((c, i) => (
              <span key={i}>{renderToken(c)}</span>
            ))}
          </div>
          {renderNominalBadge()}
        </div>
      );
    }
  }

  // 5. Vector Norm: norm2(x, y) or norm3(x, y, z)
  const norm2Match = trimmed.match(/^norm2\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*\)$/i);
  if (norm2Match) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle" }}>
        {renderLhs()}
        <span style={{ fontSize: `${18 * scale}px`, color: "#8b5cf6", fontWeight: 700 }}>‖</span>
        <span style={{ fontSize: `${fontSize}px` }}>({renderToken(norm2Match[1])}, {renderToken(norm2Match[2])})</span>
        <span style={{ fontSize: `${18 * scale}px`, color: "#8b5cf6", fontWeight: 700 }}>‖</span>
        <sub style={{ fontSize: `${9 * scale}px`, color: "var(--ll-text-muted)" }}>2</sub>
        {renderNominalBadge()}
      </div>
    );
  }

  const norm3Match = trimmed.match(/^norm3\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*\)$/i);
  if (norm3Match) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle" }}>
        {renderLhs()}
        <span style={{ fontSize: `${18 * scale}px`, color: "#8b5cf6", fontWeight: 700 }}>‖</span>
        <span style={{ fontSize: `${fontSize}px` }}>
          ({renderToken(norm3Match[1])}, {renderToken(norm3Match[2])}, {renderToken(norm3Match[3])})
        </span>
        <span style={{ fontSize: `${18 * scale}px`, color: "#8b5cf6", fontWeight: 700 }}>‖</span>
        <sub style={{ fontSize: `${9 * scale}px`, color: "var(--ll-text-muted)" }}>2</sub>
        {renderNominalBadge()}
      </div>
    );
  }

  // 6. Vertical Fraction: (numerator) / (denominator)
  const fracMatch = trimmed.match(/^\((.+)\)\s*\/\s*\((.+)\)$/);
  if (fracMatch) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}>
        {renderLhs()}
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            verticalAlign: "middle",
            padding: "0 4px",
            lineHeight: 1.15,
          }}
        >
          <span style={{ borderBottom: "1.5px solid var(--ll-text-primary)", paddingBottom: 2, paddingLeft: 4, paddingRight: 4, fontSize: `${12 * scale}px`, fontWeight: 600 }}>
            {renderIntegrand(fracMatch[1])}
          </span>
          <span style={{ paddingTop: 2, paddingLeft: 4, paddingRight: 4, fontSize: `${12 * scale}px`, fontWeight: 600, color: "var(--ll-text-secondary)" }}>
            {renderIntegrand(fracMatch[2])}
          </span>
        </div>
        {renderNominalBadge()}
      </div>
    );
  }

  // 7. General fallback compound rendering
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle" }}>
      {renderLhs()}
      {renderIntegrand(trimmed)}
      {renderNominalBadge()}
    </div>
  );
}
