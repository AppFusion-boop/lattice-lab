import { useState, useEffect } from "react";
import { X, Check, AlertCircle, Loader2, Workflow, Link2 } from "lucide-react";
import type { Project } from "../../core/types";
import { nodeDefinition } from "../../core/registry";
import { apiGet, apiPost } from "../api/client";
import type {
  Study,
  Parameter,
  Outcome,
  ModelVersion,
  ModelVersionCreate,
  ParameterBindingModel,
  OutcomeBindingModel,
} from "../api/types";
import { tr } from "../../i18n";
import "./BindingDialog.css";

interface BindingDialogProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  defaultStudyId?: string;
  onSuccess?: (mv: ModelVersion) => void;
}

const REDUCERS: Array<{
  value: OutcomeBindingModel["reducer"];
  label: string;
}> = [
  { value: "maxAbs", label: "Peak (maxAbs) — absolute maximum" },
  { value: "max", label: "Maximum (max)" },
  { value: "min", label: "Minimum (min)" },
  { value: "mean", label: "Mean (average)" },
  { value: "rms", label: "RMS (root mean square)" },
  { value: "final", label: "Final sample" },
  { value: "value", label: "Scalar / boolean value" },
  { value: "crossed", label: "Crossed threshold (binary 0/1)" },
  { value: "timeAbove", label: "Time above threshold (seconds)" },
];

export function BindingDialog({
  project,
  isOpen,
  onClose,
  defaultStudyId,
  onSuccess,
}: BindingDialogProps) {
  const [studies, setStudies] = useState<Study[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string>(
    defaultStudyId || "",
  );
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [paramBindings, setParamBindings] = useState<
    Record<string, { nodeId: string; paramKey: string; notInModel: boolean }>
  >({});
  const [outcomeBindings, setOutcomeBindings] = useState<
    Record<
      string,
      {
        nodeId: string;
        port: string;
        reducer: OutcomeBindingModel["reducer"];
        threshold?: number;
      }
    >
  >({});
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1. Fetch available studies
  useEffect(() => {
    if (!isOpen) return;
    apiGet<Study[]>("/studies")
      .then((list) => {
        const active = list.filter((s) => !s.archived);
        setStudies(active);
        if (!selectedStudyId && active.length > 0) {
          setSelectedStudyId(defaultStudyId || active[0].id);
        }
      })
      .catch((err) => setErrorMsg(err.message));
  }, [isOpen, defaultStudyId]);

  // 2. Fetch parameters and outcomes when selected study changes
  useEffect(() => {
    if (!selectedStudyId) return;
    setErrorMsg(null);
    Promise.all([
      apiGet<Parameter[]>(`/studies/${selectedStudyId}/parameters`),
      apiGet<Outcome[]>(`/studies/${selectedStudyId}/outcomes`),
    ])
      .then(([params, outs]) => {
        setParameters(params);
        setOutcomes(outs);

        // Auto-match parameter bindings by key
        const initialPBs: Record<
          string,
          { nodeId: string; paramKey: string; notInModel: boolean }
        > = {};
        for (const p of params) {
          let matched = false;
          for (const node of project.nodes) {
            const def = nodeDefinition(node, project);
            const field = def?.fields.find(
              (f) =>
                f.key === p.key ||
                f.key.toLowerCase() === p.key.toLowerCase() ||
                f.label.toLowerCase().includes(p.key.toLowerCase()),
            );
            if (field) {
              initialPBs[p.key] = {
                nodeId: node.id,
                paramKey: field.key,
                notInModel: false,
              };
              matched = true;
              break;
            }
          }
          if (!matched) {
            initialPBs[p.key] = {
              nodeId: project.nodes[0]?.id || "",
              paramKey: "",
              notInModel: p.role === "uncertain" ? false : false,
            };
          }
        }
        setParamBindings(initialPBs);

        // Auto-match outcome bindings
        const initialOBs: Record<
          string,
          {
            nodeId: string;
            port: string;
            reducer: OutcomeBindingModel["reducer"];
            threshold?: number;
          }
        > = {};
        for (const o of outs) {
          let matchedNodeId = "";
          let matchedPort = "";
          for (const node of project.nodes) {
            const def = nodeDefinition(node, project);
            const port = def?.outputs.find(
              (p) =>
                p.id.toLowerCase().includes(o.key.toLowerCase()) ||
                p.id.startsWith("sensor:") ||
                p.id === "result" ||
                p.id === "peak",
            );
            if (port) {
              matchedNodeId = node.id;
              matchedPort = port.id;
              break;
            }
          }
          initialOBs[o.key] = {
            nodeId: matchedNodeId || project.nodes[0]?.id || "",
            port: matchedPort || "result",
            reducer: "maxAbs",
            threshold:
              typeof o.criterion?.value === "number"
                ? o.criterion.value
                : 0,
          };
        }
        setOutcomeBindings(initialOBs);
      })
      .catch((err) => setErrorMsg(err.message));
  }, [selectedStudyId, project]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setErrorMsg(null);
    setSubmitting(true);

    try {
      // Build parameter bindings
      const pbs: ParameterBindingModel[] = parameters.map((p) => {
        const state = paramBindings[p.key];
        if (state?.notInModel) {
          return {
            parameter_key: p.key,
            not_in_model: true,
          };
        }
        return {
          parameter_key: p.key,
          node_id: state?.nodeId,
          param_key: state?.paramKey,
          not_in_model: false,
        };
      });

      // Build outcome bindings
      const obs: OutcomeBindingModel[] = outcomes.map((o) => {
        const state = outcomeBindings[o.key];
        return {
          outcome_key: o.key,
          node_id: state?.nodeId || "",
          port: state?.port || "",
          reducer: state?.reducer || "maxAbs",
          threshold: state?.threshold ?? 0,
        };
      });

      const payload: ModelVersionCreate = {
        project: project as any,
        parameter_bindings: pbs,
        outcome_bindings: obs,
        notes:
          notes ||
          `Flow model with ${project.nodes.length} nodes and ${project.edges.length} wires`,
      };

      const res = await apiPost<ModelVersion>(
        `/studies/${selectedStudyId}/models`,
        payload,
      );
      onSuccess?.(res);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="binding-modal-backdrop" onClick={onClose}>
      <div
        className="binding-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="binding-modal-title"
      >
        <div className="binding-modal-header">
          <div className="binding-modal-title-wrap">
            <Link2 size={18} className="binding-modal-icon" />
            <h3 id="binding-modal-title">
              {tr(
                "ფლოუს კვლევასთან დაკავშირება (Model Version)",
                "Link Flow to Study (Model Version)",
              )}
            </h3>
          </div>
          <button
            className="binding-close-btn"
            onClick={onClose}
            aria-label="დახურვა"
          >
            <X size={16} />
          </button>
        </div>

        <div className="binding-modal-body">
          {errorMsg && (
            <div className="binding-error-banner">
              <AlertCircle size={15} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Study Selector */}
          <div className="binding-section">
            <label className="binding-label">
              {tr("სამიზნე კვლევა (Target Study):", "Target Study:")}
            </label>
            <select
              className="binding-select"
              value={selectedStudyId}
              onChange={(e) => setSelectedStudyId(e.target.value)}
              disabled={submitting}
            >
              {studies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.domain})
                </option>
              ))}
            </select>
          </div>

          {/* Parameter Bindings */}
          <div className="binding-section">
            <h4 className="binding-section-title">
              {tr(
                "1. პარამეტრების დაკავშირება (Input Parameters)",
                "1. Input Parameter Bindings",
              )}
            </h4>
            <p className="binding-hint">
              {tr(
                "ყველა კონტროლირებადი და გაურკვეველი პარამეტრი უნდა დაუკავშირდეს ფლოუს ნოუდის ველს ან მონიშნოს 'არ არის მოდელში'.",
                "Every controlled and uncertain parameter must bind to a node field or be marked 'not in model'.",
              )}
            </p>

            {parameters.length === 0 ? (
              <p className="binding-empty">
                {tr(
                  "კვლევას არ აქვს განსაზღვრული პარამეტრები.",
                  "No parameters defined in this study.",
                )}
              </p>
            ) : (
              <div className="binding-table-wrap">
                <table className="binding-table">
                  <thead>
                    <tr>
                      <th>{tr("პარამეტრი", "Parameter")}</th>
                      <th>{tr("როლი", "Role")}</th>
                      <th>{tr("მოდელის ნოუდი (Node)", "Flow Node")}</th>
                      <th>{tr("ნოუდის ველი (Field)", "Node Field")}</th>
                      <th>{tr("გამოტოვება", "Ignore")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parameters.map((p) => {
                      const state = paramBindings[p.key] || {
                        nodeId: "",
                        paramKey: "",
                        notInModel: false,
                      };
                      const selectedNode = project.nodes.find(
                        (n) => n.id === state.nodeId,
                      );
                      const def = selectedNode
                        ? nodeDefinition(selectedNode, project)
                        : null;
                      const fields = def?.fields || [];

                      return (
                        <tr
                          key={p.key}
                          className={state.notInModel ? "row-ignored" : ""}
                        >
                          <td>
                            <strong>{p.key}</strong>
                            <div className="binding-subtext">{p.label}</div>
                          </td>
                          <td>
                            <span className={`badge badge-role-${p.role}`}>
                              {p.role}
                            </span>
                          </td>
                          <td>
                            <select
                              className="binding-cell-select"
                              disabled={state.notInModel || submitting}
                              value={state.nodeId}
                              onChange={(e) => {
                                const newNodeId = e.target.value;
                                const n = project.nodes.find(
                                  (x) => x.id === newNodeId,
                                );
                                const d = n
                                  ? nodeDefinition(n, project)
                                  : null;
                                const f = d?.fields[0]?.key || "";
                                setParamBindings((prev) => ({
                                  ...prev,
                                  [p.key]: {
                                    ...prev[p.key],
                                    nodeId: newNodeId,
                                    paramKey: f,
                                  },
                                }));
                              }}
                            >
                              {project.nodes.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.label} ({n.id})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="binding-cell-select"
                              disabled={state.notInModel || submitting}
                              value={state.paramKey}
                              onChange={(e) =>
                                setParamBindings((prev) => ({
                                  ...prev,
                                  [p.key]: {
                                    ...prev[p.key],
                                    paramKey: e.target.value,
                                  },
                                }))
                              }
                            >
                              {fields.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label} ({f.key})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <label className="binding-checkbox-label">
                              <input
                                type="checkbox"
                                checked={state.notInModel}
                                onChange={(e) =>
                                  setParamBindings((prev) => ({
                                    ...prev,
                                    [p.key]: {
                                      ...prev[p.key],
                                      notInModel: e.target.checked,
                                    },
                                  }))
                                }
                                disabled={submitting}
                              />
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Outcome Bindings */}
          <div className="binding-section">
            <h4 className="binding-section-title">
              {tr(
                "2. შედეგების გამოთვლა (Outcome Bindings & Reducers)",
                "2. Outcome Bindings & Reducers",
              )}
            </h4>
            <p className="binding-hint">
              {tr(
                "დააკავშირეთ თითოეული შედეგი ფლოუს გამომავალ პორტთან და აირჩიეთ რედუქტორი (მაგ. პიკური წნევა, საშუალო მნიშვნელობა).",
                "Map each study outcome to an output port and choose a statistical reducer (e.g. peak, mean, final).",
              )}
            </p>

            {outcomes.length === 0 ? (
              <p className="binding-empty">
                {tr(
                  "კვლევას არ აქვს განსაზღვრული შედეგები.",
                  "No outcomes defined in this study.",
                )}
              </p>
            ) : (
              <div className="binding-table-wrap">
                <table className="binding-table">
                  <thead>
                    <tr>
                      <th>{tr("შედეგი", "Outcome")}</th>
                      <th>{tr("მოდელის ნოუდი", "Flow Node")}</th>
                      <th>{tr("გამომავალი პორტი", "Output Port")}</th>
                      <th>{tr("რედუქტორი", "Reducer")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcomes.map((o) => {
                      const state = outcomeBindings[o.key] || {
                        nodeId: "",
                        port: "",
                        reducer: "maxAbs",
                      };
                      const selectedNode = project.nodes.find(
                        (n) => n.id === state.nodeId,
                      );
                      const def = selectedNode
                        ? nodeDefinition(selectedNode, project)
                        : null;
                      const ports = def?.outputs || [];

                      return (
                        <tr key={o.key}>
                          <td>
                            <strong>{o.key}</strong>
                            <div className="binding-subtext">{o.label}</div>
                          </td>
                          <td>
                            <select
                              className="binding-cell-select"
                              value={state.nodeId}
                              disabled={submitting}
                              onChange={(e) => {
                                const newNodeId = e.target.value;
                                const n = project.nodes.find(
                                  (x) => x.id === newNodeId,
                                );
                                const d = n
                                  ? nodeDefinition(n, project)
                                  : null;
                                const p = d?.outputs[0]?.id || "";
                                setOutcomeBindings((prev) => ({
                                  ...prev,
                                  [o.key]: {
                                    ...prev[o.key],
                                    nodeId: newNodeId,
                                    port: p,
                                  },
                                }));
                              }}
                            >
                              {project.nodes.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.label} ({n.id})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="binding-cell-select"
                              value={state.port}
                              disabled={submitting}
                              onChange={(e) =>
                                setOutcomeBindings((prev) => ({
                                  ...prev,
                                  [o.key]: {
                                    ...prev[o.key],
                                    port: e.target.value,
                                  },
                                }))
                              }
                            >
                              {ports.map((port) => (
                                <option key={port.id} value={port.id}>
                                  {port.label} ({port.id})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="binding-cell-select"
                              value={state.reducer}
                              disabled={submitting}
                              onChange={(e) =>
                                setOutcomeBindings((prev) => ({
                                  ...prev,
                                  [o.key]: {
                                    ...prev[o.key],
                                    reducer: e.target
                                      .value as OutcomeBindingModel["reducer"],
                                  },
                                }))
                              }
                            >
                              {REDUCERS.map((r) => (
                                <option key={r.value} value={r.value}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="binding-section">
            <label className="binding-label">
              {tr("მოდელის აღწერა / შენიშვნა:", "Model Notes / Version Description:")}
            </label>
            <input
              type="text"
              className="binding-input"
              value={notes}
              placeholder={tr(
                "მაგ. წყლის ნისლის 45% შემცირების საწყისი ფლოუ მოდელი",
                "e.g. Tunnel water mist simulation model with acoustic sensors",
              )}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="binding-modal-footer">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            {tr("გაუქმება", "Cancel")}
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !selectedStudyId}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>{tr("მოწმდება და იწერება...", "Verifying & Saving...")}</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>
                  {tr(
                    "მოდელის ვერსიის შენახვა",
                    "Save & Verify Model Version",
                  )}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
