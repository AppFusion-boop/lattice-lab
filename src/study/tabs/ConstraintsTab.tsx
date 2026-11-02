import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, X, ShieldAlert, Check, AlertTriangle, AlertCircle } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study, Constraint, ConstraintCreate, Parameter } from "../api/types";
import { tr } from "../../i18n";
import "../study.css";

interface ConstraintsTabProps {
  study: Study;
}

export function ConstraintsTab({ study }: ConstraintsTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [label, setLabel] = useState("");
  const [expression, setExpression] = useState("");
  const [kind, setKind] = useState<"hard" | "soft">("hard");
  const [penalty, setPenalty] = useState("1.0");
  const [rationale, setRationale] = useState("");

  // Live expression validation
  const [exprValid, setExprValid] = useState<boolean | null>(null);
  const [exprError, setExprError] = useState<string | null>(null);
  const [checkingExpr, setCheckingExpr] = useState(false);
  const exprInputRef = useRef<HTMLInputElement>(null);

  const {
    data: constraints,
    loading,
    refresh,
  } = useApi<Constraint[]>(`constraints-${study.id}`, () =>
    apiGet<Constraint[]>(`/studies/${study.id}/constraints`)
  );

  const { data: parameters } = useApi<Parameter[]>(`parameters-${study.id}`, () =>
    apiGet<Parameter[]>(`/studies/${study.id}/parameters`)
  );

  // Allowed candidate parameter keys for chip suggestions
  const candidateParams = parameters?.filter((p) => p.role === "controlled" || p.role === "fixed") || [];
  const allowedVarKeys = candidateParams.map((p) => p.key);

  // Debounced 300ms expression check
  useEffect(() => {
    if (!expression.trim()) {
      setExprValid(null);
      setExprError(null);
      setCheckingExpr(false);
      return;
    }

    setCheckingExpr(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiPost<{ ok: boolean; error?: string }>("/expressions/check", {
          expression: expression.trim(),
          variables: allowedVarKeys,
        });
        setExprValid(res.ok);
        setExprError(res.error || null);
      } catch (err) {
        setExprValid(false);
        setExprError((err as Error).message);
      } finally {
        setCheckingExpr(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [expression, allowedVarKeys.join(",")]);

  const resetForm = () => {
    setLabel("");
    setExpression("");
    setKind("hard");
    setPenalty("1.0");
    setRationale("");
    setExprValid(null);
    setExprError(null);
    setFormError(null);
  };

  const handleInsertChip = (key: string) => {
    if (exprInputRef.current) {
      const input = exprInputRef.current;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const before = expression.substring(0, start);
      const after = expression.substring(end);
      const newExpr = `${before}${key}${after}`;
      setExpression(newExpr);
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + key.length, start + key.length);
      }, 0);
    } else {
      setExpression((prev) => (prev ? `${prev} * ${key}` : key));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const payload: ConstraintCreate = {
      label: label.trim() || expression.trim(),
      expression: expression.trim(),
      kind,
      penalty: kind === "soft" ? parseFloat(penalty) || 1.0 : undefined,
      rationale: rationale.trim(),
      enabled: true,
    };

    try {
      await apiPost(`/studies/${study.id}/constraints`, payload);
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

  const handleToggleEnabled = async (constraint: Constraint) => {
    try {
      await apiPatch(`/studies/${study.id}/constraints/${constraint.id}`, {
        enabled: !constraint.enabled,
      });
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleDelete = async (constraint: Constraint) => {
    if (!confirm(tr(`ნამდვილად გსურთ '${constraint.label}' შეზღუდვის წაშლა?`, `Delete constraint '${constraint.label}'?`))) {
      return;
    }
    try {
      await apiDelete(`/studies/${study.id}/constraints/${constraint.id}`);
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
              <ShieldAlert size={16} color="var(--ll-rose)" />
              <span>{tr("კვლევის შეზღუდვები (Physical & Feasibility Constraints)", "Physical & Feasibility Constraints")}</span>
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ll-text-secondary)" }}>
              {tr(
                "ხისტი (100% მათემატიკური გამორიცხვა) და რბილი (დაჯარიმება) შეზღუდვები სავალდებულო მეცნიერული დასაბუთებით.",
                "Deterministic hard constraints (100% exclusion) and soft penalty rules with mandatory scientific rationales.",
              )}
            </p>
          </div>
          <button className="btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
            <Plus size={14} />
            <span>{tr("შეზღუდვის დამატება", "Add Constraint")}</span>
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--ll-text-muted)" }}>{tr("იტვირთება...", "Loading...")}</div>
        ) : !constraints || constraints.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--ll-text-muted)" }}>
            <ShieldAlert size={28} style={{ margin: "0 auto 8px auto", display: "block", opacity: 0.5 }} />
            <p style={{ margin: 0 }}>{tr("შეზღუდვები ჯერ არ არის დამატებული.", "No constraints defined for this study yet.")}</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="study-table">
              <thead>
                <tr>
                  <th style={{ width: 50, textAlign: "center" }}>{tr("აქტ.", "Act.")}</th>
                  <th>{tr("დასახელება", "Label")}</th>
                  <th>{tr("მათემატიკური ფორმულა", "Mathematical Expression")}</th>
                  <th style={{ width: 90 }}>{tr("ტიპი", "Kind")}</th>
                  <th>{tr("მეცნიერული დასაბუთება (Rationale)", "Scientific Rationale")}</th>
                  <th style={{ width: 60, textAlign: "right" }}>{tr("მოქმედება", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {constraints.map((c) => (
                  <tr key={c.id} style={{ opacity: c.enabled ? 1 : 0.55 }}>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        onChange={() => handleToggleEnabled(c)}
                        title={c.enabled ? "Active constraint" : "Disabled constraint"}
                        style={{ cursor: "pointer", accentColor: "var(--ll-emerald)" }}
                      />
                    </td>
                    <td style={{ fontWeight: 600, color: "var(--ll-text-primary)" }}>{c.label}</td>
                    <td>
                      <code
                        style={{
                          background: "var(--ll-emerald-soft)",
                          border: "1px solid var(--ll-emerald-border)",
                          color: "var(--ll-emerald-text)",
                          padding: "2px 8px",
                          borderRadius: "var(--ll-radius-sm)",
                          fontFamily: "var(--ll-font-mono)",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {c.expression}
                      </code>
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: c.kind === "hard" ? "var(--ll-rose-soft)" : "var(--ll-amber-soft)",
                          color: c.kind === "hard" ? "var(--ll-rose-text)" : "var(--ll-amber-text)",
                          borderColor: c.kind === "hard" ? "var(--ll-rose-border)" : "var(--ll-amber-border)",
                        }}
                      >
                        {c.kind}
                      </span>
                    </td>
                    <td style={{ color: "var(--ll-text-secondary)", fontSize: 12, lineHeight: 1.4 }}>
                      {c.rationale}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleDelete(c)}
                        style={{ color: "var(--ll-rose)", padding: 4 }}
                        title="Delete constraint"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Constraint Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("ახალი შეზღუდვის დამატება", "Add Physical Constraint")}</h3>
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

                <div className="form-group">
                  <label className="form-label">{tr("დასახელება (Label)", "Label")}</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Pump Maximum Flow, Lipinski Rule, Max Aspect Ratio"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="form-label">{tr("მათემატიკური ფორმულა (Expression)", "Mathematical Expression")}</label>
                    {checkingExpr ? (
                      <span style={{ fontSize: 11, color: "var(--ll-text-muted)" }}>{tr("მოწმდება...", "Checking...")}</span>
                    ) : exprValid === true ? (
                      <span style={{ fontSize: 11, color: "var(--ll-emerald-text)", display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
                        <Check size={12} /> {tr("ვალიდურია", "Valid")}
                      </span>
                    ) : exprValid === false ? (
                      <span style={{ fontSize: 11, color: "var(--ll-rose-text)", display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
                        <AlertTriangle size={12} /> {exprError}
                      </span>
                    ) : null}
                  </div>
                  <input
                    ref={exprInputRef}
                    type="text"
                    className="form-input"
                    style={{
                      fontFamily: "var(--ll-font-mono)",
                      borderColor: exprValid === true ? "var(--ll-emerald)" : exprValid === false ? "var(--ll-rose)" : undefined,
                    }}
                    placeholder="e.g. flow * nozzles <= 600, mw <= 500"
                    value={expression}
                    onChange={(e) => setExpression(e.target.value)}
                    required
                  />

                  {/* Parameter chips */}
                  {candidateParams.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 11, color: "var(--ll-text-muted)" }}>
                        {tr("დააწკაპუნეთ პარამეტრის ჩასასმელად:", "Insert parameter chip:")}
                      </div>
                      <div className="chips-row">
                        {candidateParams.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className="variable-chip"
                            onClick={() => handleInsertChip(p.key)}
                          >
                            + {p.key}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">{tr("შეზღუდვის ტიპი", "Constraint Kind")}</label>
                    <select className="form-select" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                      <option value="hard">{tr("ხისტი (Hard) — 100% გამორიცხვა", "Hard (100% Exclusion)")}</option>
                      <option value="soft">{tr("რბილი (Soft) — დაჯარიმება", "Soft (Penalty Weight)")}</option>
                    </select>
                  </div>

                  {kind === "soft" && (
                    <div className="form-group">
                      <label className="form-label">{tr("ჯარიმის წონა (Penalty)", "Penalty Weight")}</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className="form-input"
                        value={penalty}
                        onChange={(e) => setPenalty(e.target.value)}
                        required
                      />
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">
                    {tr("მეცნიერული დასაბუთება (Rationale — სავალდებულო)", "Scientific/Engineering Rationale (Mandatory)")}
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. Maximum pump flow rating in equipment datasheet is 600 L/min. Operating above this threshold causes pump cavitation and pipe rupture."
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    required
                    minLength={3}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={exprValid === false}>
                  {tr("შექმნა", "Create Constraint")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
