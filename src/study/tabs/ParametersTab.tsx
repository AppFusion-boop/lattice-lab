import { useState } from "react";
import { Plus, Trash2, X, Sliders, AlertCircle, Activity } from "lucide-react";
import { apiGet, apiPost, apiDelete, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import type { Study, Parameter, ParameterCreate, Outcome } from "../api/types";
import { tr } from "../../i18n";
import { TornadoChart } from "../components/TornadoChart";

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
  const [role, setRole] = useState<"controlled" | "uncertain" | "fixed">("controlled");

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

    if (kind === "continuous") {
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
        } else if (distType === "normal") {
          spec.distribution = {
            type: "normal",
            mean: distMean ? parseFloat(distMean) : (minNum + maxNum) / 2,
            sd: distSd ? parseFloat(distSd) : (maxNum - minNum) / 6,
          };
        }
      }
    } else if (kind === "integer") {
      const minNum = parseInt(minVal, 10);
      const maxNum = parseInt(maxVal, 10);
      spec = {
        min: minNum,
        max: maxNum,
        step: parseInt(stepVal, 10) || 1,
        levels: levels ? parseInt(levels, 10) : undefined,
      };
      if (role === "fixed") {
        spec.value = fixedVal ? parseInt(fixedVal, 10) : minNum;
      }
    } else if (kind === "categorical") {
      const opts = optionsStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      spec = {
        options: opts,
        value: role === "fixed" ? fixedVal || opts[0] : undefined,
      };
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
      await apiDelete(`/parameters/${param.id}`);
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div>
      <div className="study-card">
        <div className="study-card-header">
          <div>
            <h4 className="study-card-title">{tr("კვლევის პარამეტრების სივრცე", "Study Parameter Space")}</h4>
            <p style={{ margin: "4px 0 0 0", color: "#586b62", fontSize: 12 }}>
              {tr(
                "მართვადი (Controlled) პარამეტრები ქმნიან საკვლევ ვარიაციებს. განუსაზღვრელი (Uncertain) პარამეტრები მოდელირდება მონტე-კარლო განაწილებებით.",
                "Controlled parameters define candidates. Uncertain parameters vary via probability distributions. Fixed parameters remain invariant."
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn-secondary"
              onClick={() => setShowTornado(!showTornado)}
              title={tr("სობოლის მგრძნობელობის ანალიზი", "Sobol Global Sensitivity Analysis")}
            >
              <Activity size={14} />
              <span>
                {showTornado
                  ? tr("ტორნადოს დახურვა", "Hide Tornado")
                  : tr("მგრძნობელობის ანალიზი (Tornado)", "Sensitivity Ranking (Tornado)")}
              </span>
            </button>
            <button className="btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
              <Plus size={14} />
              <span>{tr("პარამეტრის დამატება", "Add Parameter")}</span>
            </button>
          </div>
        </div>

        {showTornado && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
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
          <div style={{ padding: 24, textAlign: "center", color: "#84938b" }}>{tr("იტვირთება...", "Loading...")}</div>
        ) : !parameters || parameters.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "#84938b" }}>
            <Sliders size={28} style={{ margin: "0 auto 8px auto", display: "block", opacity: 0.6 }} />
            <p>{tr("პარამეტრები ჯერ არ არის დამატებული.", "No parameters added to this study yet.")}</p>
          </div>
        ) : (
          <table className="study-table">
            <thead>
              <tr>
                <th>{tr("იდენტიფიკატორი", "Key")}</th>
                <th>{tr("დასახელება", "Label")}</th>
                <th>{tr("ტიპი", "Kind")}</th>
                <th>{tr("როლი", "Role")}</th>
                <th>{tr("ერთეული", "Unit")}</th>
                <th>{tr("სპეციფიკაცია (დიაპაზონი / მნიშვნელობები)", "Specification")}</th>
                <th style={{ width: 60, textAlign: "right" }}>{tr("მოქმედება", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {parameters.map((p) => {
                const s = p.spec as Record<string, unknown>;
                let specSummary = "";
                if (p.kind === "continuous") {
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
                      <code style={{ background: "#eef5f1", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--mono)" }}>
                        {p.key}
                      </code>
                    </td>
                    <td style={{ fontWeight: 550 }}>{p.label}</td>
                    <td>
                      <span className="badge" style={{ background: "#f1f5f9", color: "#475569" }}>
                        {p.kind}
                      </span>
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background:
                            p.role === "controlled" ? "#dcfce7" : p.role === "uncertain" ? "#fef3c7" : "#e2e8f0",
                          color:
                            p.role === "controlled" ? "#15803d" : p.role === "uncertain" ? "#92400e" : "#475569",
                        }}
                      >
                        {p.role}
                      </span>
                    </td>
                    <td>{p.unit || "—"}</td>
                    <td style={{ color: "#475569", fontSize: 11, fontFamily: "var(--mono)" }}>{specSummary}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        onClick={() => handleDelete(p)}
                        style={{ color: "#991b1b", padding: 4, borderRadius: 4 }}
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
        )}
      </div>

      {/* Add Parameter Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("ახალი პარამეტრის დამატება", "Add New Parameter")}</h3>
              <button onClick={() => setShowModal(false)} style={{ color: "#64748b" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="modal-body">
                {formError && (
                  <div
                    style={{
                      padding: 10,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 6,
                      color: "#991b1b",
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
                      placeholder="e.g. droplet, flow, mw"
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
                      required
                    />
                    {fieldErrors.label && <span className="form-error">{fieldErrors.label}</span>}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">{tr("ფიზიკური ერთეული", "Physical Unit")}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. um, L/min, degC, Pa"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    />
                    {fieldErrors.unit && <span className="form-error">{fieldErrors.unit}</span>}
                  </div>

                  <div className="form-group">
                    <label className="form-label">{tr("მონაცემთა ტიპი", "Kind")}</label>
                    <select className="form-select" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                      <option value="continuous">{tr("უწყვეტი (Continuous)", "Continuous")}</option>
                      <option value="integer">{tr("მთელი (Integer)", "Integer")}</option>
                      <option value="categorical">{tr("კატეგორიული (Categorical)", "Categorical")}</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{tr("როლი კვლევაში", "Role")}</label>
                    <select className="form-select" value={role} onChange={(e) => setRole(e.target.value as any)}>
                      <option value="controlled">{tr("მართვადი (Controlled)", "Controlled")}</option>
                      <option value="uncertain">{tr("განუსაზღვრელი (Uncertain)", "Uncertain")}</option>
                      <option value="fixed">{tr("ფიქსირებული (Fixed)", "Fixed")}</option>
                    </select>
                  </div>
                </div>

                {/* Kind Specific Specification */}
                {kind === "continuous" && (
                  <div style={{ padding: 12, background: "#f8faf8", borderRadius: 6, border: "1px solid var(--line)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">Min</label>
                        <input type="number" step="any" className="form-input" value={minVal} onChange={(e) => setMinVal(e.target.value)} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Max</label>
                        <input type="number" step="any" className="form-input" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{tr("მასშტაბი", "Scale")}</label>
                        <select className="form-select" value={scale} onChange={(e) => setScale(e.target.value as any)}>
                          <option value="linear">Linear</option>
                          <option value="log">Logarithmic</option>
                        </select>
                      </div>
                    </div>

                    {role === "controlled" && (
                      <div className="form-group" style={{ marginTop: 10 }}>
                        <label className="form-label">{tr("დონეების რაოდენობა ბადისთვის (Levels)", "Grid Levels")}</label>
                        <input type="number" min="2" max="100" className="form-input" value={levels} onChange={(e) => setLevels(e.target.value)} />
                      </div>
                    )}

                    {role === "fixed" && (
                      <div className="form-group" style={{ marginTop: 10 }}>
                        <label className="form-label">{tr("ფიქსირებული მნიშვნელობა", "Fixed Value")}</label>
                        <input type="number" step="any" className="form-input" value={fixedVal} onChange={(e) => setFixedVal(e.target.value)} required />
                      </div>
                    )}

                    {role === "uncertain" && (
                      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        <div className="form-group">
                          <label className="form-label">{tr("განაწილება", "Distribution")}</label>
                          <select className="form-select" value={distType} onChange={(e) => setDistType(e.target.value as any)}>
                            <option value="normal">Normal</option>
                            <option value="uniform">Uniform</option>
                          </select>
                        </div>
                        {distType === "normal" && (
                          <>
                            <div className="form-group">
                              <label className="form-label">Mean (μ)</label>
                              <input type="number" step="any" className="form-input" value={distMean} onChange={(e) => setDistMean(e.target.value)} placeholder="Auto" />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Std Dev (σ)</label>
                              <input type="number" step="any" className="form-input" value={distSd} onChange={(e) => setDistSd(e.target.value)} placeholder="Auto" />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {kind === "integer" && (
                  <div style={{ padding: 12, background: "#f8faf8", borderRadius: 6, border: "1px solid var(--line)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">Min</label>
                        <input type="number" className="form-input" value={minVal} onChange={(e) => setMinVal(e.target.value)} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Max</label>
                        <input type="number" className="form-input" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Step</label>
                        <input type="number" min="1" className="form-input" value={stepVal} onChange={(e) => setStepVal(e.target.value)} required />
                      </div>
                    </div>
                  </div>
                )}

                {kind === "categorical" && (
                  <div className="form-group">
                    <label className="form-label">{tr("ვარიანტები (მძიმით გამოყოფილი)", "Options (comma-separated)")}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={optionsStr}
                      onChange={(e) => setOptionsStr(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary">
                  {tr("შექმნა", "Create Parameter")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
