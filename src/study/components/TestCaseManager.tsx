import React, { useState } from "react";
import {
  Play,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Sparkles,
  Sliders,
  Target,
  Workflow,
  Copy,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Check,
} from "lucide-react";
import type { Study, Parameter, Outcome, ModelVersion, TestCase, TestCaseCategory, TestCaseRunResult } from "../api/types";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";
import { useApi } from "../api/hooks";
import { tr } from "../../i18n";
import { TestCaseModal } from "./TestCaseModal";

interface TestCaseManagerProps {
  study: Study;
  parameters: Parameter[];
  outcomes: Outcome[];
  latestModel: ModelVersion | null;
  onLoadIntoSim?: (params: Record<string, any>) => void;
}

export function TestCaseManager({
  study,
  parameters,
  outcomes,
  latestModel,
  onLoadIntoSim,
}: TestCaseManagerProps) {
  const {
    data: testCases,
    loading,
    error,
    refresh,
  } = useApi<TestCase[]>(`test-cases-${study.id}`, () =>
    apiGet<TestCase[]>(`/studies/${study.id}/test-cases`)
  );

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [runningAll, setRunningAll] = useState<boolean>(false);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingTestCase, setEditingTestCase] = useState<TestCase | null>(null);
  const [loadedParamsNotice, setLoadedParamsNotice] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRunSingle = async (tc: TestCase) => {
    setRunningIds((prev) => ({ ...prev, [tc.id]: true }));
    try {
      await apiPost<TestCaseRunResult>(`/studies/${study.id}/test-cases/${tc.id}/run`);
      await refresh();
      setExpandedIds((prev) => ({ ...prev, [tc.id]: true }));
    } catch (err: any) {
      alert(err?.message || "Failed to run test case");
    } finally {
      setRunningIds((prev) => ({ ...prev, [tc.id]: false }));
    }
  };

  const handleRunAll = async () => {
    if (!testCases || testCases.length === 0) return;
    setRunningAll(true);
    try {
      await apiPost(`/studies/${study.id}/test-cases/run-all`);
      await refresh();
    } catch (err: any) {
      alert(err?.message || "Failed running test suite");
    } finally {
      setRunningAll(false);
    }
  };

  const handleDelete = async (tc: TestCase) => {
    if (!confirm(tr(`ნამდვილად გსურთ წაშალოთ ტესტ-კეისი '${tc.name}'?`, `Are you sure you want to delete test case '${tc.name}'?`))) {
      return;
    }
    try {
      await apiDelete(`/studies/${study.id}/test-cases/${tc.id}`);
      refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to delete test case");
    }
  };

  const handleDuplicate = async (tc: TestCase) => {
    try {
      await apiPost(`/studies/${study.id}/test-cases`, {
        name: `${tc.name} (Copy)`,
        description: tc.description,
        category: tc.category,
        parameters: tc.parameters,
        expected_outcomes: tc.expected_outcomes,
      });
      refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to duplicate test case");
    }
  };

  const handleSaveModal = async (payload: any) => {
    if (editingTestCase) {
      await apiPut(`/studies/${study.id}/test-cases/${editingTestCase.id}`, payload);
    } else {
      await apiPost(`/studies/${study.id}/test-cases`, payload);
    }
    refresh();
  };

  const handleLoadIntoSimClick = (tc: TestCase) => {
    if (onLoadIntoSim) {
      onLoadIntoSim(tc.parameters);
      setLoadedParamsNotice(tc.id);
      setTimeout(() => setLoadedParamsNotice(null), 3000);
    }
  };

  // Metrics computation
  const total = testCases?.length || 0;
  const passed = testCases?.filter((t) => t.last_run_status === "passed").length || 0;
  const failed = testCases?.filter((t) => t.last_run_status === "failed").length || 0;
  const errorCount = testCases?.filter((t) => t.last_run_status === "error").length || 0;
  const untested = testCases?.filter((t) => t.last_run_status === "untested").length || 0;
  const testedCount = passed + failed + errorCount;
  const passRate = testedCount > 0 ? Math.round((passed / testedCount) * 100) : 0;

  // Filter test cases
  const filteredCases = (testCases || []).filter((tc) => {
    if (selectedCategory !== "all" && tc.category !== selectedCategory) return false;
    if (selectedStatus !== "all" && tc.last_run_status !== selectedStatus) return false;
    return true;
  });

  const getCategoryBadge = (cat: TestCaseCategory) => {
    switch (cat) {
      case "corner_case":
        return <span className="badge" style={{ background: "#f5f3ff", color: "#6d28d9", borderColor: "#ddd6fe" }}>Corner Case</span>;
      case "benchmark":
        return <span className="badge" style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }}>Benchmark</span>;
      case "boundary":
        return <span className="badge" style={{ background: "#fffbeb", color: "#b45309", borderColor: "#fde68a" }}>Boundary</span>;
      case "regression":
        return <span className="badge" style={{ background: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" }}>Regression</span>;
      case "nominal":
        return <span className="badge" style={{ background: "#f4f4f5", color: "#3f3f46", borderColor: "#e4e4e7" }}>Nominal</span>;
      default:
        return <span className="badge">Custom</span>;
    }
  };

  return (
    <div className="test-cases-manager" style={{ padding: 20 }}>
      {/* Top Suite Executive Scorecard */}
      <div className="study-card" style={{ marginBottom: 18, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          {/* Left: Score & Pass Rate */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: total === 0 ? "var(--ll-surface-subtle)" : passRate === 100 ? "var(--ll-emerald-soft)" : failed > 0 ? "var(--ll-rose-soft)" : "var(--ll-surface-subtle)",
                color: total === 0 ? "var(--ll-text-muted)" : passRate === 100 ? "var(--ll-emerald)" : failed > 0 ? "var(--ll-rose)" : "var(--ll-text-secondary)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 16,
                border: "2px solid currentColor",
              }}
            >
              <span>{testedCount > 0 ? `${passRate}%` : "—"}</span>
              <span style={{ fontSize: 9, fontWeight: 500, textTransform: "uppercase" }}>Pass</span>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ll-text-primary)" }}>
                  {tr("დეტერმინისტული ტესტ-კეისების ნაკრები", "Deterministic Test Suite")}
                </h3>
                {latestModel && (
                  <span className="badge" style={{ fontSize: 10 }}>
                    Model v{latestModel.version}
                  </span>
                )}
              </div>
              <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "var(--ll-text-secondary)" }}>
                {tr(
                  "სპეციფიკური ექსპერიმენტული წერტილები, საზღვრები და საკვანძო კუთხური კეისები 3D სიმულატორისთვის",
                  "Exact named test scenarios, corner cases and regulatory benchmarks evaluated against the active Flow model."
                )}
              </p>
            </div>
          </div>

          {/* Right: Suite Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="btn-secondary"
              onClick={() => {
                setEditingTestCase(null);
                setIsModalOpen(true);
              }}
              style={{ fontSize: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <Plus size={14} />
              <span>{tr("ტესტის დამატება", "Add Test Case")}</span>
            </button>

            <button
              className="btn-primary"
              onClick={handleRunAll}
              disabled={runningAll || total === 0}
              style={{ fontSize: 12, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
              title={tr("ყველა ტესტ-კეისის ერთდროულად გაშვება", "Execute all test cases in sequence")}
            >
              {runningAll ? <RefreshCw size={14} className="spin" /> : <Play size={14} fill="currentColor" />}
              <span>{runningAll ? tr("იტესტება...", "Running Suite...") : tr("ტესტ-სუიტის გაშვება", "Run Test Suite")}</span>
            </button>
          </div>
        </div>

        {/* Visual Progress Split Meter */}
        {total > 0 && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                display: "flex",
                overflow: "hidden",
                background: "var(--ll-surface-active)",
                gap: 2,
              }}
            >
              {passed > 0 && (
                <div
                  style={{
                    flex: passed,
                    background: "var(--ll-emerald)",
                    transition: "all 0.3s ease",
                  }}
                  title={`${passed} Passed`}
                />
              )}
              {failed > 0 && (
                <div
                  style={{
                    flex: failed,
                    background: "var(--ll-rose)",
                    transition: "all 0.3s ease",
                  }}
                  title={`${failed} Failed`}
                />
              )}
              {errorCount > 0 && (
                <div
                  style={{
                    flex: errorCount,
                    background: "var(--ll-amber)",
                    transition: "all 0.3s ease",
                  }}
                  title={`${errorCount} Errors`}
                />
              )}
              {untested > 0 && (
                <div
                  style={{
                    flex: untested,
                    background: "var(--ll-border-strong)",
                    transition: "all 0.3s ease",
                  }}
                  title={`${untested} Untested`}
                />
              )}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 11,
                color: "var(--ll-text-secondary)",
              }}
            >
              <div style={{ display: "flex", gap: 14 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ll-emerald)" }} />
                  <strong>{passed}</strong> {tr("წარმატებული", "Passed")}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ll-rose)" }} />
                  <strong>{failed}</strong> {tr("ჩავარდნილი", "Failed")}
                </span>
                {untested > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ll-border-strong)" }} />
                    <strong>{untested}</strong> {tr("გაუშვებელი", "Untested")}
                  </span>
                )}
                {errorCount > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ll-amber)" }} />
                    <strong>{errorCount}</strong> {tr("შეცდომა", "Errors")}
                  </span>
                )}
              </div>

              <span>
                {total} {tr("ტესტი ჯამში", "Total Test Cases")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        {/* Category Filter Tabs */}
        <div style={{ display: "flex", gap: 4, background: "var(--ll-surface-subtle)", padding: 3, borderRadius: 6 }}>
          {[
            { id: "all", label: tr("ყველა", "All") },
            { id: "corner_case", label: "Corner Cases" },
            { id: "benchmark", label: "Benchmarks" },
            { id: "boundary", label: "Boundaries" },
            { id: "regression", label: "Regressions" },
            { id: "nominal", label: "Nominal" },
          ].map((cat) => (
            <button
              key={cat.id}
              className={`btn-ghost ${selectedCategory === cat.id ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                background: selectedCategory === cat.id ? "var(--ll-surface)" : "transparent",
                fontWeight: selectedCategory === cat.id ? 600 : 400,
                boxShadow: selectedCategory === cat.id ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Status Filter Tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "all", label: tr("სტატუსი: ყველა", "Status: All") },
            { id: "passed", label: tr("წარმატებული", "Passed") },
            { id: "failed", label: tr("ჩავარდნილი", "Failed") },
            { id: "untested", label: tr("გაუშვებელი", "Untested") },
          ].map((st) => (
            <button
              key={st.id}
              className={`btn-ghost ${selectedStatus === st.id ? "active" : ""}`}
              onClick={() => setSelectedStatus(st.id)}
              style={{
                fontSize: 11,
                padding: "3px 7px",
                borderRadius: 4,
                color: selectedStatus === st.id ? "var(--ll-emerald)" : "var(--ll-text-secondary)",
                fontWeight: selectedStatus === st.id ? 600 : 400,
              }}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      {loading && (
        <div className="study-card" style={{ padding: 32, textAlign: "center", color: "var(--ll-text-secondary)" }}>
          <RefreshCw size={18} className="spin" style={{ margin: "0 auto 8px auto" }} />
          <div>{tr("ტესტ-კეისები იტვირთება...", "Loading test cases...")}</div>
        </div>
      )}

      {error && (
        <div className="study-card" style={{ padding: 20, color: "var(--ll-rose)" }}>
          {error.message}
        </div>
      )}

      {!loading && total === 0 && (
        <div className="study-card" style={{ padding: 48, textAlign: "center" }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              background: "var(--ll-emerald-soft)",
              color: "var(--ll-emerald)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px auto",
            }}
          >
            <Target size={26} />
          </div>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 16, color: "var(--ll-text-primary)" }}>
            {tr("ტესტ-კეისები ჯერ არ არის დამატებული", "No Custom Test Cases Added Yet")}
          </h4>
          <p
            style={{
              margin: "0 auto 20px auto",
              maxWidth: 480,
              fontSize: 13,
              color: "var(--ll-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {tr(
              "დაამატეთ ზუსტი ფიზიკური პარამეტრების ნაკრები და ასერციები მოდელის ქცევის შესამოწმებლად მონტე-კარლოს პარალელურად.",
              "Define exact experimental corner cases, regulatory standards, and assertions to test and preserve alongside automated screening."
            )}
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              setEditingTestCase(null);
              setIsModalOpen(true);
            }}
          >
            <Plus size={14} />
            <span>{tr("პირველი ტესტის შექმნა", "Create First Test Case")}</span>
          </button>
        </div>
      )}

      {/* Test Cases List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filteredCases.map((tc) => {
          const isExpanded = expandedIds[tc.id] ?? false;
          const isRunning = runningIds[tc.id] || runningAll;
          const runOutputs = tc.last_run_outputs as any;
          const assertions: any[] = runOutputs?.assertions || [];

          return (
            <div
              key={tc.id}
              className="study-card"
              style={{
                padding: "14px 16px",
                borderLeft: `4px solid ${
                  tc.last_run_status === "passed"
                    ? "var(--ll-emerald)"
                    : tc.last_run_status === "failed"
                    ? "var(--ll-rose)"
                    : tc.last_run_status === "error"
                    ? "var(--ll-amber)"
                    : "var(--ll-border-strong)"
                }`,
              }}
            >
              {/* Row 1: Header & Primary Actions */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
                  <button
                    className="btn-ghost"
                    onClick={() => toggleExpand(tc.id)}
                    style={{ padding: 2, color: "var(--ll-text-muted)" }}
                    aria-label="Toggle details"
                  >
                    {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ll-text-primary)" }}>
                        {tc.name}
                      </span>
                      {getCategoryBadge(tc.category)}
                    </div>
                    {tc.description && (
                      <div style={{ fontSize: 11.5, color: "var(--ll-text-secondary)", marginTop: 2 }}>
                        {tc.description}
                      </div>
                    )}
                  </div>
                </div>

                {/* Status Badge & Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Status Pill */}
                  {tc.last_run_status === "passed" && (
                    <span
                      className="badge"
                      style={{
                        background: "var(--ll-emerald-soft)",
                        color: "var(--ll-emerald-text)",
                        borderColor: "var(--ll-emerald-border)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                      }}
                    >
                      <CheckCircle2 size={12} />
                      <span>{tr("Passed", "Passed")}</span>
                      {runOutputs?.duration_ms && (
                        <span style={{ opacity: 0.75, fontFamily: "var(--ll-font-mono)" }}>
                          ({Math.round(runOutputs.duration_ms)}ms)
                        </span>
                      )}
                    </span>
                  )}

                  {tc.last_run_status === "failed" && (
                    <span
                      className="badge"
                      style={{
                        background: "var(--ll-rose-soft)",
                        color: "var(--ll-rose-text)",
                        borderColor: "var(--ll-rose-border)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                      }}
                    >
                      <XCircle size={12} />
                      <span>{tr("Failed", "Failed")}</span>
                    </span>
                  )}

                  {tc.last_run_status === "untested" && (
                    <span
                      className="badge"
                      style={{
                        background: "var(--ll-surface-subtle)",
                        color: "var(--ll-text-muted)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                      }}
                    >
                      <Clock size={12} />
                      <span>{tr("Untested", "Untested")}</span>
                    </span>
                  )}

                  {tc.last_run_status === "error" && (
                    <span
                      className="badge"
                      style={{
                        background: "var(--ll-amber-soft)",
                        color: "var(--ll-amber-text)",
                        borderColor: "var(--ll-amber-border)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                      }}
                      title={runOutputs?.error_message || "Execution error"}
                    >
                      <AlertTriangle size={12} />
                      <span>{tr("Error", "Error")}</span>
                    </span>
                  )}

                  {/* Run Button */}
                  <button
                    className="btn-secondary"
                    onClick={() => handleRunSingle(tc)}
                    disabled={isRunning}
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title={tr("მხოლოდ ამ ტესტის გაშვება", "Run this test case")}
                  >
                    {isRunning ? <RefreshCw size={11} className="spin" /> : <Play size={11} fill="currentColor" />}
                    <span>{tr("გაშვება", "Run")}</span>
                  </button>

                  {/* Load into 3D Sim Button */}
                  {onLoadIntoSim && (
                    <button
                      className="btn-secondary"
                      onClick={() => handleLoadIntoSimClick(tc)}
                      style={{
                        fontSize: 11,
                        padding: "4px 8px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: loadedParamsNotice === tc.id ? "var(--ll-emerald)" : "var(--ll-blue)",
                      }}
                      title={tr("ამ პარამეტრების გადატანა 3D სიმულატორში", "Load exact test parameters into 3D Simulator canvas")}
                    >
                      {loadedParamsNotice === tc.id ? <Check size={12} /> : <Workflow size={12} />}
                      <span>{loadedParamsNotice === tc.id ? tr("ჩაიტვირთა!", "Loaded in 3D Sim!") : tr("3D სიმულატორში ჩატვირთვა", "Load in 3D Sim")}</span>
                    </button>
                  )}

                  {/* Edit / Duplicate / Delete */}
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setEditingTestCase(tc);
                      setIsModalOpen(true);
                    }}
                    style={{ padding: "4px 6px" }}
                    title={tr("რედაქტირება", "Edit test case")}
                  >
                    <Edit2 size={12} />
                  </button>

                  <button
                    className="btn-ghost"
                    onClick={() => handleDuplicate(tc)}
                    style={{ padding: "4px 6px" }}
                    title={tr("დუბლირება", "Duplicate test case")}
                  >
                    <Copy size={12} />
                  </button>

                  <button
                    className="btn-ghost"
                    onClick={() => handleDelete(tc)}
                    style={{ padding: "4px 6px", color: "var(--ll-rose)" }}
                    title={tr("წაშლა", "Delete test case")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Row 2: Parameter Values Preview Chips */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: "1px dashed var(--ll-border)",
                }}
              >
                <span style={{ fontSize: 10.5, color: "var(--ll-text-muted)", fontWeight: 500, marginRight: 2 }}>
                  {tr("პარამეტრები:", "Parameters:")}
                </span>
                {Object.entries(tc.parameters || {}).map(([key, val]) => {
                  const pDef = parameters.find((p) => p.key === key);
                  return (
                    <span
                      key={key}
                      style={{
                        background: "var(--ll-surface-subtle)",
                        border: "1px solid var(--ll-border)",
                        borderRadius: 4,
                        padding: "2px 6px",
                        fontSize: 10.5,
                        fontFamily: "var(--ll-font-mono)",
                        color: "var(--ll-text-secondary)",
                      }}
                      title={`${pDef?.label || key}: ${val} ${pDef?.unit || ""}`}
                    >
                      <span style={{ color: "var(--ll-text-muted)" }}>{key}:</span>{" "}
                      <strong>{typeof val === "number" ? Number(val.toFixed(3)) : String(val)}</strong>
                      {pDef?.unit && <span style={{ opacity: 0.65 }}> {pDef.unit}</span>}
                    </span>
                  );
                })}
              </div>

              {/* Row 3: Expandable Diagnostics & Assertion Details */}
              {isExpanded && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 14px",
                    background: "var(--ll-surface-subtle)",
                    borderRadius: 6,
                    border: "1px solid var(--ll-border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ll-text-primary)" }}>
                      {tr("შედეგების შედარება & ასერციები", "Simulated Outcomes vs. Expected Assertions")}
                    </div>
                    {tc.last_run_at && (
                      <span style={{ fontSize: 10, color: "var(--ll-text-muted)" }}>
                        {tr("შესრულდა:", "Last executed:")} {new Date(tc.last_run_at).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {runOutputs?.error_message && (
                    <div
                      style={{
                        padding: "8px 10px",
                        background: "var(--ll-rose-soft)",
                        color: "var(--ll-rose-text)",
                        borderRadius: 4,
                        fontSize: 11.5,
                        marginBottom: 8,
                      }}
                    >
                      {runOutputs.error_message}
                    </div>
                  )}

                  {assertions.length > 0 ? (
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: "var(--ll-text-muted)", borderBottom: "1px solid var(--ll-border)", textAlign: "left" }}>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>{tr("შედეგი (Outcome)", "Outcome")}</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>{tr("სიმულირებული (Actual)", "Simulated Actual")}</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>{tr("მოსალოდნელი (Target)", "Expected Criterion")}</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>{tr("მარჟა (Delta)", "Delta / Margin")}</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>{tr("ვერდიქტი", "Verdict")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assertions.map((ass, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: idx === assertions.length - 1 ? "none" : "1px solid var(--ll-border-subtle)",
                            }}
                          >
                            <td style={{ padding: "6px 8px", fontWeight: 500, color: "var(--ll-text-primary)" }}>
                              {ass.label || ass.outcome_key}
                              {ass.unit && <span style={{ opacity: 0.6, fontSize: 10 }}> ({ass.unit})</span>}
                            </td>
                            <td style={{ padding: "6px 8px", fontFamily: "var(--ll-font-mono)", fontWeight: 600 }}>
                              {ass.actual} {ass.unit}
                            </td>
                            <td style={{ padding: "6px 8px", color: "var(--ll-text-secondary)" }}>
                              {ass.expected}
                            </td>
                            <td style={{ padding: "6px 8px", fontFamily: "var(--ll-font-mono)", fontSize: 10.5 }}>
                              {ass.delta !== null && ass.delta !== undefined ? (
                                <span style={{ color: ass.passed ? "var(--ll-emerald)" : "var(--ll-rose)" }}>
                                  {ass.delta >= 0 ? `+${ass.delta}` : ass.delta}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>
                              {ass.passed ? (
                                <span
                                  className="badge"
                                  style={{
                                    background: "var(--ll-emerald-soft)",
                                    color: "var(--ll-emerald-text)",
                                    fontSize: 10,
                                    padding: "1px 5px",
                                  }}
                                >
                                  PASS
                                </span>
                              ) : (
                                <span
                                  className="badge"
                                  style={{
                                    background: "var(--ll-rose-soft)",
                                    color: "var(--ll-rose-text)",
                                    fontSize: 10,
                                    padding: "1px 5px",
                                  }}
                                  title={ass.message || undefined}
                                >
                                  FAIL
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--ll-text-muted)", fontStyle: "italic", textAlign: "center", padding: 8 }}>
                      {tr("ტესტი ჯერ არ არის შესრულებული. დააჭირეთ 'გაშვება'-ს.", "This test has not been executed yet. Click 'Run' to simulate.")}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Test Case Create/Edit Modal */}
      {isModalOpen && (
        <TestCaseModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveModal}
          parameters={parameters}
          outcomes={outcomes}
          initialTestCase={editingTestCase}
        />
      )}
    </div>
  );
}
