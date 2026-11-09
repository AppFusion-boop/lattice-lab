import React, { useState, useEffect } from "react";
import {
  X,
  Target,
  Sliders,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import type { Parameter, Outcome, TestCase, TestCaseCreate, TestCaseUpdate, TestCaseCategory } from "../api/types";
import { tr } from "../../i18n";

interface TestCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: TestCaseCreate | TestCaseUpdate) => Promise<void>;
  parameters: Parameter[];
  outcomes: Outcome[];
  initialTestCase?: TestCase | null;
}

export function TestCaseModal({
  isOpen,
  onClose,
  onSave,
  parameters,
  outcomes,
  initialTestCase,
}: TestCaseModalProps) {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [category, setCategory] = useState<TestCaseCategory>("corner_case");
  const [paramValues, setParamValues] = useState<Record<string, number | string>>({});
  const [assertions, setAssertions] = useState<Record<string, { op: string; value: number }>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const getNominalValue = (p: Parameter): number => {
    const spec = (p.spec || {}) as { min?: number; max?: number; value?: number };
    if (typeof spec.value === "number") return spec.value;
    const min = typeof spec.min === "number" ? spec.min : 0;
    const max = typeof spec.max === "number" ? spec.max : 100;
    return Number(((min + max) / 2).toFixed(2));
  };

  useEffect(() => {
    if (initialTestCase) {
      setName(initialTestCase.name);
      setDescription(initialTestCase.description || "");
      setCategory(initialTestCase.category);
      setParamValues((initialTestCase.parameters || {}) as Record<string, string | number>);
      const rawExpected = initialTestCase.expected_outcomes || {};
      const parsedAssertions: Record<string, { op: string; value: number }> = {};
      for (const [k, v] of Object.entries(rawExpected)) {
        if (typeof v === "object" && v !== null && "op" in v && "value" in v) {
          parsedAssertions[k] = { op: (v as any).op, value: Number((v as any).value) };
        } else if (typeof v === "number") {
          parsedAssertions[k] = { op: "==", value: v };
        }
      }
      setAssertions(parsedAssertions);
    } else {
      setName("");
      setDescription("");
      setCategory("corner_case");
      const defaults: Record<string, number | string> = {};
      for (const p of parameters) {
        defaults[p.key] = getNominalValue(p);
      }
      setParamValues(defaults);

      const defaultAssertions: Record<string, { op: string; value: number }> = {};
      for (const o of outcomes) {
        if (o.criterion && typeof o.criterion.value === "number") {
          defaultAssertions[o.key] = {
            op: o.criterion.op || ">=",
            value: o.criterion.value,
          };
        }
      }
      setAssertions(defaultAssertions);
    }
    setError(null);
  }, [initialTestCase, isOpen, parameters, outcomes]);

  if (!isOpen) return null;

  const handleFillNominals = () => {
    const updated: Record<string, number | string> = {};
    for (const p of parameters) {
      updated[p.key] = getNominalValue(p);
    }
    setParamValues(updated);
  };

  const handleFillMinBoundary = () => {
    const updated: Record<string, number | string> = {};
    for (const p of parameters) {
      const spec = (p.spec || {}) as { min?: number; value?: number };
      updated[p.key] = typeof spec.min === "number" ? spec.min : getNominalValue(p);
    }
    setParamValues(updated);
  };

  const handleFillMaxBoundary = () => {
    const updated: Record<string, number | string> = {};
    for (const p of parameters) {
      const spec = (p.spec || {}) as { max?: number; value?: number };
      updated[p.key] = typeof spec.max === "number" ? spec.max : getNominalValue(p);
    }
    setParamValues(updated);
  };

  const handleInheritOutcomes = () => {
    const inherited: Record<string, { op: string; value: number }> = {};
    for (const o of outcomes) {
      if (o.criterion && typeof o.criterion.value === "number") {
        inherited[o.key] = {
          op: o.criterion.op || ">=",
          value: o.criterion.value,
        };
      }
    }
    setAssertions(inherited);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(tr("გთხოვთ მიუთითოთ ტესტ-კეისის დასახელება", "Please enter a test case name."));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: TestCaseCreate = {
        name: name.trim(),
        description: description.trim(),
        category,
        parameters: paramValues,
        expected_outcomes: assertions,
      };

      await onSave(payload);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.72)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 14,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          width: "100%",
          maxWidth: 680,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #cbd5e1",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--ll-emerald-soft)",
                color: "var(--ll-emerald)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--ll-emerald-border)",
              }}
            >
              <Target size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                {initialTestCase
                  ? tr("ტესტ-კეისის რედაქტირება", "Edit Test Case")
                  : tr("ახალი ზუსტი ტესტ-კეისი", "Add Custom Exact Test Case")}
              </h3>
              <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "#64748b" }}>
                {tr(
                  "განსაზღვრეთ კონკრეტული ექსპერიმენტული წერტილი სიმულაციური მოდელის შესამოწმებლად",
                  "Configure an exact physical parameter set and assertions to test against the Flow model."
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: 6, color: "#64748b", borderRadius: 6 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            overflowY: "auto",
            flex: 1,
            padding: "20px 24px",
            background: "#ffffff",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {error && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "#fef2f2",
                color: "#991b1b",
                border: "1px solid #fecaca",
                fontSize: 12.5,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* Metadata Section */}
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1.2fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "#334155", marginBottom: 5 }}>
                  {tr("ტესტ-კეისის სახელი", "Test Case Name")} *
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{
                    width: "100%",
                    fontSize: 13,
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    padding: "7px 10px",
                  }}
                  placeholder={tr("მაგ. კრიტიკული ხახუნის საზღვარი 220 mN", "e.g. Critical Contact Force (220 mN) Corner")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "#334155", marginBottom: 5 }}>
                  {tr("კატეგორია", "Category")}
                </label>
                <select
                  className="form-select"
                  style={{
                    width: "100%",
                    fontSize: 12.5,
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    padding: "7px 10px",
                  }}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TestCaseCategory)}
                >
                  <option value="corner_case">{tr("Corner Case (კუთხური/სტრესული)", "Corner Case (Stress)")}</option>
                  <option value="benchmark">{tr("Benchmark (სტანდარტული)", "Benchmark Standard")}</option>
                  <option value="boundary">{tr("Boundary (საზღვრული)", "Boundary Limit")}</option>
                  <option value="regression">{tr("Regression (რეგრესია)", "Regression Check")}</option>
                  <option value="nominal">{tr("Nominal (ნომინალური)", "Nominal Midpoint")}</option>
                  <option value="custom">{tr("Custom (მორგებული)", "Custom Point")}</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "#334155", marginBottom: 5 }}>
                {tr("აღწერა & ჰიპოთეზა", "Description & Scientific Justification")}
              </label>
              <input
                type="text"
                className="form-input"
                style={{
                  width: "100%",
                  fontSize: 12,
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
                placeholder={tr("რას ვამოწმებთ ამ ტესტით და რა ფიზიკურ რეჟიმს წარმოადგენს...", "Why this test matters, literature source, or expected failure mode...")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {/* Section: Exact Parameters */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid #f1f5f9",
                paddingBottom: 8,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                <Sliders size={15} color="var(--ll-emerald)" />
                <span>{tr("ექსპერიმენტის ზუსტი პარამეტრები", "Exact Parameter Values")}</span>
                <span className="badge" style={{ fontSize: 10, background: "#f1f5f9", color: "#475569" }}>
                  {parameters.length}
                </span>
              </div>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: "3px 8px", height: 26, display: "inline-flex", alignItems: "center", gap: 4 }}
                  onClick={handleFillNominals}
                  title="Fill all parameters with nominal median values"
                >
                  <Sparkles size={11} color="#059669" />
                  <span>{tr("ნომინალი", "Nominal")}</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: "3px 8px", height: 26 }}
                  onClick={handleFillMinBoundary}
                  title="Fill all parameters with minimum allowable range values"
                >
                  <span>Min</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: "3px 8px", height: 26 }}
                  onClick={handleFillMaxBoundary}
                  title="Fill all parameters with maximum allowable range values"
                >
                  <span>Max</span>
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {parameters.map((p) => {
                const spec = (p.spec || {}) as { min?: number; max?: number };
                const currentVal = paramValues[p.key] !== undefined ? paramValues[p.key] : getNominalValue(p);
                const isOutOfRange =
                  typeof spec.min === "number" &&
                  typeof spec.max === "number" &&
                  typeof currentVal === "number" &&
                  (currentVal < spec.min || currentVal > spec.max);

                return (
                  <div
                    key={p.key}
                    style={{
                      background: isOutOfRange ? "#fffbeb" : "#f8fafc",
                      border: `1px solid ${isOutOfRange ? "#fde68a" : "#e2e8f0"}`,
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                      <span
                        style={{ fontSize: 12, fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={p.label}
                      >
                        {p.label}
                      </span>
                      {p.unit && (
                        <span style={{ fontSize: 10, color: "#64748b", fontFamily: "var(--ll-font-mono)", fontWeight: 500 }}>
                          {p.unit}
                        </span>
                      )}
                    </div>

                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      style={{
                        width: "100%",
                        fontSize: 12.5,
                        padding: "5px 8px",
                        fontFamily: "var(--ll-font-mono)",
                        fontWeight: 600,
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                      }}
                      value={currentVal}
                      onChange={(e) => {
                        const val = e.target.value === "" ? "" : Number(e.target.value);
                        setParamValues((prev) => ({ ...prev, [p.key]: val }));
                      }}
                    />

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginTop: 4 }}>
                      <span>
                        {spec.min !== undefined && spec.max !== undefined
                          ? `[${spec.min} .. ${spec.max}]`
                          : p.role}
                      </span>
                      {isOutOfRange && (
                        <span style={{ color: "#b45309", fontWeight: 600 }}>
                          {tr("საზღვრებს გარეთ", "out of DoE range")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section: Expected Outcome Criteria / Assertions */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid #f1f5f9",
                paddingBottom: 8,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                <Target size={15} color="var(--ll-blue)" />
                <span>{tr("მოსალოდნელი შედეგები & ასერციები", "Expected Assertions & Criteria")}</span>
                <span className="badge" style={{ fontSize: 10, background: "#f1f5f9", color: "#475569" }}>
                  {outcomes.length}
                </span>
              </div>

              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 11, padding: "3px 8px", height: 26, color: "var(--ll-blue)" }}
                onClick={handleInheritOutcomes}
                title="Reset assertions to study default target criteria"
              >
                <span>{tr("კვლევის კრიტერიუმებიდან გადმოწერა", "Inherit Study Targets")}</span>
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {outcomes.map((o) => {
                const ass = assertions[o.key] || { op: o.criterion?.op || ">=", value: o.criterion?.value ?? 0 };
                const hasAssertion = assertions[o.key] !== undefined;

                return (
                  <div
                    key={o.key}
                    style={{
                      background: hasAssertion ? "#f8fafc" : "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "9px 12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0f172a" }}>
                        {o.label}
                      </div>
                      <div style={{ fontSize: 10.5, color: "#64748b", fontFamily: "var(--ll-font-mono)" }}>
                        {o.key} {o.unit ? `(${o.unit})` : ""} · {o.direction}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <select
                        className="form-select"
                        style={{
                          fontSize: 12,
                          padding: "5px 8px",
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: 6,
                        }}
                        value={ass.op}
                        onChange={(e) => {
                          setAssertions((prev) => ({
                            ...prev,
                            [o.key]: { ...ass, op: e.target.value },
                          }));
                        }}
                      >
                        <option value=">=">&gt;= (მინიმუმ / min)</option>
                        <option value="<=">&lt;= (მაქსიმუმ / max)</option>
                        <option value=">">&gt; (მკაცრად მეტი / strictly &gt;)</option>
                        <option value="<">&lt; (მკაცრად ნაკლები / strictly &lt;)</option>
                        <option value="==">== (ტოლობა ±2% / target)</option>
                      </select>

                      <input
                        type="number"
                        step="any"
                        className="form-input"
                        style={{
                          width: 85,
                          fontSize: 12.5,
                          padding: "5px 8px",
                          fontFamily: "var(--ll-font-mono)",
                          fontWeight: 600,
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: 6,
                        }}
                        value={ass.value}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setAssertions((prev) => ({
                            ...prev,
                            [o.key]: { ...ass, value: val },
                          }));
                        }}
                      />

                      {o.unit && (
                        <span style={{ fontSize: 11, color: "#475569", minWidth: 28, fontFamily: "var(--ll-font-mono)" }}>
                          {o.unit}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </form>

        {/* Sticky Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 10,
            padding: "14px 20px",
            background: "#f8fafc",
            borderTop: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
            style={{ padding: "7px 14px", fontSize: 12.5 }}
          >
            {tr("გაუქმება", "Cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={saving}
            style={{ padding: "7px 16px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <CheckCircle2 size={14} />
            <span>{saving ? tr("ინახება...", "Saving...") : tr("ტესტის შენახვა", "Save Test Case")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
