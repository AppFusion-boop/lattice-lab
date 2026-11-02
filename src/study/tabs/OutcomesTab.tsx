import { useState } from "react";
import { Plus, Trash2, X, Target, Info, AlertCircle } from "lucide-react";
import { apiGet, apiPost, apiDelete, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study, Outcome, OutcomeCreate } from "../api/types";
import { tr } from "../../i18n";
import "../study.css";

interface OutcomesTabProps {
  study: Study;
}

export function OutcomesTab({ study }: OutcomesTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [direction, setDirection] = useState<"minimize" | "maximize" | "none">("minimize");
  const [hasCriterion, setHasCriterion] = useState(true);
  const [op, setOp] = useState<"<" | "<=" | ">" | ">=" | "between" | "equals">("<");
  const [criterionVal, setCriterionVal] = useState("8000");
  const [criterionLow, setCriterionLow] = useState("0");
  const [criterionHigh, setCriterionHigh] = useState("100");

  const {
    data: outcomes,
    loading,
    refresh,
  } = useApi<Outcome[]>(`outcomes-${study.id}`, () =>
    apiGet<Outcome[]>(`/studies/${study.id}/outcomes`)
  );

  const resetForm = () => {
    setKey("");
    setLabel("");
    setUnit("");
    setDirection("minimize");
    setHasCriterion(true);
    setOp("<");
    setCriterionVal("8000");
    setCriterionLow("0");
    setCriterionHigh("100");
    setFormError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let criterion: Record<string, unknown> | null = null;
    if (hasCriterion) {
      if (op === "between") {
        criterion = {
          op: "between",
          low: parseFloat(criterionLow),
          high: parseFloat(criterionHigh),
        };
      } else if (op === "equals") {
        criterion = {
          op: "equals",
          value: parseFloat(criterionVal),
        };
      } else {
        criterion = {
          op,
          value: parseFloat(criterionVal),
        };
      }
    }

    const isBinary = hasCriterion && op === "equals" && (criterionVal === "0" || criterionVal === "1");

    const payload: OutcomeCreate = {
      key: key.trim(),
      label: label.trim() || key.trim(),
      unit: unit.trim(),
      kind: isBinary ? "binary" : "continuous",
      direction,
      criterion: criterion as any,
    };

    try {
      await apiPost(`/studies/${study.id}/outcomes`, payload);
      setShowModal(false);
      resetForm();
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError((err as Error).message);
      }
    }
  };

  const handleDelete = async (outcome: Outcome) => {
    if (!confirm(tr(`ნამდვილად გსურთ '${outcome.label}' შედეგის წაშლა?`, `Delete outcome '${outcome.label}'?`))) {
      return;
    }
    try {
      await apiDelete(`/studies/${study.id}/outcomes/${outcome.id}`);
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
              <Target size={16} color="var(--ll-blue)" />
              <span>{tr("კვლევის შედეგები (Measured Experimental Outcomes)", "Measured Experimental Outcomes")}</span>
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ll-text-secondary)" }}>
              {tr(
                "გაზომვადი სიდიდეები, ოპტიმიზაციის მიმართულება და წარმატების ზღვრული კრიტერიუმები.",
                "Quantitative response variables, Pareto optimization objectives, and success criteria thresholds.",
              )}
            </p>
          </div>
          <button className="btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
            <Plus size={14} />
            <span>{tr("შედეგის დამატება", "Add Outcome")}</span>
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--ll-text-muted)" }}>{tr("იტვირთება...", "Loading...")}</div>
        ) : !outcomes || outcomes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--ll-text-muted)" }}>
            <Target size={28} style={{ margin: "0 auto 8px auto", display: "block", opacity: 0.5 }} />
            <p style={{ margin: 0 }}>{tr("შედეგები ჯერ არ არის დამატებული.", "No outcomes defined for this study yet.")}</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="study-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>{tr("იდენტიფიკატორი", "Key")}</th>
                  <th>{tr("დასახელება", "Label")}</th>
                  <th style={{ width: 90 }}>{tr("ერთეული", "Unit")}</th>
                  <th style={{ width: 110 }}>{tr("მიზანი", "Objective")}</th>
                  <th>{tr("წარმატების კრიტერიუმი (Threshold)", "Success Criterion")}</th>
                  <th style={{ width: 60, textAlign: "right" }}>{tr("მოქმედება", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => {
                  const c = o.criterion as Record<string, unknown> | null;
                  let critStr = "Informational only";
                  if (c) {
                    if (c.op === "between") {
                      critStr = `between [${c.low}, ${c.high}]`;
                    } else if (c.op === "equals") {
                      critStr = `== ${c.value}`;
                    } else {
                      critStr = `${c.op} ${c.value}`;
                    }
                  }

                  return (
                    <tr key={o.id}>
                      <td>
                        <span className="variable-chip">
                          {o.key}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: "var(--ll-text-primary)" }}>{o.label}</td>
                      <td style={{ fontFamily: "var(--ll-font-mono)", color: "var(--ll-text-secondary)", fontSize: 11.5 }}>
                        {o.unit || "—"}
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background: o.direction === "minimize" ? "var(--ll-blue-soft)" : o.direction === "maximize" ? "var(--ll-emerald-soft)" : "var(--ll-surface-hover)",
                            color: o.direction === "minimize" ? "var(--ll-blue-text)" : o.direction === "maximize" ? "var(--ll-emerald-text)" : "var(--ll-text-secondary)",
                            borderColor: o.direction === "minimize" ? "var(--ll-blue-border)" : o.direction === "maximize" ? "var(--ll-emerald-border)" : "var(--ll-border)",
                          }}
                        >
                          {o.direction}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontFamily: "var(--ll-font-mono)",
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: c ? "var(--ll-emerald-text)" : "var(--ll-text-muted)",
                            background: c ? "var(--ll-emerald-soft)" : "transparent",
                            padding: c ? "2px 6px" : 0,
                            borderRadius: "var(--ll-radius-sm)",
                          }}
                        >
                          {critStr}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => handleDelete(o)}
                          style={{ color: "var(--ll-rose)", padding: 4 }}
                          title="Delete outcome"
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

      {/* Add Outcome Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("ახალი შედეგის დამატება", "Add Measured Outcome")}</h3>
              <button type="button" className="btn-ghost" onClick={() => setShowModal(false)} style={{ padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="modal-body">
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
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{formError}</span>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">{tr("იდენტიფიკატორი (Key)", "Key (Identifier)")}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. peak_pressure, t_junction, fc"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{tr("დასახელება (Label)", "Label")}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Peak Overpressure"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">{tr("ფიზიკური ერთეული", "Physical Unit")}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Pa, kPa, degC, MPa, %"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{tr("მიზანი (Optimization)", "Objective Direction")}</label>
                    <select className="form-select" value={direction} onChange={(e) => setDirection(e.target.value as any)}>
                      <option value="minimize">{tr("მინიმიზაცია (Minimize)", "Minimize")}</option>
                      <option value="maximize">{tr("მაქსიმიზაცია (Maximize)", "Maximize")}</option>
                      <option value="none">{tr("მხოლოდ ინფორმაციული (None)", "None / Informational Only")}</option>
                    </select>
                  </div>
                </div>

                {/* Criterion section */}
                <div style={{ padding: 12, background: "var(--ll-surface-subtle)", borderRadius: "var(--ll-radius-md)", border: "1px solid var(--ll-border)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={hasCriterion}
                      onChange={(e) => setHasCriterion(e.target.checked)}
                    />
                    <span>{tr("განსაზღვრეთ წარმატების კრიტერიუმი (Threshold)", "Define Success Criterion Threshold")}</span>
                  </label>

                  {hasCriterion && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">{tr("ოპერატორი", "Operator")}</label>
                        <select className="form-select" value={op} onChange={(e) => setOp(e.target.value as any)}>
                          <option value="<">&lt; Less than</option>
                          <option value="<=">&le; Less than or equal</option>
                          <option value=">">&gt; Greater than</option>
                          <option value=">=">&ge; Greater than or equal</option>
                          <option value="between">between [low, high]</option>
                          <option value="equals">== Equals (binary 0/1)</option>
                        </select>
                      </div>

                      {op === "between" ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div className="form-group">
                            <label className="form-label">Low</label>
                            <input type="number" step="any" className="form-input" value={criterionLow} onChange={(e) => setCriterionLow(e.target.value)} required />
                          </div>
                          <div className="form-group">
                            <label className="form-label">High</label>
                            <input type="number" step="any" className="form-input" value={criterionHigh} onChange={(e) => setCriterionHigh(e.target.value)} required />
                          </div>
                        </div>
                      ) : (
                        <div className="form-group">
                          <label className="form-label">{tr("ზღვრული მნიშვნელობა", "Threshold Value")}</label>
                          <input type="number" step="any" className="form-input" value={criterionVal} onChange={(e) => setCriterionVal(e.target.value)} required />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary">
                  {tr("შექმნა", "Create Outcome")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
