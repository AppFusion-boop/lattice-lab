import { useState } from "react";
import { Plus, FlaskConical, Archive, ArrowRight, X, AlertCircle, FileText } from "lucide-react";
import { apiGet, apiPost, ApiError } from "./api/client";
import { useApi } from "./api/hooks";
import type { Study, StudyCreate } from "./api/types";
import { navigate } from "../app/router";
import { tr } from "../i18n";
import { ServerStatusBanner } from "./components/ServerStatusBanner";
import "./study.css";

export function StudyList() {
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState<"blank" | "template">("blank");
  const [selectedTemplate, setSelectedTemplate] = useState<"tunnel_blast" | "drug_screen" | "microchannel_cold_plate">("microchannel_cold_plate");
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

  const filteredStudies = studies?.filter((s) => (activeTab === "archived" ? s.archived : !s.archived)) || [];

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

  return (
    <div className="study-container">
      <ServerStatusBanner />

      <header className="study-header">
        <div className="study-title-group">
          <div style={{ display: "inline-flex", padding: 6, borderRadius: 6, background: "#e8f2ee", color: "#247861" }}>
            <FlaskConical size={18} />
          </div>
          <h2 className="study-title">{tr("სამეცნიერო კვლევები", "Scientific Studies")}</h2>
        </div>

        <button className="btn-primary" onClick={() => { setFormError(null); setShowCreateModal(true); }}>
          <Plus size={14} />
          <span>{tr("ახალი კვლევა", "New Study")}</span>
        </button>
      </header>

      {/* View Tabs */}
      <nav className="study-nav-tabs">
        <button
          className={`study-tab-btn ${activeTab === "active" ? "active" : ""}`}
          onClick={() => setActiveTab("active")}
        >
          {tr("აქტიური კვლევები", "Active Studies")}
        </button>
        <button
          className={`study-tab-btn ${activeTab === "archived" ? "active" : ""}`}
          onClick={() => setActiveTab("archived")}
        >
          {tr("არქივი", "Archived")}
        </button>
      </nav>

      <main className="study-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#84938b" }}>{tr("იტვირთება...", "Loading studies...")}</div>
        ) : filteredStudies.length === 0 ? (
          <div className="study-card" style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ display: "inline-flex", padding: 14, borderRadius: "50%", background: "#f1f5f9", color: "#64748b", marginBottom: 16 }}>
              <FlaskConical size={32} />
            </div>
            <h3 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 650, color: "#1a2c26" }}>
              {activeTab === "active"
                ? tr("აქტიური კვლევები არ არის შექმნილი", "No active studies yet")
                : tr("არქივში კვლევები არ არის", "No archived studies")}
            </h3>
            <p style={{ margin: "0 auto 20px auto", maxWidth: 440, color: "#586b62", fontSize: 13, lineHeight: 1.5 }}>
              {tr(
                "შექმენით ახალი კვლევა ან გამოიყენეთ მზა მეცნიერული შაბლონი (მაგ. აფეთქების ჩახშობა, პრეპარატების სკრინინგი) ექსპერიმენტების რაოდენობის მინიმუმამდე დასაყვანად.",
                "Start a new experiment screening study from scratch or initialize from a domain template (Tunnel Blast Mitigation, Drug Discovery Screen) to mathematically eliminate non-promising field tests."
              )}
            </p>
            {activeTab === "active" && (
              <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
                <Plus size={14} />
                <span>{tr("კვლევის შექმნა", "Create Study")}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="study-grid-cards">
            {filteredStudies.map((s) => (
              <div
                key={s.id}
                className="study-clickable-card"
                onClick={() => navigate(`studies/${s.id}/overview`)}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <span className={`badge badge-${s.domain}`}>{s.domain}</span>
                    {!s.archived && (
                      <button
                        onClick={(e) => handleArchive(e, s)}
                        style={{ color: "#84938b", padding: 4 }}
                        title="Archive study"
                      >
                        <Archive size={13} />
                      </button>
                    )}
                  </div>
                  <h4 style={{ margin: "0 0 6px 0", fontSize: 15, fontWeight: 650, color: "#1a2c26" }}>
                    {s.name}
                  </h4>
                  <p style={{ margin: 0, color: "#586b62", fontSize: 12, lineHeight: 1.4 }}>
                    {s.description || tr("აღწერის გარეშე", "No description provided.")}
                  </p>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 18,
                    paddingTop: 12,
                    borderTop: "1px solid var(--line)",
                    fontSize: 11,
                    color: "#84938b",
                  }}
                >
                  <span>{new Date(s.created_at).toLocaleDateString()}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--green)", fontWeight: 600 }}>
                    <span>{tr("გახსნა", "Open")}</span>
                    <ArrowRight size={12} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Study Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 className="modal-title">{tr("ახალი კვლევის შექმნა", "Create Scientific Study")}</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ color: "#64748b" }}>
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

                {/* Mode Selector */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button
                    type="button"
                    className={`btn-secondary ${createMode === "blank" ? "active" : ""}`}
                    onClick={() => setCreateMode("blank")}
                    style={{
                      justifyContent: "flex-start",
                      padding: 12,
                      background: createMode === "blank" ? "#eef5f1" : "#fff",
                      borderColor: createMode === "blank" ? "#92b8a7" : undefined,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "#1a2c26" }}>{tr("სუფთა კვლევა (Blank)", "Blank Study")}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{tr("ცარიელი პარამეტრებითა და შეზღუდვებით", "Configure space & constraints from scratch")}</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`btn-secondary ${createMode === "template" ? "active" : ""}`}
                    onClick={() => setCreateMode("template")}
                    style={{
                      justifyContent: "flex-start",
                      padding: 12,
                      background: createMode === "template" ? "#eef5f1" : "#fff",
                      borderColor: createMode === "template" ? "#92b8a7" : undefined,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "#1a2c26" }}>{tr("შაბლონიდან (Template)", "From Template")}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{tr("წინასწარ მომზადებული სამეცნიერო სცენარი", "Tunnel blast or drug discovery")}</div>
                    </div>
                  </button>
                </div>

                {createMode === "template" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
                    <div className="form-group">
                      <label className="form-label">{tr("აირჩიეთ შაბლონი", "Select Template")}</label>
                      <select
                        className="form-select"
                        value={selectedTemplate}
                        onChange={(e) => setSelectedTemplate(e.target.value as any)}
                      >
                        <option value="microchannel_cold_plate">
                          {tr("მიკროარხული გამაგრილებელი ფილა (Microchannel Cold Plate — Physics)", "Microchannel Cold Plate (Physics & Heat Transfer)")}
                        </option>
                        <option value="tunnel_blast">
                          {tr("გვირაბში აფეთქების ჩახშობა (Tunnel Blast Mitigation — Physics)", "Tunnel Blast Mitigation (Physics)")}
                        </option>
                        <option value="drug_screen">
                          {tr("პრეპარატების ადრეული სკრინინგი (Early-stage Drug Screen — Chemistry/Biology)", "Early-stage Drug Screen (Chemistry/Biology)")}
                        </option>
                      </select>
                    </div>

                    <div style={{ padding: 12, background: "#f8faf8", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "#1e6350", marginBottom: 4 }}>
                        <FileText size={14} />
                        <span>
                          {selectedTemplate === "microchannel_cold_plate"
                            ? "Microchannel Cold Plate Optimization (Physics)"
                            : selectedTemplate === "tunnel_blast"
                            ? "Tunnel Blast Mitigation (Physics)"
                            : "Early-stage Drug Screen (Lipinski Rules)"}
                        </span>
                      </div>
                      <p style={{ margin: 0, color: "#586b62", lineHeight: 1.4 }}>
                        {selectedTemplate === "microchannel_cold_plate"
                          ? tr(
                              "პარამეტრები: channel_width (0.15–1.0 mm), fin_thickness (0.15–0.8 mm), aspect_ratio (2–10), flow_velocity (0.3–3.0 m/s), heat_flux (80–220 W/cm²). შედეგები: t_junction < 75 °C, pressure_drop < 40 kPa. შეზღუდვები: aspect_ratio <= 8.5, pitch >= 0.35 mm.",
                              "Parameters: channel_width (0.15–1.0 mm), fin_thickness (0.15–0.8 mm), aspect_ratio (2–10), flow_velocity (0.3–3.0 m/s), heat_flux (80–220 W/cm²). Outcomes: t_junction < 75 °C, pressure_drop < 40 kPa. Constraints: aspect_ratio <= 8.5, pitch >= 0.35 mm."
                            )
                          : selectedTemplate === "tunnel_blast"
                          ? tr(
                              "პარამეტრები: droplet (10–1000 µm), flow (1–150 L/min), nozzles (1–24), mist_lead (0–1 s). შედეგი: peak_pressure < 8000 Pa. შეზღუდვა: flow * nozzles <= 600 (ტუმბოს სიმძლავრე).",
                              "Parameters: droplet (10–1000 µm), flow (1–150 L/min), nozzles (1–24), mist_lead (0–1 s). Outcome: peak_pressure < 8000 Pa. Constraint: flow * nozzles <= 600 (pump rating)."
                            )
                          : tr(
                              "პარამეტრები: mw (Da), logp, hbd, hba. შედეგი: toxic == 0. შეზღუდვები: ლიპინსკის ხუთის წესი (mw <= 500, logp <= 5, hbd <= 5, hba <= 10).",
                              "Parameters: mw (Da), logp, hbd, hba. Outcome: toxic == 0. Constraints: Lipinski rule of five (mw <= 500, logp <= 5, hbd <= 5, hba <= 10)."
                            )}
                      </p>
                      <div style={{ marginTop: 8, fontSize: 11, color: "#b45309", background: "#fef3c7", padding: "4px 8px", borderRadius: 4 }}>
                        <strong>{tr("შენიშვნა:", "Notice:")}</strong>{" "}
                        {tr(
                          "შაბლონში მოცემული რიცხვები საილუსტრაციოა — ჩაანაცვლეთ თქვენი საკუთარი ლაბორატორიული ან საველე მონაცემებით.",
                          "Template values are unvalidated example placeholders — replace with your own laboratory or field values."
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="form-group">
                      <label className="form-label">{tr("კვლევის სახელი", "Study Name")}</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Tunnel Methane Blast Screening Trial 2"
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
                        placeholder="e.g. Statistical screening of water-mist suppression setups against flame front acceleration"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">{tr("სფერო (Domain)", "Domain")}</label>
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
                          {tr("გამორიცხვის ზღვარი (τ)", "Exclusion (τ)")}
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
                  </>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                  {tr("გაუქმება", "Cancel")}
                </button>
                <button type="submit" className="btn-primary">
                  {tr("შექმნა", "Create Study")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
