import { useState } from "react";
import { Plus, Trash2, X, Sliders, AlertCircle, Activity, Calculator } from "lucide-react";
import { apiGet, apiPost, apiDelete, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study, Parameter, ParameterCreate, Outcome } from "../api/types";
import { tr } from "../../i18n";
import { TornadoChart } from "../components/TornadoChart";
import { VisualMathBuilder } from "../components/VisualMathBuilder";
import { MathFormulaDisplay } from "../components/MathFormulaDisplay";
import "../study.css";

interface ParametersTabProps {
  study: Study;
}

export function ParametersTab({ study }: ParametersTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [kind, setKind] = useState<"continuous" | "integer" | "categorical">("continuous");
  const [role, setRole] = useState<"controlled" | "uncertain" | "fixed" | "dependent">("controlled");

  // Dependent formula spec
  const [dependentExpr, setDependentExpr] = useState("");
  const [dependentDeps, setDependentDeps] = useState<string[]>([]);
  const [dependentSample, setDependentSample] = useState<number | null>(null);

  // Continuous spec
  const [minVal, setMinVal] = useState("10");
  const [maxVal, setMaxVal] = useState("1000");
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [levels, setLevels] = useState("10");
  const [fixedVal, setFixedVal] = useState("");

  // Integer spec
  const [stepVal, setStepVal] = useState("1");

  // Categorical spec
  const [optionsStr, setOptionsStr] = useState("Option A, Option B, Option C");

  // Distribution for uncertain
  const [distType, setDistType] = useState<"uniform" | "normal" | "lognormal" | "triangular">("normal");
  const [distMean, setDistMean] = useState("");
  const [distSd, setDistSd] = useState("");

  const [showTornado, setShowTornado] = useState<boolean>(false);

  const {
    data: parameters,
    loading,
    refresh,
  } = useApi<Parameter[]>(`parameters-${study.id}`, () =>
    apiGet<Parameter[]>(`/studies/${study.id}/parameters`)
  );

  const {
    data: outcomes,
  } = useApi<Outcome[]>(`outcomes-${study.id}`, () =>
    apiGet<Outcome[]>(`/studies/${study.id}/outcomes`)
  );

  const resetForm = () => {
    setKey("");
    setLabel("");
    setUnit("");
    setKind("continuous");
    setRole("controlled");
    setDependentExpr("");
    setDependentDeps([]);
    setDependentSample(null);
    setMinVal("10");
    setMaxVal("1000");
    setScale("linear");
    setLevels("10");
    setFixedVal("");
    setStepVal("1");
    setOptionsStr("Option A, Option B, Option C");
    setDistType("normal");
    setDistMean("");
    setDistSd("");
    setFieldErrors({});
    setFormError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    let spec: Record<string, unknown> = {};

    if (role === "dependent") {
      if (!dependentExpr.trim()) {
        setFormError(tr("მიუთითეთ მათემატიკური წესი / ფორმულა", "Please define a mathematical formula for the dependent parameter"));
        return;
      }
      spec = {
        expression: dependentExpr.trim(),
        dependencies: dependentDeps,
        sample_value: dependentSample,
      };
    } else if (kind === "continuous") {
      const minNum = parseFloat(minVal);
      const maxNum = parseFloat(maxVal);
      spec = {
        min: minNum,
        max: maxNum,
        scale,
        levels: levels ? parseInt(levels, 10) : undefined,
      };

      if (role === "fixed") {
        spec.value = fixedVal ? parseFloat(fixedVal) : minNum;
      } else if (role === "uncertain") {
        if (distType === "uniform") {
          spec.distribution = { type: "uniform" };
        } else {
          spec.distribution = {
            type: distType,
            mean: distMean ? parseFloat(distMean) : (minNum + maxNum) / 2,
            sd: distSd ? parseFloat(distSd) : (maxNum - minNum) / 6,
          };
        }
      }
    } else if (kind === "integer") {
      spec = {
        min: parseInt(minVal, 10),
        max: parseInt(maxVal, 10),
        step: parseInt(stepVal, 10) || 1,
      };
      if (role === "fixed") {
        spec.value = fixedVal ? parseInt(fixedVal, 10) : parseInt(minVal, 10);
      }
    } else if (kind === "categorical") {
      const opts = optionsStr.split(",").map((s) => s.trim()).filter(Boolean);
      spec = { options: opts };
      if (role === "fixed") {
        spec.value = fixedVal || opts[0];
      }
    }

    const payload: ParameterCreate = {
      key: key.trim(),
      label: label.trim() || key.trim(),
      unit: unit.trim(),
      kind,
      role,
      spec,
    };

    try {
      await apiPost(`/studies/${study.id}/parameters`, payload);
      setShowModal(false);
      resetForm();
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.field) {
          setFieldErrors({ [err.field]: err.message });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError((err as Error).message);
      }
    }
  };

  const handleDelete = async (param: Parameter) => {
    if (!confirm(tr(`ნამდვილად გსურთ '${param.label}' პარამეტრის წაშლა?`, `Delete parameter '${param.label}'?`))) {
      return;
    }
    try {
      await apiDelete(`/studies/${study.id}/parameters/${param.id}`);
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="study-card" style={{ padding: 0, overflow: "hidden", marginBottom: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 20px",
            background: "var(--ll-surface)",
            borderBottom: "1px solid var(--ll-border)",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--ll-text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
              <Sliders size={16} color="var(--ll-emerald)" />
              <span>{tr("კვლევის პარამეტრები (Experimental Parameters)", "Experimental Parameters")}</span>
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ll-text-secondary)" }}>
              {tr(
                "მართვადი (DoE ცვლადები), გაურკვეველი (მონტე-კარლო განაწილებები) და ფიქსირებული პარამეტრები.",
                "Controlled factors, uncertain epistemic variables, and fixed bench constants.",
              )}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn-secondary"
              onClick={() => setShowTornado(!showTornado)}
              style={{ color: showTornado ? "var(--ll-blue)" : undefined }}
            >
              <Activity size={13} color="var(--ll-blue)" />
              <span>{showTornado ? tr("სენსიტიურობის დახურვა", "Hide Sensitivity") : tr("სენსიტიურობა (სობოლი)", "Sobol Sensitivity")}</span>
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                resetForm();
                setRole("controlled");
                setShowModal(true);
              }}
            >
              <Plus size={14} />
              <span>{tr("პარამეტრის დამატება", "Add Parameter")}</span>
            </button>
          </div>
        </div>

        {showTornado && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--ll-border)", background: "var(--ll-surface-subtle)" }}>
            <TornadoChart
              study={study}
              outcomes={outcomes || []}
              parameters={parameters || []}
              onParameterUpdated={() => {
                refresh();
              }}
            />
          </div>
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--ll-text-muted)" }}>{tr("იტვირთება...", "Loading...")}</div>
        ) : !parameters || parameters.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--ll-text-muted)" }}>
            <Sliders size={28} style={{ margin: "0 auto 8px auto", display: "block", opacity: 0.5 }} />
            <p style={{ margin: 0 }}>{tr("პარამეტრები ჯერ არ არის დამატებული.", "No parameters added to this study yet.")}</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="study-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>{tr("იდენტიფიკატორი", "Key")}</th>
                  <th>{tr("დასახელება", "Label")}</th>
                  <th style={{ width: 90 }}>{tr("ტიპი", "Kind")}</th>
                  <th style={{ width: 110 }}>{tr("როლი", "Role")}</th>
                  <th style={{ width: 80 }}>{tr("ერთეული", "Unit")}</th>
                  <th>{tr("სპეციფიკაცია (დიაპაზონი / განაწილება)", "Specification")}</th>
                  <th style={{ width: 60, textAlign: "right" }}>{tr("მოქმედება", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((p) => {
                  const s = p.spec as Record<string, unknown>;
                  let specSummary = "";
                  if (p.role === "dependent") {
                    const deps = (s.dependencies as string[]) || [];
                    specSummary = `f(${deps.join(", ")}) = ${s.expression ?? ""}`;
                    if (s.sample_value !== undefined && s.sample_value !== null) {
                      specSummary += ` · nominal: ${Number(s.sample_value).toFixed(2)}`;
                    }
                  } else if (p.kind === "continuous") {
                    specSummary = `[${s.min ?? "?"} .. ${s.max ?? "?"}] (${s.scale ?? "linear"})`;
                    if (s.levels) specSummary += ` · ${s.levels} levels`;
                    if (p.role === "fixed") specSummary = `Fixed: ${s.value}`;
                    if (p.role === "uncertain" && s.distribution) {
                      const d = s.distribution as Record<string, unknown>;
                      specSummary += ` · ~${d.type}`;
                    }
                  } else if (p.kind === "integer") {
                    specSummary = `[${s.min ?? "?"} .. ${s.max ?? "?"}] step ${s.step ?? 1}`;
                  } else if (p.kind === "categorical") {
                    const opts = (s.options as string[]) || [];
                    specSummary = opts.join(", ");
                  }

                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="variable-chip">
                          {p.key}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: "var(--ll-text-primary)" }}>{p.label}</td>
                      <td>
                        <span className="badge badge-generic">
                          {p.kind}
                        </span>
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background:
                              p.role === "controlled"
                                ? "var(--ll-emerald-soft)"
                                : p.role === "uncertain"
                                ? "var(--ll-amber-soft)"
                                : p.role === "dependent"
                                ? "rgba(139, 92, 246, 0.12)"
                                : "var(--ll-surface-hover)",
                            color:
                              p.role === "controlled"
                                ? "var(--ll-emerald-text)"
                                : p.role === "uncertain"
                                ? "var(--ll-amber-text)"
                                : p.role === "dependent"
                                ? "#7c3aed"
                                : "var(--ll-text-secondary)",
                            borderColor:
                              p.role === "controlled"
                                ? "var(--ll-emerald-border)"
                                : p.role === "uncertain"
                                ? "var(--ll-amber-border)"
                                : p.role === "dependent"
                                ? "rgba(139, 92, 246, 0.3)"
                                : "var(--ll-border)",
                            fontWeight: p.role === "dependent" ? 650 : 500,
                          }}
                        >
                          {p.role === "dependent" ? "f(x) dependent" : p.role}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--ll-font-mono)", color: "var(--ll-text-secondary)", fontSize: 11.5 }}>
                        {p.unit || "—"}
                      </td>
                      <td style={{ color: "var(--ll-text-primary)", fontSize: 12 }}>
                        {p.role === "dependent" || Boolean((s.expression as string)) ? (
                          <MathFormulaDisplay
                            expression={String(s.expression || "")}
                            studyParameters={parameters || []}
                            dependencies={(s.dependencies as string[]) || []}
                            paramKey={p.key}
                            showLhs={true}
                            nominalValue={s.sample_value !== undefined && s.sample_value !== null ? Number(s.sample_value) : null}
                            unit={p.unit}
                            size="sm"
                          />
                        ) : (
                          <span style={{ color: "var(--ll-text-secondary)", fontFamily: "var(--ll-font-mono)", fontSize: 11.5 }}>
                            {specSummary}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => handleDelete(p)}
                          style={{ color: "var(--ll-rose)", padding: 4 }}
                          title="Delete parameter"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Parameter Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: role === "dependent" ? 780 : 540, width: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {role === "dependent" ? (
                  <>
                    <span style={{ fontSize: 18, color: "#8b5cf6", fontWeight: 700 }}>∫</span>
                    <span>{tr("დამოკიდებული პარამეტრის დამატება (Symbolab)", "Add Dependent Parameter (Symbolab Builder)")}</span>
                  </>
                ) : (
                  <span>{tr("ახალი პარამეტრის დამატება", "Add Experimental Parameter")}</span>
                )}
              </h3>
              <button type="button" className="btn-ghost" onClick={() => setShowModal(false)} style={{ padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body" style={{ overflowY: "auto", flex: 1, padding: "16px 20px" }}>
                {formError && (
                  <div
                    style={{
                      padding: 10,
                      background: "var(--ll-rose-soft)",
                      border: "1px solid var(--ll-rose-border)",
                      borderRadius: "var(--ll-radius-md)",
                      color: "var(--ll-rose-text)",
                      fontSize: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 12,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{formError}</span>
                  </div>
                )}

                {/* 1. Large Visual Role Selector Segmented Control */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                  <label className="form-label" style={{ fontWeight: 700, margin: 0, fontSize: 12 }}>
                    {tr("პარამეტრის ტიპი / როლი (Role):", "Parameter Type / Role:")}
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                    {[
                      { id: "controlled" as const, label: "Controlled", desc: "DoE Factor", icon: "🎯" },
                      { id: "dependent" as const, label: "Dependent", desc: "Symbolab Math", icon: "∫" },
                      { id: "uncertain" as const, label: "Uncertain", desc: "Monte Carlo", icon: "🎲" },
                      { id: "fixed" as const, label: "Fixed", desc: "Constant", icon: "📌" },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setRole(item.id)}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          textAlign: "center",
                          padding: "8px 6px",
                          borderRadius: "var(--ll-radius-md)",
                          border: role === item.id
                            ? item.id === "dependent" ? "2px solid #8b5cf6" : "2px solid var(--ll-emerald)"
                            : "1px solid var(--ll-border)",
                          background: role === item.id
                            ? item.id === "dependent" ? "rgba(139, 92, 246, 0.12)" : "var(--ll-emerald-soft)"
                            : "var(--ll-surface)",
                          color: role === item.id
                            ? item.id === "dependent" ? "#7c3aed" : "var(--ll-emerald-text)"
                            : "var(--ll-text-primary)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          boxShadow: role === item.id ? "0 2px 4px rgba(0,0,0,0.06)" : "none",
                        }}
                      >
                        <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
                        <span style={{ fontSize: 11.5, fontWeight: role === item.id ? 700 : 600, marginTop: 4 }}>
                          {item.label}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--ll-text-muted)" }}>{item.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">{tr("იდენტიფიკატორი (Key)", "Key (Identifier)")}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. droplet, flow, w"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      required
                    />
                    {fieldErrors.key && <span className="form-error">{fieldErrors.key}</span>}
                  </div>

                  <div className="form-group">
                    <label className="form-label">{tr("დასახელება (Label)", "Label")}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Droplet Diameter"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
                  <div className="form-group">
                    <label className="form-label">{tr("ფიზიკური ერთეული", "Physical Unit")}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. um, Pa, L/min, mm, kg"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    />
                  </div>

                  {role !== "dependent" ? (
                    <div className="form-group">
                      <label className="form-label">{tr("ტიპი", "Kind")}</label>
                      <select className="form-select" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                        <option value="continuous">Continuous</option>
                        <option value="integer">Integer</option>
                        <option value="categorical">Categorical</option>
                      </select>
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label">{tr("ტიპი (მათემატიკური)", "Kind (Computed)")}</label>
                      <input
                        type="text"
                        className="form-input"
                        value="Continuous (Evaluated Function)"
                        disabled
                        style={{ opacity: 0.85, background: "var(--ll-surface-subtle)", fontWeight: 600, color: "#7c3aed" }}
                      />
                    </div>
                  )}
                </div>

                {role === "dependent" && (
                  <div style={{ marginTop: 12 }}>
                    <VisualMathBuilder
                      currentParamKey={key.trim()}
                      studyParameters={parameters || []}
                      expression={dependentExpr}
                      onChange={(expr, deps, sample) => {
                        setDependentExpr(expr);
                        setDependentDeps(deps);
                        setDependentSample(sample);
                      }}
                      unit={unit}
                    />
                  </div>
                )}

                {role !== "dependent" && kind === "continuous" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, background: "var(--ll-surface-subtle)", border: "1px solid var(--ll-border)", borderRadius: "var(--ll-radius-md)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">Min</label>
                        <input
                          type="number"
                          step="any"
                          className="form-input"
                          value={minVal}
                          onChange={(e) => setMinVal(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Max</label>
                        <input
                          type="number"
                          step="any"
                          className="form-input"
                          value={maxVal}
                          onChange={(e) => setMaxVal(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">{tr("სკალა", "Scale")}</label>
                        <select className="form-select" value={scale} onChange={(e) => setScale(e.target.value as any)}>
                          <option value="linear">Linear</option>
                          <option value="log">Logarithmic</option>
                        </select>
                      </div>

                      {role === "controlled" && (
                        <div className="form-group">
                          <label className="form-label">{tr("ბადის დონეები", "Grid Levels")}</label>
                          <input
                            type="number"
                            min="2"
                            max="100"
                            className="form-input"
                            value={levels}
                            onChange={(e) => setLevels(e.target.value)}
                          />
                        </div>
                      )}

                      {role === "fixed" && (
                        <div className="form-group">
                          <label className="form-label">{tr("ფიქსირებული მნიშვნელობა", "Fixed Value")}</label>
                          <input
                            type="number"
                            step="any"
                            className="form-input"
                            value={fixedVal}
                            onChange={(e) => setFixedVal(e.target.value)}
                            required
                          />
                        </div>
                      )}

                      {role === "uncertain" && (
                        <div className="form-group">
                          <label className="form-label">{tr("განაწილების ტიპი", "Distribution Type")}</label>
                          <select className="form-select" value={distType} onChange={(e) => setDistType(e.target.value as any)}>
                            <option value="normal">Normal (Gaussian)</option>
                            <option value="lognormal">Lognormal</option>
                            <option value="uniform">Uniform</option>
                            <option value="triangular">Triangular</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {role !== "dependent" && kind === "integer" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, background: "var(--ll-surface-subtle)", border: "1px solid var(--ll-border)", borderRadius: "var(--ll-radius-md)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">Min</label>
                        <input type="number" step="1" className="form-input" value={minVal} onChange={(e) => setMinVal(e.target.value)} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Max</label>
                        <input type="number" step="1" className="form-input" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Step</label>
                        <input type="number" step="1" min="1" className="form-input" value={stepVal} onChange={(e) => setStepVal(e.target.value)} required />
                      </div>
                    </div>
                  </div>
                )}

                {role !== "dependent" && kind === "categorical" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, background: "var(--ll-surface-subtle)", border: "1px solid var(--ll-border)", borderRadius: "var(--ll-radius-md)" }}>
                    <div className="form-group">
                      <label className="form-label">{tr("ვარიანტები (მძიმით გამოყოფილი)", "Options (comma-separated)")}</label>
                      <input type="text" className="form-input" value={optionsStr} onChange={(e) => setOptionsStr(e.target.value)} required />
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary">
                  {tr("დამატება", "Add Parameter")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
