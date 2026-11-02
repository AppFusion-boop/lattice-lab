import { useState, useMemo } from "react";
import {
  Plus,
  FlaskConical,
  Archive,
  ArrowRight,
  X,
  AlertCircle,
  FileText,
  Upload,
  Download,
  Search,
  Sliders,
  Filter,
  Sparkles,
  Layers,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Wind,
  Cpu,
  ShieldAlert,
  Pill,
  LayoutList,
  LayoutGrid,
  Activity,
  CheckCircle2,
} from "lucide-react";
import { apiGet, apiPost, ApiError } from "./api/client";
import { useApi } from "./api/hooks";
import type { Study, StudyCreate } from "./api/types";
import { navigate } from "../app/router";
import { tr } from "../i18n";
import { ServerStatusBanner } from "./components/ServerStatusBanner";
import { StudyImportModal } from "./components/StudyImportModal";
import "./study.css";

interface TemplateInfo {
  id: "smart_cement_skyscraper" | "microchannel_cold_plate" | "tunnel_blast" | "drug_screen";
  title: string;
  domain: "physics" | "engineering" | "chemistry" | "biology";
  summary: string;
  icon: typeof FlaskConical;
  params: string[];
  outcomes: string[];
  constraints: string;
}

const TEMPLATES: TemplateInfo[] = [
  {
    id: "smart_cement_skyscraper",
    title: "Smart Cement Skyscraper (Damped Civil Materials)",
    domain: "engineering",
    icon: Wind,
    summary: "Multi-objective dynamic wind vibration mitigation and ultra-high-performance concrete formulation.",
    params: ["w/b (0.16–0.28)", "silica_fume (5–25%)", "polymer_cement (0–10%)", "fiber_volume (0.2–2.5%)", "wind_gust (25–65 m/s)"],
    outcomes: ["a_peak < 18 milli-g", "f_c > 90 MPa", "damping > 3.0%", "carbon < 450 kg CO2/m³"],
    constraints: "f_c >= 80 MPa, a_peak <= 22 milli-g, fiber + 0.1*poly <= 3.2",
  },
  {
    id: "microchannel_cold_plate",
    title: "Microchannel Heat Sink (Conjugate Heat Transfer)",
    domain: "physics",
    icon: Cpu,
    summary: "Electronics liquid cooling optimization balancing junction temperature against pumping pressure drop.",
    params: ["channel_width (0.15–1.0 mm)", "fin_thickness (0.15–0.8 mm)", "aspect_ratio (2–10)", "flow_velocity (0.3–3.0 m/s)"],
    outcomes: ["t_junction < 75 °C", "pressure_drop < 40 kPa"],
    constraints: "aspect_ratio <= 8.5, pitch >= 0.35 mm",
  },
  {
    id: "tunnel_blast",
    title: "Tunnel Blast Wave Mitigation (Multi-Nozzle Mist)",
    domain: "physics",
    icon: ShieldAlert,
    summary: "Non-linear overpressure wave attenuation using high-pressure micro-droplet water curtains.",
    params: ["droplet (10–1000 µm)", "flow (1–150 L/min)", "nozzles (1–24)", "mist_lead (0–1 s)"],
    outcomes: ["peak_pressure < 8000 Pa"],
    constraints: "flow * nozzles <= 600 (max pump power)",
  },
  {
    id: "drug_screen",
    title: "Early-Stage Drug Discovery (Lipinski Screen)",
    domain: "chemistry",
    icon: Pill,
    summary: "Pharmacophore feasibility filtering and toxicity elimination over chemical libraries.",
    params: ["mw (Da)", "logp", "hbd", "hba"],
    outcomes: ["toxic == 0", "permeability > 10 nm/s"],
    constraints: "Lipinski Rule of Five: mw <= 500, logp <= 5, hbd <= 5, hba <= 10",
  },
];

export function StudyList() {
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [showBenchmarks, setShowBenchmarks] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [createMode, setCreateMode] = useState<"template" | "blank">("template");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo["id"]>("smart_cement_skyscraper");
  const [formError, setFormError] = useState<string | null>(null);

  // Blank Study Form State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<"physics" | "chemistry" | "biology" | "engineering" | "generic">("physics");
  const [exclusionThreshold, setExclusionThreshold] = useState("0.05");
  const [confidence, setConfidence] = useState("0.95");

  const {
    data: studies,
    loading,
    refresh,
  } = useApi<Study[]>(`studies-list-${activeTab}`, () =>
    apiGet<Study[]>(`/studies?include_archived=${activeTab === "archived"}`)
  );

  const uniqueDomains = useMemo(() => {
    if (!studies) return [];
    return Array.from(new Set(studies.map((s) => s.domain).filter(Boolean)));
  }, [studies]);

  const filteredStudies = useMemo(() => {
    if (!studies) return [];
    return studies
      .filter((s) => (activeTab === "archived" ? s.archived : !s.archived))
      .filter((s) => (domainFilter === "all" ? true : s.domain === domainFilter))
      .filter((s) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q)) ||
          s.domain.toLowerCase().includes(q)
        );
      });
  }, [studies, activeTab, domainFilter, searchQuery]);

  const handleLaunchTemplate = async (templateId: TemplateInfo["id"]) => {
    try {
      const created = await apiPost<Study>("/studies/from-template", {
        template: templateId,
      });
      navigate(`studies/${created.id}/overview`);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    try {
      if (createMode === "template") {
        const created = await apiPost<Study>("/studies/from-template", {
          template: selectedTemplate,
        });
        setShowCreateModal(false);
        navigate(`studies/${created.id}/overview`);
      } else {
        const payload: StudyCreate = {
          name: name.trim(),
          description: description.trim(),
          domain,
          exclusion_threshold: parseFloat(exclusionThreshold) || 0.05,
          confidence: parseFloat(confidence) || 0.95,
          max_engine_evaluations: 50000,
        };
        const created = await apiPost<Study>("/studies", payload);
        setShowCreateModal(false);
        navigate(`studies/${created.id}/overview`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError((err as Error).message);
      }
    }
  };

  const handleArchive = async (e: React.MouseEvent, study: Study) => {
    e.stopPropagation();
    if (!confirm(tr(`დავაარქივოთ კვლევა '${study.name}'?`, `Archive study '${study.name}'?`))) {
      return;
    }
    try {
      await apiPost(`/studies/${study.id}/archive`);
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleExportLat = (study: Study) => {
    const slug = (study.name || "study").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[-\s]+/g, "_");
    const link = document.createElement("a");
    link.href = `/api/v1/studies/${study.id}/export.lat`;
    link.setAttribute("download", `${slug || "study"}.lat`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const totalStudies = studies?.length ?? 0;
  const activeCount = studies?.filter((s) => !s.archived).length ?? 0;
  const archivedCount = studies?.filter((s) => s.archived).length ?? 0;

  return (
    <div className="study-container">
      <ServerStatusBanner />

      {/* Executive Metric Ribbon */}
      <div className="study-executive-ribbon">
        <div className="exec-kpi-block">
          <div className="exec-kpi-label">
            <Layers size={11} color="var(--ll-text-muted)" />
            <span>{tr("აქტიური კვლევები", "Active Studies")}</span>
          </div>
          <div className="exec-kpi-val">{activeCount}</div>
          <div className="exec-kpi-sub">{tr("მიმდინარე სკრინინგი", "Screening campaigns")}</div>
        </div>

        <div className="exec-kpi-block">
          <div className="exec-kpi-label">
            <FlaskConical size={11} color="var(--ll-emerald)" />
            <span>{tr("სტატისტიკური სანდოობა", "Statistical Guarantee")}</span>
          </div>
          <div className="exec-kpi-val" style={{ color: "var(--ll-emerald)" }}>95% CL</div>
          <div className="exec-kpi-sub">Clopper-Pearson (α = 0.05)</div>
        </div>

        <div className="exec-kpi-block">
          <div className="exec-kpi-label">
            <Sliders size={11} color="var(--ll-blue)" />
            <span>{tr("კვლევის სფეროები", "Research Domains")}</span>
          </div>
          <div className="exec-kpi-val" style={{ color: "var(--ll-blue)" }}>{uniqueDomains.length || 1}</div>
          <div className="exec-kpi-sub">{uniqueDomains.slice(0, 3).join(", ") || "Physical disciplines"}</div>
        </div>

        <div className="exec-kpi-block">
          <div className="exec-kpi-label">
            <Activity size={11} color="var(--ll-indigo)" />
            <span>{tr("გამომთვლელი კლასტერი", "Compute Cluster")}</span>
          </div>
          <div className="exec-kpi-val" style={{ color: "var(--ll-indigo)", fontSize: 15, fontFamily: "var(--ll-font-mono)" }}>127.0.0.1:8765</div>
          <div className="exec-kpi-sub">FastAPI + SQLite WAL Online</div>
        </div>
      </div>

      {/* Pre-Validated Scientific Benchmarks Shelf */}
      <div className="benchmark-shelf">
        <div className="benchmark-shelf-header">
          <h4 className="benchmark-shelf-title">
            <Sparkles size={13} color="var(--ll-emerald)" />
            <span>{tr("ვერიფიცირებული სამეცნიერო შაბლონები (Physical DoE Benchmarks)", "Pre-Validated Scientific Benchmarks (DoE & Physical Models)")}</span>
          </h4>
          <button
            type="button"
            className="benchmark-shelf-toggle"
            onClick={() => setShowBenchmarks(!showBenchmarks)}
          >
            <span>{showBenchmarks ? tr("დამალვა", "Collapse") : tr("გაშლა", "Expand")}</span>
            {showBenchmarks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        {showBenchmarks && (
          <div className="benchmark-grid">
            {TEMPLATES.map((t) => {
              const Icon = t.icon;
              return (
                <div
                  key={t.id}
                  className="benchmark-card"
                  onClick={() => handleLaunchTemplate(t.id)}
                  title={tr("დააწკაპუნეთ შაბლონის გასაშვებად", "Click to launch this benchmark study")}
                >
                  <div>
                    <div className="benchmark-card-top">
                      <span className={`badge badge-${t.domain}`}>{t.domain}</span>
                      <Icon size={14} color="var(--ll-text-secondary)" />
                    </div>
                    <div className="benchmark-card-title" style={{ marginTop: 6 }}>
                      {t.title.split("(")[0].trim()}
                    </div>
                    <div className="benchmark-card-desc" style={{ marginTop: 4 }}>
                      {t.summary}
                    </div>
                  </div>
                  <div className="benchmark-card-footer">
                    <span>{tr("შაბლონის გაშვება", "Launch Benchmark")}</span>
                    <ArrowRight size={11} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Consolidated Scientific Catalog Header Toolbar */}
      <div className="catalog-toolbar">
        <div className="catalog-toolbar-left">
          {/* Active vs Archived segmented pill */}
          <div className="view-mode-toggle" style={{ background: "var(--ll-surface-subtle)" }}>
            <button
              type="button"
              className={`segmented-pill ${activeTab === "active" ? "active" : ""}`}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: activeTab === "active" ? 600 : 500,
                background: activeTab === "active" ? "var(--ll-surface)" : "transparent",
                color: activeTab === "active" ? "var(--ll-emerald)" : "var(--ll-text-secondary)",
                borderRadius: "var(--ll-radius-sm)",
                border: "none",
                cursor: "pointer",
                boxShadow: activeTab === "active" ? "var(--ll-shadow-xs)" : "none",
              }}
              onClick={() => setActiveTab("active")}
            >
              {tr("აქტიური კვლევები", "Active Studies")} ({activeCount})
            </button>
            <button
              type="button"
              className={`segmented-pill ${activeTab === "archived" ? "active" : ""}`}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: activeTab === "archived" ? 600 : 500,
                background: activeTab === "archived" ? "var(--ll-surface)" : "transparent",
                color: activeTab === "archived" ? "var(--ll-emerald)" : "var(--ll-text-secondary)",
                borderRadius: "var(--ll-radius-sm)",
                border: "none",
                cursor: "pointer",
                boxShadow: activeTab === "archived" ? "var(--ll-shadow-xs)" : "none",
              }}
              onClick={() => setActiveTab("archived")}
            >
              {tr("არქივი", "Archived")} ({archivedCount})
            </button>
          </div>

          {/* Search Box */}
          <div style={{ position: "relative", width: 220 }}>
            <Search
              size={13}
              style={{
                position: "absolute",
                left: 9,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--ll-text-muted)",
              }}
            />
            <input
              type="text"
              className="form-input"
              style={{ width: "100%", paddingLeft: 28, height: 30, fontSize: 12 }}
              placeholder={tr("კვლევის ძიება...", "Search studies...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--ll-text-muted)",
                  padding: 2,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Domain Filter Dropdown */}
          <select
            className="form-select"
            style={{ height: 30, padding: "0 8px", fontSize: 12, width: 140 }}
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
          >
            <option value="all">{tr("ყველა სფერო", "All Domains")}</option>
            <option value="physics">Physics</option>
            <option value="engineering">Engineering</option>
            <option value="chemistry">Chemistry</option>
            <option value="biology">Biology</option>
            <option value="microfluidics">Microfluidics</option>
            <option value="optical_microscopy">Optical Microscopy</option>
            <option value="biophysics_materials">Biophysics</option>
            <option value="generic">Generic</option>
          </select>
        </div>

        {/* Right Action Buttons */}
        <div className="catalog-toolbar-right">
          {/* View Mode Switcher */}
          <div className="view-mode-toggle" title={tr("ცხრილი / ბარათები", "Table / Cards view")}>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              title={tr("სამეცნიერო მატრიცა (ცხრილი)", "High-density matrix table")}
            >
              <LayoutList size={13} />
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title={tr("პროექტის ბარათები (ბადე)", "Architectural project cards")}
            >
              <LayoutGrid size={13} />
            </button>
          </div>

          <button
            className="btn-secondary"
            onClick={() => setShowImportModal(true)}
            title={tr("სრული კვლევის იმპორტი (.lat ფაილიდან)", "Import complete study package (.lat)")}
          >
            <Upload size={13} />
            <span>{tr("იმპორტი (.lat)", "Import (.lat)")}</span>
          </button>

          <button
            className="btn-primary"
            onClick={() => {
              setFormError(null);
              setShowCreateModal(true);
            }}
          >
            <Plus size={14} />
            <span>{tr("ახალი კვლევა", "New Study")}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="study-content">
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--ll-text-muted)" }}>
            {tr("კვლევები იტვირთება...", "Loading studies...")}
          </div>
        ) : filteredStudies.length === 0 ? (
          <div className="study-card" style={{ textAlign: "center", padding: "56px 24px", maxWidth: 540, margin: "32px auto" }}>
            <div
              style={{
                display: "inline-flex",
                padding: 16,
                borderRadius: "var(--ll-radius-full)",
                background: "var(--ll-surface-hover)",
                color: "var(--ll-text-muted)",
                marginBottom: 16,
              }}
            >
              <FlaskConical size={32} />
            </div>
            <h3 style={{ margin: "0 0 8px 0", fontSize: 15, fontWeight: 650, color: "var(--ll-text-primary)" }}>
              {activeTab === "active"
                ? searchQuery || domainFilter !== "all"
                  ? tr("კვლევა ვერ მოიძებნა", "No matching studies found")
                  : tr("აქტიური კვლევები არ არის", "No active studies yet")
                : tr("არქივში კვლევები არ არის", "No archived studies")}
            </h3>
            <p style={{ margin: "0 auto 20px auto", maxWidth: 420, color: "var(--ll-text-secondary)", fontSize: 12.5, lineHeight: 1.5 }}>
              {activeTab === "active"
                ? tr(
                    "დაიწყეთ ახალი კვლევა ან გამოიყენეთ მზა სამეცნიერო შაბლონი (მაგ. ცათამბჯენის ბეტონის დემპფინგი, მიკროარხული გაგრილება, აფეთქების ჩახშობა) უსარგებლო ექსპერიმენტების მათემატიკურად გამოსარიცხად.",
                    "Initialize an experimental screening study from scratch or launch a pre-configured scientific template to mathematically eliminate futile parameter regimes.",
                  )
                : tr("არქივირებული კვლევები აქ გამოჩნდება.", "Archived studies will appear here.")}
            </p>
            {activeTab === "active" && !searchQuery && domainFilter === "all" && (
              <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
                <Plus size={14} />
                <span>{tr("კვლევის დაწყება", "Create New Study")}</span>
              </button>
            )}
          </div>
        ) : viewMode === "table" ? (
          <div className="study-matrix-wrap">
            <table className="study-matrix-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>{tr("სფერო", "Domain")}</th>
                  <th>{tr("კვლევა & კვლევის ჰიპოთეზა", "Study & Research Scope")}</th>
                  <th style={{ width: 170 }}>{tr("სანდოობის გარანტია", "Statistical Bound")}</th>
                  <th style={{ width: 140 }}>{tr("საძიებო სივრცე", "Search Space")}</th>
                  <th style={{ width: 110 }}>{tr("თარიღი", "Created")}</th>
                  <th style={{ width: 160, textAlign: "right" }}>{tr("მოქმედება", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudies.map((s) => (
                  <tr
                    key={s.id}
                    className="matrix-row"
                    onClick={() => navigate(`studies/${s.id}/overview`)}
                  >
                    <td>
                      <span className={`badge badge-${s.domain || "generic"}`}>{s.domain || "generic"}</span>
                    </td>
                    <td>
                      <div className="matrix-study-title">
                        <span>{s.name}</span>
                        <span className="matrix-study-id">{s.id.slice(0, 12)}…</span>
                      </div>
                      <div className="matrix-study-desc">
                        {s.description || tr("აღწერის გარეშე", "No description provided.")}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontWeight: 600, color: "var(--ll-emerald)", fontFamily: "var(--ll-font-mono)", fontSize: 11.5 }}>
                          {Math.round(s.confidence * 100)}% CL (α = {(1 - s.confidence).toFixed(2)})
                        </span>
                        <span style={{ fontSize: 10.5, color: "var(--ll-text-muted)" }}>
                          θ_excl = {Math.round(s.exclusion_threshold * 100)}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontFamily: "var(--ll-font-mono)", fontSize: 11.5, color: "var(--ll-text-secondary)" }}>
                        {s.max_engine_evaluations?.toLocaleString() || "50,000"} <span style={{ fontSize: 10.5, color: "var(--ll-text-muted)" }}>evals</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--ll-text-muted)", fontSize: 11.5 }}>
                        {new Date(s.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <button
                          className="btn-secondary"
                          onClick={() => navigate(`studies/${s.id}/overview`)}
                          style={{ padding: "4px 8px", fontSize: 11, color: "var(--ll-emerald)" }}
                          title={tr("სამუშაო მაგიდის გახსნა", "Open Study Workbench")}
                        >
                          <span>{tr("გახსნა", "Open")}</span>
                          <ArrowRight size={11} />
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => handleExportLat(s)}
                          style={{ padding: 4, color: "var(--ll-blue)" }}
                          title={tr("სრული კვლევის ექსპორტი (.lat)", "Export package (.lat)")}
                        >
                          <Download size={13} />
                        </button>
                        {!s.archived && (
                          <button
                            className="btn-ghost"
                            onClick={(e) => handleArchive(e, s)}
                            style={{ padding: 4, color: "var(--ll-text-muted)" }}
                            title={tr("არქივირება", "Archive study")}
                          >
                            <Archive size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="study-catalog-grid">
            {filteredStudies.map((s) => (
              <div
                key={s.id}
                className="scientific-study-card"
                onClick={() => navigate(`studies/${s.id}/overview`)}
              >
                <div>
                  <div className="study-card-top-row">
                    <div className="study-card-badge-group">
                      <span className={`badge badge-${s.domain || "generic"}`}>{s.domain || "generic"}</span>
                      <span className="badge badge-generic" style={{ fontSize: 10 }}>
                        {Math.round(s.confidence * 100)}% CL
                      </span>
                    </div>

                    <div className="study-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-ghost"
                        onClick={() => handleExportLat(s)}
                        style={{ padding: 4, color: "var(--ll-blue)" }}
                        title={tr("სრული კვლევის ექსპორტი (.lat)", "Export full study package (.lat)")}
                      >
                        <Download size={13} />
                      </button>
                      {!s.archived && (
                        <button
                          className="btn-ghost"
                          onClick={(e) => handleArchive(e, s)}
                          style={{ padding: 4, color: "var(--ll-text-muted)" }}
                          title={tr("არქივირება", "Archive study")}
                        >
                          <Archive size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  <h4 className="study-card-heading">
                    {s.name}
                  </h4>
                  <p className="study-card-desc">
                    {s.description || tr("აღწერის გარეშე", "No description provided.")}
                  </p>

                  <div className="study-card-meta-chips">
                    <span className="meta-chip">
                      α = {(1 - s.confidence).toFixed(2)}
                    </span>
                    <span className="meta-chip">
                      θ_excl = {Math.round(s.exclusion_threshold * 100)}%
                    </span>
                    <span className="meta-chip">
                      max_eval = {s.max_engine_evaluations?.toLocaleString() || "50,000"}
                    </span>
                  </div>
                </div>

                <div className="study-card-footer-row">
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--ll-emerald)", fontWeight: 600 }}>
                    <span>{tr("გახსნა", "Open Workbench")}</span>
                    <ArrowRight size={12} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modern Scientific Study Creation Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={16} color="var(--ll-emerald)" />
                <h3 className="modal-title">{tr("ახალი კვლევის შექმნა", "New Scientific Study")}</h3>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowCreateModal(false)}
                style={{ padding: 4 }}
              >
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
                      gap: 8,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Creation Mode Switcher */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setCreateMode("template")}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 14px",
                      borderRadius: "var(--ll-radius-lg)",
                      border: `1.5px solid ${createMode === "template" ? "var(--ll-emerald)" : "var(--ll-border)"}`,
                      background: createMode === "template" ? "var(--ll-emerald-soft)" : "var(--ll-surface)",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Sparkles size={16} color={createMode === "template" ? "var(--ll-emerald)" : "var(--ll-text-muted)"} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 650, color: createMode === "template" ? "var(--ll-emerald-text)" : "var(--ll-text-primary)" }}>
                        {tr("სამეცნიერო შაბლონი", "Scientific Template")}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ll-text-secondary)", marginTop: 2 }}>
                        {tr("წინასწარ აწყობილი ფიზიკა & DoE", "Pre-configured physics graph & bounds")}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreateMode("blank")}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 14px",
                      borderRadius: "var(--ll-radius-lg)",
                      border: `1.5px solid ${createMode === "blank" ? "var(--ll-emerald)" : "var(--ll-border)"}`,
                      background: createMode === "blank" ? "var(--ll-emerald-soft)" : "var(--ll-surface)",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Layers size={16} color={createMode === "blank" ? "var(--ll-emerald)" : "var(--ll-text-muted)"} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 650, color: createMode === "blank" ? "var(--ll-emerald-text)" : "var(--ll-text-primary)" }}>
                        {tr("ცარიელი კვლევა", "Blank Study")}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ll-text-secondary)", marginTop: 2 }}>
                        {tr("საკუთარი პარამეტრებითა და მოდელით", "Define custom parameters and model")}
                      </div>
                    </div>
                  </button>
                </div>

                {createMode === "template" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <label className="form-label">{tr("აირჩიეთ სამეცნიერო სცენარი", "Select Domain Scenario")}</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {TEMPLATES.map((tmpl) => {
                        const isSelected = selectedTemplate === tmpl.id;
                        const Icon = tmpl.icon;
                        return (
                          <div
                            key={tmpl.id}
                            onClick={() => setSelectedTemplate(tmpl.id)}
                            style={{
                              border: `1.5px solid ${isSelected ? "var(--ll-emerald)" : "var(--ll-border)"}`,
                              background: isSelected ? "var(--ll-surface)" : "var(--ll-surface-hover)",
                              borderRadius: "var(--ll-radius-lg)",
                              padding: 12,
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              boxShadow: isSelected ? "var(--ll-shadow-card)" : "none",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <span className={`badge badge-${tmpl.domain}`}>{tmpl.domain}</span>
                              <Icon size={14} color={isSelected ? "var(--ll-emerald)" : "var(--ll-text-muted)"} />
                            </div>
                            <h5 style={{ margin: "0 0 4px 0", fontSize: 12.5, fontWeight: 650, color: "var(--ll-text-primary)" }}>
                              {tmpl.title}
                            </h5>
                            <p style={{ margin: "0 0 8px 0", fontSize: 11, color: "var(--ll-text-secondary)", lineHeight: 1.35 }}>
                              {tmpl.summary}
                            </p>
                            <div style={{ fontSize: 10.5, color: "var(--ll-text-muted)", borderTop: "1px solid var(--ll-border)", paddingTop: 6 }}>
                              <strong>Target:</strong> {tmpl.outcomes.slice(0, 2).join(", ")}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        padding: "8px 12px",
                        background: "var(--ll-amber-soft)",
                        border: "1px solid var(--ll-amber-border)",
                        borderRadius: "var(--ll-radius-md)",
                        fontSize: 11,
                        color: "var(--ll-amber-text)",
                        lineHeight: 1.4,
                      }}
                    >
                      <strong>{tr("შენიშვნა (Hard Rule #1):", "Scientific Notice (Hard Rule #1):")}</strong>{" "}
                      {tr(
                        "შაბლონის მნიშვნელობები საილუსტრაციოა. კვლევის შექმნის შემდეგ შეცვალეთ თქვენი ემპირიული ლაბორატორიული მონაცემებით.",
                        "Template numbers are unvalidated illustrative baselines. Replace with your actual physical laboratory instruments and evidence.",
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="form-group">
                      <label className="form-label">{tr("კვლევის სახელი", "Study Name")}</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Aerodynamic Drag Reduction Matrix Trial 1"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">{tr("აღწერა", "Description")}</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        placeholder="e.g. Statistical screening of non-linear vortex generators under wind tunnel uncertainty"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">{tr("სფერო", "Domain")}</label>
                        <select className="form-select" value={domain} onChange={(e) => setDomain(e.target.value as any)}>
                          <option value="physics">Physics</option>
                          <option value="chemistry">Chemistry</option>
                          <option value="biology">Biology</option>
                          <option value="engineering">Engineering</option>
                          <option value="generic">Generic</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label">
                          {tr("ზღვარი (τ)", "Exclusion (τ)")}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.001"
                          max="0.5"
                          className="form-input"
                          value={exclusionThreshold}
                          onChange={(e) => setExclusionThreshold(e.target.value)}
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">
                          {tr("სანდოობა (1−δ)", "Confidence (1−δ)")}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.5"
                          max="0.999"
                          className="form-input"
                          value={confidence}
                          onChange={(e) => setConfidence(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary">
                  {tr("კვლევის შექმნა", "Create Study")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Study Package Modal */}
      {showImportModal && (
        <StudyImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImportSuccess={(imported) => {
            refresh();
            navigate(`studies/${imported.id}/overview`);
          }}
        />
      )}
    </div>
  );
}
