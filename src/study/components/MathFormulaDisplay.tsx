import React, { useMemo } from "react";
import type { Parameter } from "../api/types";
import {
  type MathNode,
  type MathRow,
  parseExpressionToMathRow,
} from "./mathBuilderModel";

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

const OP_SYMBOLS: Record<string, string> = {
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

const FN_LABELS: Record<string, string> = {
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

/**
 * Recursive 2D Mathematical Typography Renderer (Symbolab / WolframAlpha style).
 * Parses any Lattice expression AST and renders all nested structures in 2D notation.
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

  const rootRow = useMemo(() => {
    if (!trimmed) return null;
    return parseExpressionToMathRow(trimmed);
  }, [trimmed]);

  if (!trimmed) {
    return (
      <span style={{ color: "var(--ll-text-muted)", fontStyle: "italic", fontSize: 12 }}>
        —
      </span>
    );
  }

  const scale = size === "sm" ? 0.86 : size === "lg" ? 1.18 : 1.0;
  const paramKeySet = new Set(studyParameters.map((p) => p.key));

  const renderRow = (row: MathRow, depth = 0): React.ReactNode => {
    const subScale = Math.max(0.75, scale * Math.pow(0.92, Math.min(depth, 3)));
    if (row.items.length === 0) {
      return (
        <span
          style={{
            display: "inline-block",
            width: 14 * subScale,
            height: 14 * subScale,
            border: "1px dashed rgba(139, 92, 246, 0.5)",
            borderRadius: 3,
            background: "rgba(139, 92, 246, 0.06)",
            verticalAlign: "middle",
          }}
        />
      );
    }

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          verticalAlign: "middle",
          gap: 1.5,
        }}
      >
        {row.items.map((node) => renderNode(node, depth, subScale))}
      </span>
    );
  };

  const renderNode = (
    node: MathNode,
    depth: number,
    s: number,
  ): React.ReactNode => {
    switch (node.kind) {
      case "char":
        return (
          <span
            key={node.id}
            style={{
              fontFamily: "var(--ll-font-mono)",
              fontWeight: 600,
              fontSize: `${12.5 * s}px`,
              color: "var(--ll-text-primary)",
            }}
          >
            {node.char}
          </span>
        );

      case "var": {
        if (node.name === "pi") {
          return (
            <span
              key={node.id}
              style={{
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 700,
                fontSize: `${14 * s}px`,
                color: "#7c3aed",
                padding: "0 1px",
              }}
            >
              π
            </span>
          );
        }
        if (node.name === "e" || node.name === "t" || node.name === "k") {
          return (
            <span
              key={node.id}
              style={{
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 650,
                fontSize: `${13.5 * s}px`,
                color: "#7c3aed",
                padding: "0 1px",
              }}
            >
              {node.name}
            </span>
          );
        }
        if (paramKeySet.has(node.name)) {
          return (
            <span
              key={node.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: `${1 * s}px ${5 * s}px`,
                background: "rgba(16, 185, 129, 0.12)",
                color: "#059669",
                border: "1px solid rgba(16, 185, 129, 0.32)",
                borderRadius: 4,
                fontWeight: 650,
                fontSize: `${11 * s}px`,
                fontFamily: "var(--ll-font-mono)",
                margin: "0 1px",
                lineHeight: 1.25,
              }}
            >
              {node.name}
            </span>
          );
        }
        return (
          <span
            key={node.id}
            style={{
              fontFamily: "var(--ll-font-mono)",
              fontWeight: 600,
              fontSize: `${12 * s}px`,
              color: "var(--ll-text-primary)",
            }}
          >
            {node.name}
          </span>
        );
      }

      case "op":
        return (
          <span
            key={node.id}
            style={{
              color: "var(--ll-text-secondary)",
              fontWeight: 600,
              fontSize: `${12.5 * s}px`,
              margin: node.op === "*" ? "0 2px" : "0 4px",
              userSelect: "none",
            }}
          >
            {OP_SYMBOLS[node.op] || node.op}
          </span>
        );

      case "frac":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              verticalAlign: "middle",
              margin: "0 3px",
              lineHeight: 1.15,
            }}
          >
            <span
              style={{
                padding: "0 4px 2px 4px",
                borderBottom: "1.5px solid var(--ll-text-primary)",
                width: "100%",
                textAlign: "center",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {renderRow(node.num, depth + 1)}
            </span>
            <span
              style={{
                padding: "2px 4px 0 4px",
                width: "100%",
                textAlign: "center",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {renderRow(node.den, depth + 1)}
            </span>
          </span>
        );

      case "pow": {
        const baseHasOp = node.base.items.some(
          (it) => it.kind === "op" || it.kind === "frac",
        );
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              margin: "0 1px",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              {baseHasOp && (
                <span style={{ color: "var(--ll-text-muted)", fontWeight: 400 }}>(</span>
              )}
              {renderRow(node.base, depth)}
              {baseHasOp && (
                <span style={{ color: "var(--ll-text-muted)", fontWeight: 400 }}>)</span>
              )}
            </span>
            <sup
              style={{
                fontSize: `${10 * s}px`,
                lineHeight: 1,
                marginLeft: 1,
                transform: "translateY(-0.35em)",
                display: "inline-flex",
              }}
            >
              {renderRow(node.exp, depth + 1)}
            </sup>
          </span>
        );
      }

      case "sqrt":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "stretch",
              verticalAlign: "middle",
              margin: "0 2px",
            }}
          >
            <svg
              width={11 * s}
              viewBox="0 0 12 24"
              preserveAspectRatio="none"
              style={{
                display: "block",
                overflow: "visible",
                color: "#7c3aed",
                marginRight: -1,
              }}
            >
              <path
                d="M 1 14 L 4 14 L 7 22 L 11.5 1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                borderTop: "1.5px solid #7c3aed",
                padding: "2px 4px 1px 3px",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {renderRow(node.radicand, depth + 1)}
            </span>
          </span>
        );

      case "nthroot":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              verticalAlign: "middle",
              margin: "0 2px",
            }}
          >
            <sup
              style={{
                fontSize: `${9 * s}px`,
                marginRight: -3,
                transform: "translateY(-0.45em)",
                color: "#7c3aed",
                fontWeight: 700,
              }}
            >
              {renderRow(node.degree, depth + 2)}
            </sup>
            <span style={{ display: "inline-flex", alignItems: "stretch" }}>
              <svg
                width={11 * s}
                viewBox="0 0 12 24"
                preserveAspectRatio="none"
                style={{
                  display: "block",
                  overflow: "visible",
                  color: "#7c3aed",
                  marginRight: -1,
                }}
              >
                <path
                  d="M 1 14 L 4 14 L 7 22 L 11.5 1.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                style={{
                  borderTop: "1.5px solid #7c3aed",
                  padding: "2px 4px 1px 3px",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                {renderRow(node.radicand, depth + 1)}
              </span>
            </span>
          </span>
        );

      case "abs":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "1.8px solid #7c3aed",
              borderRight: "1.8px solid #7c3aed",
              padding: "1px 5px",
              margin: "0 2px",
            }}
          >
            {renderRow(node.inner, depth)}
          </span>
        );

      case "floor":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "1.8px solid #7c3aed",
              borderRight: "1.8px solid #7c3aed",
              borderBottom: "1.8px solid #7c3aed",
              padding: "1px 5px",
              margin: "0 2px",
            }}
          >
            {renderRow(node.inner, depth)}
          </span>
        );

      case "ceil":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "1.8px solid #7c3aed",
              borderRight: "1.8px solid #7c3aed",
              borderTop: "1.8px solid #7c3aed",
              padding: "1px 5px",
              margin: "0 2px",
            }}
          >
            {renderRow(node.inner, depth)}
          </span>
        );

      case "paren":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              margin: "0 1px",
            }}
          >
            <span
              style={{
                fontSize: `${15 * s}px`,
                color: "var(--ll-text-secondary)",
                fontWeight: 400,
                paddingRight: 1,
              }}
            >
              (
            </span>
            {renderRow(node.inner, depth)}
            <span
              style={{
                fontSize: `${15 * s}px`,
                color: "var(--ll-text-secondary)",
                fontWeight: 400,
                paddingLeft: 1,
              }}
            >
              )
            </span>
          </span>
        );

      case "integral":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              margin: "0 3px",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                fontSize: `${28 * s}px`,
                lineHeight: 1,
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
                height: `${30 * s}px`,
                fontSize: `${10 * s}px`,
                lineHeight: 1,
                marginRight: 2,
              }}
            >
              <span>{renderRow(node.upper, depth + 2)}</span>
              <span>{renderRow(node.lower, depth + 2)}</span>
            </span>
            <span style={{ padding: "0 2px" }}>{renderRow(node.integrand, depth)}</span>
            <span
              style={{
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 700,
                color: "#7c3aed",
                fontSize: `${12.5 * s}px`,
                marginLeft: 2,
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
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              margin: "0 3px",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                lineHeight: 1,
              }}
            >
              <span style={{ fontSize: `${9.5 * s}px`, marginBottom: 1 }}>
                {renderRow(node.end, depth + 2)}
              </span>
              <span
                style={{
                  fontSize: `${22 * s}px`,
                  lineHeight: 0.95,
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
                  fontSize: `${9.5 * s}px`,
                  marginTop: 1,
                  color: "var(--ll-text-secondary)",
                }}
              >
                <i style={{ fontFamily: "'Times New Roman', serif", marginRight: 1 }}>
                  {node.indexVar || "k"}=
                </i>
                {renderRow(node.start, depth + 2)}
              </span>
            </span>
            <span style={{ padding: "0 2px" }}>{renderRow(node.term, depth)}</span>
          </span>
        );
      }

      case "deriv":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              margin: "0 3px",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                lineHeight: 1,
                fontFamily: "'Times New Roman', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 700,
                color: "#7c3aed",
                fontSize: `${11 * s}px`,
              }}
            >
              <span style={{ borderBottom: "1.3px solid #7c3aed", padding: "0 2px 1px 2px" }}>
                d{node.order === 2 ? "²" : ""}
              </span>
              <span style={{ paddingTop: 1 }}>dt{node.order === 2 ? "²" : ""}</span>
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderLeft: "1.5px solid var(--ll-text-secondary)",
                borderRight: "1.8px solid #7c3aed",
                padding: "1px 4px",
              }}
            >
              {renderRow(node.body, depth)}
            </span>
            <sub
              style={{
                fontSize: `${9.5 * s}px`,
                color: "#7c3aed",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <i style={{ fontFamily: "'Times New Roman', serif", marginRight: 1 }}>t=</i>
              {renderRow(node.atPoint, depth + 2)}
            </sub>
          </span>
        );

      case "matrix": {
        const prefix =
          node.op === "det" ? "det" : node.op === "trace" ? "tr" : null;
        const borderStyle =
          node.op === "det"
            ? "2px solid var(--ll-text-primary)"
            : "2px solid #7c3aed";
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              margin: "0 3px",
              verticalAlign: "middle",
            }}
          >
            {prefix && (
              <span
                style={{
                  fontSize: `${11 * s}px`,
                  fontWeight: 700,
                  color: "#7c3aed",
                  fontFamily: "var(--ll-font-mono)",
                }}
              >
                {prefix}
              </span>
            )}
            {node.op === "fnorm" && (
              <span style={{ fontSize: `${16 * s}px`, fontWeight: 700, color: "#7c3aed" }}>
                ‖
              </span>
            )}
            <span
              style={{
                display: "inline-grid",
                gridTemplateColumns: `repeat(${node.size}, auto)`,
                columnGap: 8 * s,
                rowGap: 2 * s,
                padding: "2px 6px",
                borderLeft: borderStyle,
                borderRight: borderStyle,
                borderRadius: node.op === "det" ? 0 : 3,
                background: "rgba(139, 92, 246, 0.03)",
              }}
            >
              {node.cells.map((cell, idx) => (
                <span key={idx} style={{ textAlign: "center" }}>
                  {renderRow(cell, depth + 1)}
                </span>
              ))}
            </span>
            {node.op === "fnorm" && (
              <>
                <span style={{ fontSize: `${16 * s}px`, fontWeight: 700, color: "#7c3aed" }}>
                  ‖
                </span>
                <sub style={{ fontSize: `${9 * s}px`, color: "#7c3aed", fontWeight: 700 }}>
                  F
                </sub>
              </>
            )}
          </span>
        );
      }

      case "vecnorm":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              margin: "0 2px",
              verticalAlign: "middle",
            }}
          >
            <span style={{ fontSize: `${17 * s}px`, fontWeight: 700, color: "#7c3aed" }}>‖</span>
            <span style={{ color: "var(--ll-text-muted)" }}>(</span>
            {node.coords.map((c, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span style={{ color: "var(--ll-text-muted)", marginRight: 2 }}>,</span>}
                {renderRow(c, depth + 1)}
              </React.Fragment>
            ))}
            <span style={{ color: "var(--ll-text-muted)" }}>)</span>
            <span style={{ fontSize: `${17 * s}px`, fontWeight: 700, color: "#7c3aed" }}>‖</span>
            <sub style={{ fontSize: `${9 * s}px`, color: "var(--ll-text-muted)", fontWeight: 700 }}>
              2
            </sub>
          </span>
        );

      case "vecdot":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              margin: "0 2px",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                borderLeft: "1.5px solid var(--ll-text-primary)",
                borderRight: "1.5px solid var(--ll-text-primary)",
                borderRadius: 4,
                padding: "1px 5px",
                gap: 1,
              }}
            >
              {node.left.map((r, i) => (
                <span key={i}>{renderRow(r, depth + 1)}</span>
              ))}
            </span>
            <span style={{ fontWeight: 800, color: "#7c3aed", fontSize: `${14 * s}px` }}>·</span>
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                borderLeft: "1.5px solid var(--ll-text-primary)",
                borderRight: "1.5px solid var(--ll-text-primary)",
                borderRadius: 4,
                padding: "1px 5px",
                gap: 1,
              }}
            >
              {node.right.map((r, i) => (
                <span key={i}>{renderRow(r, depth + 1)}</span>
              ))}
            </span>
          </span>
        );

      case "logbase":
        return (
          <span
            key={node.id}
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
                fontSize: `${12 * s}px`,
              }}
            >
              log
            </span>
            <sub style={{ fontSize: `${9.5 * s}px`, marginRight: 2 }}>
              {renderRow(node.base, depth + 2)}
            </sub>
            <span style={{ color: "var(--ll-text-muted)" }}>(</span>
            {renderRow(node.arg, depth)}
            <span style={{ color: "var(--ll-text-muted)" }}>)</span>
          </span>
        );

      case "binom":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderLeft: "1.8px solid #7c3aed",
              borderRight: "1.8px solid #7c3aed",
              borderRadius: 8,
              padding: "1px 6px",
              margin: "0 2px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                lineHeight: 1.1,
              }}
            >
              <span>{renderRow(node.n, depth + 1)}</span>
              <span>{renderRow(node.k, depth + 1)}</span>
            </span>
          </span>
        );

      case "piecewise":
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              margin: "0 3px",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                fontSize: `${26 * s}px`,
                color: "#7c3aed",
                fontWeight: 300,
                lineHeight: 1,
                fontFamily: "serif",
              }}
            >
              {"{"}
            </span>
            <span
              style={{
                display: "inline-grid",
                gridTemplateColumns: "auto auto",
                columnGap: 8,
                rowGap: 2,
                fontSize: `${11 * s}px`,
                alignItems: "center",
              }}
            >
              <span>{renderRow(node.thenRow, depth + 1)}</span>
              <span style={{ color: "var(--ll-text-secondary)", fontStyle: "italic" }}>
                if {renderRow(node.cond, depth + 1)}
              </span>
              <span>{renderRow(node.elseRow, depth + 1)}</span>
              <span style={{ color: "var(--ll-text-muted)", fontStyle: "italic" }}>
                otherwise
              </span>
            </span>
          </span>
        );

      case "fn": {
        if (node.fn === "fact" && node.args.length === 1) {
          return (
            <span key={node.id} style={{ display: "inline-flex", alignItems: "center" }}>
              <span style={{ color: "var(--ll-text-muted)" }}>(</span>
              {renderRow(node.args[0], depth)}
              <span style={{ color: "var(--ll-text-muted)" }}>)</span>
              <span style={{ fontWeight: 800, color: "#7c3aed", marginLeft: 1 }}>!</span>
            </span>
          );
        }
        const label = FN_LABELS[node.fn] || node.fn;
        return (
          <span
            key={node.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              margin: "0 1px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--ll-font-mono)",
                fontWeight: 700,
                color: "#7c3aed",
                fontSize: `${12 * s}px`,
                marginRight: 1,
              }}
            >
              {label}
            </span>
            <span style={{ color: "var(--ll-text-muted)" }}>(</span>
            {node.args.map((arg, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span style={{ color: "var(--ll-text-muted)", marginRight: 3 }}>,</span>}
                {renderRow(arg, depth)}
              </React.Fragment>
            ))}
            <span style={{ color: "var(--ll-text-muted)" }}>)</span>
          </span>
        );
      }
    }
  };

  const renderLhs = () => {
    if (!showLhs) return null;
    const depsToUse =
      dependencies.length > 0
        ? dependencies
        : studyParameters.filter((p) => trimmed.includes(p.key)).map((p) => p.key);
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          marginRight: 6,
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontStyle: "italic",
            fontFamily: "'Times New Roman', Georgia, serif",
            fontWeight: 700,
            color: "var(--ll-text-primary)",
            fontSize: `${13.5 * scale}px`,
          }}
        >
          {paramKey ? paramKey : "f"}
        </span>
        <span style={{ color: "var(--ll-text-muted)", fontSize: `${12 * scale}px` }}>(</span>
        {depsToUse.map((d, i) => (
          <React.Fragment key={d}>
            {i > 0 && <span style={{ color: "var(--ll-text-muted)", marginRight: 2 }}>, </span>}
            <span
              style={{
                color: "#059669",
                fontFamily: "var(--ll-font-mono)",
                fontWeight: 600,
                fontSize: `${11 * scale}px`,
              }}
            >
              {d}
            </span>
          </React.Fragment>
        ))}
        <span style={{ color: "var(--ll-text-muted)", fontSize: `${12 * scale}px` }}>
          ) ={" "}
        </span>
      </span>
    );
  };

  const renderNominalBadge = () => {
    if (nominalValue === undefined || nominalValue === null || !Number.isFinite(nominalValue)) {
      return null;
    }
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
        ≈ {Number(nominalValue).toPrecision(4).replace(/\.?0+$/, "")} {unit}
      </span>
    );
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 3,
        verticalAlign: "middle",
      }}
    >
      {renderLhs()}
      {rootRow ? renderRow(rootRow, 0) : <span>{trimmed}</span>}
      {renderNominalBadge()}
    </div>
  );
}
