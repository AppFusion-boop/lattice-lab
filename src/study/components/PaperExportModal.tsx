import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  Download,
  Copy,
  Printer,
  FileText,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  BookOpen,
  Eye,
  Sliders,
  Sparkles,
  Maximize2,
  Minimize2,
  ZoomIn,
  Edit3,
  HelpCircle,
  FileCode,
  Layers,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Database,
  BarChart2,
  ExternalLink,
} from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import type { Study, PaperResponse, AuthorMeta, PaperCustomizationRequest } from "../api/types";
import { tr } from "../../i18n";
import "./paper.css";

interface PaperExportModalProps {
  study: Study;
  isOpen: boolean;
  onClose: () => void;
}

type EditorTab =
  | "metadata"
  | "abstract"
  | "intro"
  | "dimensional"
  | "methods"
  | "results"
  | "discussion"
  | "conclusions"
  | "assets";

type ViewMode = "split" | "preview" | "editor";

interface FigureDeckItem {
  id: string;
  name: string;
  title: string;
  caption: string;
  token: string;
  svgUrl: string;
  pngUrl: string;
}

export function PaperExportModal({ study, isOpen, onClose }: PaperExportModalProps) {
  const [loading, setLoading] = useState(false);
  const [syncingData, setSyncingData] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<PaperResponse | null>(null);

  // Editor navigation
  const [activeTab, setActiveTab] = useState<EditorTab>("metadata");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [resolvedPreview, setResolvedPreview] = useState(false);

  // Lightbox modal for figure zoom
  const [lightbox, setLightbox] = useState<{ src: string; title: string; caption: string } | null>(null);

  // Metadata state
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<"standard" | "revtex" | "nature" | "ieee">("standard");
  const [columnLayout, setColumnLayout] = useState<"twocolumn" | "onecolumn">("twocolumn");
  const [includeFigures, setIncludeFigures] = useState(true);
  const [authors, setAuthors] = useState<AuthorMeta[]>([
    {
      name: "Principal Investigator",
      affiliation: "Computational Physical Laboratory & Systems Engineering",
      email: "investigator@lab.local",
      orcid: "0000-0002-1825-0097",
      is_corresponding: true,
    },
  ]);
  const [abstractText, setAbstractText] = useState("");

  // Section custom narrative overrides
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, string>>({});
  const [autoDraftSections, setAutoDraftSections] = useState<Record<string, string>>({});

  const [copiedTex, setCopiedTex] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  // Active textarea ref for cursor-aware insertion
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Storage key
  const storageKey = `lattice_paper_draft_${study.id}`;

  // Initial load
  useEffect(() => {
    if (!isOpen) return;
    loadPaper();
  }, [isOpen, study.id]);

  const loadPaper = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<PaperResponse>(`/studies/${study.id}/paper`);
      setPaper(res);

      // Cache the initial auto-generated text
      const initialMap: Record<string, string> = {};
      res.sections.forEach((s) => {
        initialMap[s.id] = s.content_markdown;
      });
      setAutoDraftSections(initialMap);

      // Check if user had a saved draft in localStorage
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.title) setTitle(parsed.title);
          else setTitle(res.title);

          if (parsed.abstract) setAbstractText(parsed.abstract);
          else setAbstractText(res.abstract);

          if (parsed.authors && parsed.authors.length > 0) setAuthors(parsed.authors);
          else if (res.authors && res.authors.length > 0) setAuthors(res.authors);

          if (parsed.template) setTemplate(parsed.template);
          if (parsed.columnLayout) setColumnLayout(parsed.columnLayout);
          if (parsed.sectionOverrides) setSectionOverrides(parsed.sectionOverrides);
          return;
        } catch {
          // Fall back to freshly generated paper
        }
      }

      // Default state from server
      setTitle(res.title);
      setAbstractText(res.abstract);
      if (res.authors && res.authors.length > 0) {
        setAuthors(res.authors);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load paper manuscript");
    } finally {
      setLoading(false);
    }
  };

  // Auto-save local draft whenever user edits text
  useEffect(() => {
    if (!paper) return;
    const draftData = {
      title,
      abstract: abstractText,
      authors,
      template,
      columnLayout,
      sectionOverrides,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(draftData));
      setDraftSaved(true);
      const timer = setTimeout(() => setDraftSaved(false), 1500);
      return () => clearTimeout(timer);
    } catch {
      // Storage quota or disabled
    }
  }, [title, abstractText, authors, template, columnLayout, sectionOverrides, paper, storageKey]);

  // Sync preview with server with optional notification
  const handleUpdatePreview = async (overridesToUse = sectionOverrides, isManualSync = false) => {
    if (isManualSync) setSyncingData(true);
    else setLoading(true);
    setError(null);
    try {
      const req: PaperCustomizationRequest = {
        title: title || undefined,
        authors,
        template,
        column_layout: columnLayout,
        include_figures: includeFigures,
        include_supplementary: true,
        abstract_override: abstractText || undefined,
        section_overrides: overridesToUse,
      };
      const res = await apiPost<PaperResponse>(`/studies/${study.id}/paper/preview`, req);
      setPaper(res);

      if (isManualSync) {
        setSyncNotice("✓ Live charts, tables & metrics re-computed from latest study data!");
        setTimeout(() => setSyncNotice(null), 3000);
      }
    } catch (e: any) {
      setError(e.message || "Failed to update manuscript preview");
    } finally {
      setLoading(false);
      setSyncingData(false);
    }
  };

  const handleSectionTextChange = (secId: string, text: string) => {
    const updated = { ...sectionOverrides, [secId]: text };
    setSectionOverrides(updated);
  };

  const handleResetSection = (secId: string) => {
    const autoText = autoDraftSections[secId] || "";
    const updated = { ...sectionOverrides };
    delete updated[secId];
    setSectionOverrides(updated);
    handleUpdatePreview(updated);
  };

  const handleResetAllToAuto = () => {
    if (window.confirm("Reset all customized narrative text back to the auto-generated scientific baseline?")) {
      localStorage.removeItem(storageKey);
      setSectionOverrides({});
      loadPaper();
    }
  };

  // Cursor-aware insertion helper
  const insertTextAtCursor = (textToInsert: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      // Fallback: append
      if (activeTab === "abstract") {
        setAbstractText((prev) => prev + " " + textToInsert);
      } else {
        const cur = sectionOverrides[activeTab] ?? autoDraftSections[activeTab] ?? "";
        handleSectionTextChange(activeTab, cur + " " + textToInsert);
      }
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;
    const nextVal = currentVal.substring(0, start) + textToInsert + currentVal.substring(end);

    if (activeTab === "abstract") {
      setAbstractText(nextVal);
    } else {
      handleSectionTextChange(activeTab, nextVal);
    }

    // Restore cursor position after the inserted text
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
    }, 10);
  };

  // Wrap selected text (e.g. for bold, italic, math)
  const wrapSelectedText = (before: string, after: string, defaultPlaceholder: string = "text") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;
    const selected = currentVal.substring(start, end) || defaultPlaceholder;
    const replacement = before + selected + after;
    const nextVal = currentVal.substring(0, start) + replacement + currentVal.substring(end);

    if (activeTab === "abstract") {
      setAbstractText(nextVal);
    } else {
      handleSectionTextChange(activeTab, nextVal);
    }

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 10);
  };

  const handleAddAuthor = () => {
    setAuthors([
      ...authors,
      {
        name: `Co-Author ${authors.length + 1}`,
        affiliation: authors[0]?.affiliation || "Research Department",
        email: "",
        orcid: "",
        is_corresponding: false,
      },
    ]);
  };

  const handleRemoveAuthor = (idx: number) => {
    if (authors.length <= 1) return;
    setAuthors(authors.filter((_, i) => i !== idx));
  };

  const handleAuthorChange = (idx: number, field: keyof AuthorMeta, value: any) => {
    const updated = [...authors];
    updated[idx] = { ...updated[idx], [field]: value };
    setAuthors(updated);
  };

  const handleDownloadCustomZip = async () => {
    const req: PaperCustomizationRequest = {
      title: title || undefined,
      authors,
      template,
      column_layout: columnLayout,
      include_figures: includeFigures,
      include_supplementary: true,
      abstract_override: abstractText || undefined,
      section_overrides: sectionOverrides,
    };
    try {
      const response = await fetch(`/api/v1/studies/${study.id}/paper.zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!response.ok) throw new Error("Failed to compile customized LaTeX ZIP bundle");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `paper_${study.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20)}_bundle.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message || "Download failed");
    }
  };

  const handleDownloadCustomTex = async () => {
    const req: PaperCustomizationRequest = {
      title: title || undefined,
      authors,
      template,
      column_layout: columnLayout,
      include_figures: includeFigures,
      include_supplementary: true,
      abstract_override: abstractText || undefined,
      section_overrides: sectionOverrides,
    };
    try {
      const response = await fetch(`/api/v1/studies/${study.id}/paper.tex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!response.ok) throw new Error("Failed to compile customized LaTeX file");
      const text = await response.text();
      const blob = new Blob([text], { type: "text/x-tex;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `paper_${study.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20)}.tex`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message || "Download failed");
    }
  };

  const handleCopyTex = async () => {
    if (!paper?.latex) return;
    await navigator.clipboard.writeText(paper.latex);
    setCopiedTex(true);
    setTimeout(() => setCopiedTex(false), 2000);
  };

  const handleCopyMd = async () => {
    if (!paper?.markdown) return;
    await navigator.clipboard.writeText(paper.markdown);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2000);
  };

  // Figure deck definition
  const figureDeck: FigureDeckItem[] = useMemo(
    () => [
      {
        id: "fig_funnel",
        name: "Figure 1",
        title: "Screening Funnel & Statistical Exclusion",
        caption:
          "Multi-stage candidate retention and exclusion audit with conformal confidence bounds and physical constraints.",
        token: "{{fig:funnel}}",
        svgUrl: `/api/v1/studies/${study.id}/paper/figures/funnel.svg`,
        pngUrl: `/api/v1/studies/${study.id}/paper/figures/funnel.png`,
      },
      {
        id: "fig_phase_space",
        name: "Figure 2",
        title: "Candidate Phase Space & Feasibility",
        caption:
          "Candidate classification across primary controlled coordinates, demarcating viable operating envelope.",
        token: "{{fig:phase_space}}",
        svgUrl: `/api/v1/studies/${study.id}/paper/figures/phase_space.svg`,
        pngUrl: `/api/v1/studies/${study.id}/paper/figures/phase_space.png`,
      },
      {
        id: "fig_sensitivity",
        name: "Figure 3",
        title: "Global Sobol Sensitivity Ranking",
        caption:
          "Variance-based sensitivity indices ranking dominant physical parameters dictating outcome variability.",
        token: "{{fig:sensitivity}}",
        svgUrl: `/api/v1/studies/${study.id}/paper/figures/sensitivity.svg`,
        pngUrl: `/api/v1/studies/${study.id}/paper/figures/sensitivity.png`,
      },
      {
        id: "fig_pareto",
        name: "Figure 4",
        title: "Multi-Objective Pareto Trade-off",
        caption:
          "Non-dominated trade-off manifold highlighting recommended optimal experimental candidate batch.",
        token: "{{fig:pareto}}",
        svgUrl: `/api/v1/studies/${study.id}/paper/figures/pareto.svg`,
        pngUrl: `/api/v1/studies/${study.id}/paper/figures/pareto.png`,
      },
    ],
    [study.id]
  );

  // Client-side token resolver for Live Preview
  const resolveTokens = (text: string): string => {
    if (!text) return "";
    let res = text;
    const tokenMap: Record<string, string> = {
      study_name: study.name,
      domain: study.domain,
      confidence: `${Math.round(study.confidence * 100)}%`,
      confidence_fraction: `${study.confidence}`,
      threshold: `${study.exclusion_threshold}`,
      rng_seed: `${study.rng_seed}`,
      master_seed: `${paper?.master_seed ?? study.rng_seed}`,
      evidence_fingerprint: paper?.evidence_fingerprint?.slice(0, 10) ?? "none",
      "fig:funnel": "Figure 1",
      "fig:phase_space": "Figure 2",
      "fig:sensitivity": "Figure 3",
      "fig:pareto": "Figure 4",
      "tab:parameters": "Table 1",
      "tab:outcomes": "Table 2",
      "tab:funnel": "Table 3",
      "tab:recommended": "Table 4",
    };
    Object.entries(tokenMap).forEach(([k, v]) => {
      res = res.replaceAll(`{{${k}}}`, v);
    });
    return res;
  };

  const getSectionText = (secId: string): string => {
    return sectionOverrides[secId] ?? autoDraftSections[secId] ?? "";
  };

  const sectionsNav: { id: EditorTab; title: string; short: string; isNum?: boolean }[] = [
    { id: "metadata", title: "Title & Authors (Setup)", short: "Setup" },
    { id: "abstract", title: "Abstract Narrative", short: "Abstract" },
    { id: "intro", title: "1. Introduction (Physical Problem)", short: "1", isNum: true },
    { id: "dimensional", title: "2. Theory & Buckingham Π", short: "2", isNum: true },
    { id: "methods", title: "3. Computational Methods", short: "3", isNum: true },
    { id: "results", title: "4. Results & Screening Audit", short: "4", isNum: true },
    { id: "discussion", title: "5. Discussion & Limitations", short: "5", isNum: true },
    { id: "conclusions", title: "6. Conclusions & Future Work", short: "6", isNum: true },
    { id: "assets", title: "Figures & Tables Deck", short: "Figures" },
  ];

  const currentNavIndex = sectionsNav.findIndex((s) => s.id === activeTab);
  const handlePrevSection = () => {
    if (currentNavIndex > 0) setActiveTab(sectionsNav[currentNavIndex - 1].id);
  };
  const handleNextSection = () => {
    if (currentNavIndex < sectionsNav.length - 1) setActiveTab(sectionsNav[currentNavIndex + 1].id);
  };

  const isCustomized = (tabId: EditorTab) => {
    if (tabId === "metadata") return false;
    if (tabId === "abstract") return Boolean(abstractText && abstractText !== (autoDraftSections["abstract"] ?? ""));
    if (tabId === "assets") return false;
    return Boolean(sectionOverrides[tabId]);
  };

  if (!isOpen) return null;

  return (
    <div className="paper-modal-overlay">
      <div className="paper-modal-container">
        {/* Top Studio Bar */}
        <header className="paper-studio-header paper-no-print">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BookOpen size={20} color="#0284c7" />
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>
                  {tr("მეცნიერული სტატიის სტუდია", "Scientific Paper Studio")}
                </h2>
                <div style={{ fontSize: 10, color: "#64748b" }}>
                  Defensible Peer-Reviewed Manuscript & Preprints (IMRaD)
                </div>
              </div>
            </div>

            {/* Live Data Sync Indicator */}
            <div className="paper-live-bar" title="Live data binding ensures all figures, tables and bounds update dynamically when experiments change">
              <span className="paper-pulse-dot" />
              <span>
                <strong>{tr("ცოცხალი მონაცემები", "Live Data Bound")}:</strong>{" "}
                {study.domain} • Seed: <code>{study.rng_seed}</code> • Conf:{" "}
                <strong>{Math.round(study.confidence * 100)}%</strong>
              </span>
            </div>

            {/* Manual Sync Button */}
            <button
              type="button"
              className="paper-fig-action-btn"
              onClick={() => handleUpdatePreview(sectionOverrides, true)}
              disabled={syncingData || loading}
              style={{ background: "#ffffff", borderColor: "#a7f3d0", color: "#047857", fontWeight: 600 }}
              title="Re-query experiment results, candidates, and charts from database without altering your written narrative"
            >
              <RefreshCw size={12} className={syncingData ? "spin" : ""} />
              <span>{syncingData ? tr("მონაცემები ახლდება...", "Syncing...") : tr("ცოცხალი მონაცემების განახლება", "Sync Live Data")}</span>
            </button>

            {syncNotice && (
              <span style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>{syncNotice}</span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* View Mode Toggle */}
            <div className="paper-toggle-group">
              <button
                className={`paper-toggle-btn ${viewMode === "split" ? "active" : ""}`}
                onClick={() => setViewMode("split")}
                type="button"
                title="Editor and Manuscript side-by-side"
              >
                <Sliders size={12} />
                <span>Split Studio</span>
              </button>
              <button
                className={`paper-toggle-btn ${viewMode === "preview" ? "active" : ""}`}
                onClick={() => setViewMode("preview")}
                type="button"
                title="Full manuscript reading and print view"
              >
                <Eye size={12} />
                <span>Manuscript</span>
              </button>
              <button
                className={`paper-toggle-btn ${viewMode === "editor" ? "active" : ""}`}
                onClick={() => setViewMode("editor")}
                type="button"
                title="Focus writing mode"
              >
                <Edit3 size={12} />
                <span>Editor</span>
              </button>
            </div>

            {/* Quick Export Button */}
            <button
              className="btn-primary"
              onClick={handleDownloadCustomZip}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 12,
                background: "#0284c7",
                borderColor: "#0284c7",
              }}
              title="Download full LaTeX bundle (.zip) ready for Overleaf with all figures, tables and BibTeX"
            >
              <Download size={13} />
              <span>Overleaf (.zip)</span>
            </button>

            <button
              onClick={onClose}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 6,
                color: "#64748b",
                borderRadius: 4,
              }}
              title="Close Studio"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Studio Body */}
        <div className="paper-studio-body">
          {/* Left Editor Sidebar */}
          {(viewMode === "split" || viewMode === "editor") && (
            <div className={`paper-sidebar ${viewMode === "editor" ? "paper-sidebar-fullscreen" : ""} paper-no-print`}>
              {/* In Dedicated Full-Width Editor Mode: Display full descriptive tab names since they fit easily */}
              {viewMode === "editor" ? (
                <div className="paper-editor-full-tabs">
                  {sectionsNav.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`paper-full-tab-btn ${activeTab === s.id ? "active" : ""}`}
                      onClick={() => setActiveTab(s.id)}
                    >
                      {s.id === "assets" && <BarChart2 size={13} style={{ display: "inline", marginRight: 4 }} />}
                      <span>{s.title}</span>
                      {isCustomized(s.id) && <span className="paper-tab-dot-custom" />}
                    </button>
                  ))}
                </div>
              ) : (
                /* Split View: Compact non-overflowing strip + stepper dropdown */
                <>
                  <div className="paper-nav-strip">
                    <div className="paper-nav-group">
                      <button
                        type="button"
                        className={`paper-nav-pill ${activeTab === "metadata" ? "active" : ""}`}
                        onClick={() => setActiveTab("metadata")}
                        title="Manuscript setup, template, authors"
                      >
                        Setup
                      </button>
                      <button
                        type="button"
                        className={`paper-nav-pill ${activeTab === "abstract" ? "active" : ""}`}
                        onClick={() => setActiveTab("abstract")}
                        title="Abstract narrative"
                      >
                        {isCustomized("abstract") && <span className="paper-nav-dot" style={{ position: "static", width: 4, height: 4 }} />}
                        Abstract
                      </button>
                    </div>

                    <div className="paper-nav-divider" />

                    {/* Numbered section buttons 1 to 6 */}
                    <div className="paper-nav-group">
                      {(["intro", "dimensional", "methods", "results", "discussion", "conclusions"] as EditorTab[]).map((id, i) => (
                        <button
                          key={id}
                          type="button"
                          className={`paper-nav-num-pill ${activeTab === id ? "active" : ""}`}
                          onClick={() => setActiveTab(id)}
                          title={sectionsNav.find((s) => s.id === id)?.title}
                        >
                          {i + 1}
                          {isCustomized(id) && <span className="paper-nav-dot" />}
                        </button>
                      ))}
                    </div>

                    <div className="paper-nav-divider" />

                    <button
                      type="button"
                      className={`paper-nav-pill ${activeTab === "assets" ? "active" : ""}`}
                      onClick={() => setActiveTab("assets")}
                      title="View publication figures and tables deck"
                    >
                      <BarChart2 size={11} />
                      <span>Figures</span>
                    </button>
                  </div>

                  {/* Breadcrumb & Stepper Header */}
                  <div className="paper-section-stepper-bar">
                    <button
                      type="button"
                      className="paper-stepper-btn"
                      onClick={handlePrevSection}
                      disabled={currentNavIndex === 0}
                      title="Previous section"
                    >
                      <ChevronLeft size={14} />
                    </button>

                    <select
                      className="paper-section-select"
                      value={activeTab}
                      onChange={(e) => setActiveTab(e.target.value as EditorTab)}
                    >
                      <optgroup label="Manuscript Setup">
                        <option value="metadata">Title & Authors (Setup)</option>
                        <option value="abstract">Abstract Narrative</option>
                      </optgroup>
                      <optgroup label="Scientific Sections (IMRaD)">
                        <option value="intro">1. Introduction (Physical Problem)</option>
                        <option value="dimensional">2. Theory & Buckingham Π Scaling</option>
                        <option value="methods">3. Computational Methods</option>
                        <option value="results">4. Results & Screening Audit</option>
                        <option value="discussion">5. Discussion & Limitations</option>
                        <option value="conclusions">6. Conclusions & Next Steps</option>
                      </optgroup>
                      <optgroup label="Data & Visual Assets">
                        <option value="assets">Figures & Tables Deck</option>
                      </optgroup>
                    </select>

                    <button
                      type="button"
                      className="paper-stepper-btn"
                      onClick={handleNextSection}
                      disabled={currentNavIndex === sectionsNav.length - 1}
                      title="Next section"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </>
              )}

              {/* Section Editor Body */}
              <div className="paper-sidebar-content">
                {/* Tab: Metadata & Authors */}
                {activeTab === "metadata" && (
                  <>
                    <div>
                      <label className="paper-field-label">{tr("სტატიის სათაური", "Manuscript Title")}</label>
                      <textarea
                        className="paper-field-input"
                        rows={2}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Manuscript Title..."
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label className="paper-field-label">{tr("ჟურნალის შაბლონი", "Journal Template")}</label>
                        <select
                          className="paper-field-input"
                          value={template}
                          onChange={(e) => setTemplate(e.target.value as any)}
                        >
                          <option value="standard">Standard Article (generic)</option>
                          <option value="revtex">Phys. Rev. (APS RevTeX 4-2)</option>
                          <option value="nature">Nature / Springer format</option>
                          <option value="ieee">IEEE Transactions</option>
                        </select>
                      </div>

                      <div>
                        <label className="paper-field-label">{tr("სვეტების განლაგება", "Column Format")}</label>
                        <div className="paper-toggle-group">
                          <button
                            className={`paper-toggle-btn ${columnLayout === "twocolumn" ? "active" : ""}`}
                            onClick={() => setColumnLayout("twocolumn")}
                            type="button"
                          >
                            2-Column
                          </button>
                          <button
                            className={`paper-toggle-btn ${columnLayout === "onecolumn" ? "active" : ""}`}
                            onClick={() => setColumnLayout("onecolumn")}
                            type="button"
                          >
                            1-Column
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
                        {tr("ჩართე ვექტორული გრაფიკები (300 DPI)", "Embed Vector Figures (300 DPI)")}
                      </span>
                      <input
                        type="checkbox"
                        checked={includeFigures}
                        onChange={(e) => setIncludeFigures(e.target.checked)}
                        style={{ cursor: "pointer" }}
                      />
                    </div>

                    {/* Authors List */}
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <label className="paper-field-label" style={{ margin: 0 }}>
                          {tr("ავტორები და აფილიაციები", "Authors & Affiliations")} ({authors.length})
                        </label>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleAddAuthor}
                          style={{ padding: "2px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <Plus size={11} />
                          <span>Add Author</span>
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 220, overflowY: "auto" }}>
                        {authors.map((auth, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: 10,
                              background: "#f8fafc",
                              border: "1px solid #e2e8f0",
                              borderRadius: 4,
                              fontSize: 12,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <input
                                className="paper-field-input"
                                style={{ fontWeight: 600, padding: "3px 6px", fontSize: 12 }}
                                value={auth.name}
                                onChange={(e) => handleAuthorChange(idx, "name", e.target.value)}
                                placeholder="Author Full Name"
                              />
                              {authors.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAuthor(idx)}
                                  style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", padding: 2 }}
                                  title="Remove author"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                            <input
                              className="paper-field-input"
                              style={{ fontSize: 11, padding: "3px 6px", marginBottom: 4 }}
                              value={auth.affiliation}
                              onChange={(e) => handleAuthorChange(idx, "affiliation", e.target.value)}
                              placeholder="Institution / Department"
                            />
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                              <input
                                className="paper-field-input"
                                style={{ fontSize: 10.5, padding: "2px 5px" }}
                                value={auth.email}
                                onChange={(e) => handleAuthorChange(idx, "email", e.target.value)}
                                placeholder="Email"
                              />
                              <input
                                className="paper-field-input"
                                style={{ fontSize: 10.5, padding: "2px 5px" }}
                                value={auth.orcid}
                                onChange={(e) => handleAuthorChange(idx, "orcid", e.target.value)}
                                placeholder="ORCID (0000-...)"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Tab: Abstract */}
                {activeTab === "abstract" && (
                  <>
                    <div className="paper-binding-callout">
                      <strong>⚡ {tr("ანოტაციის რედაქტორი & მონაცემთა კავშირი", "Abstract Synthesizer & Reactive Tokens")}</strong>
                      <span>
                        {tr(
                          "აკავშირებს ბუკინგემის Π ჯგუფებს, კონფორმულ ალგორითმს და კანდიდატების სკრინინგის შედეგებს. გამოიყენეთ დინამიური ცვლადები (მაგ. {{confidence}}, {{rng_seed}}) რათა მონაცემების ცვლილებისას რიცხვები ავტომატურად განახლდეს.",
                          "Connects Buckingham Π similitude, conformal inference, and screening numbers. Use dynamic tokens (e.g. {{confidence}}, {{rng_seed}}) so values auto-update when experiments change."
                        )}
                      </span>
                    </div>

                    {/* Token toolbar for abstract */}
                    <LiveTokensBar
                      study={study}
                      paper={paper}
                      onInsertToken={(tok) => insertTextAtCursor(tok)}
                    />

                    <div>
                      <div className="paper-editor-toolbar">
                        <div className="paper-toolbar-btn-group">
                          <button
                            type="button"
                            className="paper-tool-btn"
                            onClick={() => wrapSelectedText("**", "**", "bold")}
                            title="Bold text"
                          >
                            <strong>B</strong>
                          </button>
                          <button
                            type="button"
                            className="paper-tool-btn"
                            onClick={() => wrapSelectedText("*", "*", "italic")}
                            title="Italic text"
                          >
                            <em>I</em>
                          </button>
                          <button
                            type="button"
                            className="paper-tool-btn"
                            onClick={() => wrapSelectedText("$", "$", "E = mc^2")}
                            title="Inline math"
                          >
                            $x$
                          </button>
                          <button
                            type="button"
                            className="paper-tool-btn"
                            onClick={() => insertTextAtCursor("[@buckingham1914]")}
                            title="Insert citation"
                          >
                            [@cite]
                          </button>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className={`paper-tool-btn ${resolvedPreview ? "active" : ""}`}
                            onClick={() => setResolvedPreview(!resolvedPreview)}
                            style={{ fontSize: 10.5, display: "flex", alignItems: "center", gap: 4 }}
                          >
                            <Eye size={11} />
                            <span>{resolvedPreview ? "Edit Mode" : "Preview with Values"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAbstractText(paper?.abstract || "")}
                            style={{ border: "none", background: "none", color: "#0284c7", fontSize: 10.5, cursor: "pointer" }}
                          >
                            Reset Auto
                          </button>
                        </div>
                      </div>

                      {resolvedPreview ? (
                        <div className="paper-resolved-preview">{resolveTokens(abstractText)}</div>
                      ) : (
                        <textarea
                          ref={textareaRef}
                          className="paper-textarea"
                          rows={11}
                          value={abstractText}
                          onChange={(e) => setAbstractText(e.target.value)}
                          placeholder="Abstract narrative with live {{tokens}}..."
                        />
                      )}
                    </div>
                  </>
                )}

                {/* Tabs for Sections 1 to 6 */}
                {["intro", "dimensional", "methods", "results", "discussion", "conclusions"].includes(activeTab) && (
                  <SectionEditorPanel
                    secId={activeTab}
                    study={study}
                    paper={paper}
                    textValue={getSectionText(activeTab)}
                    isCustomized={Boolean(sectionOverrides[activeTab])}
                    resolvedPreview={resolvedPreview}
                    onToggleResolvedPreview={() => setResolvedPreview(!resolvedPreview)}
                    onChange={(val) => handleSectionTextChange(activeTab, val)}
                    onReset={() => handleResetSection(activeTab)}
                    onInsertToken={(tok) => insertTextAtCursor(tok)}
                    onWrapText={(b, a, ph) => wrapSelectedText(b, a, ph)}
                    textareaRef={textareaRef}
                    figureDeck={figureDeck}
                    onZoomFigure={(fig) => setLightbox({ src: fig.pngUrl, title: fig.title, caption: fig.caption })}
                  />
                )}

                {/* Tab: Figures & Data Assets Deck */}
                {activeTab === "assets" && (
                  <div className="paper-figures-deck">
                    <div className="paper-binding-callout">
                      <strong>⚡ {tr("ცოცხალი სამეცნიერო გრაფიკები & ცხრილები", "Live Scientific Figures & Data Assets")}</strong>
                      <span>
                        {tr(
                          "ყველა გრაფიკი გენერირდება უშუალოდ კვლევის მონაცემთა ბაზიდან (300 DPI / SVG ვექტორი). ექსპერიმენტის განახლებისას გრაფიკები ავტომატურად იცვლება.",
                          "All figures are rendered directly from active study candidates, physical evidence, and sensitivity runs. Updating experiments updates these charts instantly."
                        )}
                      </span>
                    </div>

                    {figureDeck.map((fig) => (
                      <div key={fig.id} className="paper-deck-card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 12.5, color: "#0f172a" }}>
                              {fig.name}: {fig.title}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{fig.caption}</div>
                          </div>
                          <span style={{ fontSize: 10, background: "#ecfdf5", color: "#065f46", padding: "2px 6px", borderRadius: 3, fontWeight: 600 }}>
                            Live Bound
                          </span>
                        </div>

                        <img
                          src={fig.pngUrl}
                          alt={fig.title}
                          className="paper-deck-thumb"
                          onClick={() => setLightbox({ src: fig.pngUrl, title: fig.title, caption: fig.caption })}
                          title="Click to zoom high-resolution chart"
                        />

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                          <button
                            type="button"
                            className="paper-fig-action-btn"
                            onClick={() => {
                              setActiveTab("results");
                              insertTextAtCursor(` ${fig.token} `);
                            }}
                            title={`Insert reference token ${fig.token} in Results section`}
                          >
                            <Plus size={11} />
                            <span>Insert Reference ({fig.name})</span>
                          </button>

                          <div style={{ display: "flex", gap: 6 }}>
                            <a href={fig.svgUrl} download={`${fig.id}.svg`} className="paper-fig-action-btn" title="Publication vector SVG">
                              Vector SVG
                            </a>
                            <a href={fig.pngUrl} download={`${fig.id}.png`} className="paper-fig-action-btn" title="300 DPI raster PNG">
                              300 DPI PNG
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action to update live preview */}
                <button
                  className="btn-secondary"
                  onClick={() => handleUpdatePreview()}
                  disabled={loading}
                  style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: "auto" }}
                >
                  <RefreshCw size={13} className={loading ? "spin" : ""} />
                  <span>{tr("პრევიუს განახლება", "Update Manuscript Preview")}</span>
                </button>
              </div>

              {/* Sidebar Footer with Export Actions */}
              <div className="paper-sidebar-footer">
                <button
                  className="btn-primary"
                  onClick={handleDownloadCustomZip}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: "#0284c7",
                    borderColor: "#0284c7",
                  }}
                  title="Download complete LaTeX bundle with figures, tables, and BibTeX for Overleaf"
                >
                  <Download size={14} />
                  <span>{tr("LaTeX პაკეტის ჩამოტვირთვა (.zip)", "Download LaTeX Package (.zip)")}</span>
                </button>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button className="btn-secondary" onClick={() => window.print()}>
                    <Printer size={13} />
                    <span>{tr("ბეჭდვა / PDF", "Print / Save PDF")}</span>
                  </button>

                  <button className="btn-secondary" onClick={handleDownloadCustomTex}>
                    <FileText size={13} />
                    <span>{tr(".tex ფაილი", "Download .tex")}</span>
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button className="btn-secondary" onClick={handleCopyTex}>
                    {copiedTex ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                    <span>{copiedTex ? "Copied!" : "Copy LaTeX"}</span>
                  </button>
                  <button className="btn-secondary" onClick={handleCopyMd}>
                    {copiedMd ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                    <span>{copiedMd ? "Copied!" : "Copy .md"}</span>
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#64748b" }}>
                  <span>{draftSaved ? "💾 Draft auto-saved" : "Draft saved"}</span>
                  <button
                    type="button"
                    onClick={handleResetAllToAuto}
                    style={{ border: "none", background: "none", color: "#64748b", textDecoration: "underline", cursor: "pointer" }}
                  >
                    Reset all to auto
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Right Paper Sheet Viewer */}
          {(viewMode === "split" || viewMode === "preview") && (
            <div className="paper-viewer-area">
              {loading && !paper && (
                <div style={{ margin: "auto", textAlign: "center", color: "#ffffff" }}>
                  <RefreshCw size={28} className="spin" style={{ marginBottom: 12 }} />
                  <p style={{ fontSize: 14 }}>Synthesizing scientific manuscript and live publication figures...</p>
                </div>
              )}

              {error && (
                <div style={{ margin: "auto", padding: 24, background: "#fee2e2", color: "#b91c1c", borderRadius: 6 }}>
                  {error}
                </div>
              )}

              {paper && (
                <div className="paper-sheet">
                  {/* Journal / Preprint Header */}
                  <div className="paper-journal-header">
                    <span>Lattice Lab Research Platform • Peer-Reviewed Manuscript Archive</span>
                    <span>Preprint • Deterministic Seed: {paper.master_seed}</span>
                  </div>

                  {/* Title */}
                  <h1 className="paper-title">{paper.title}</h1>

                  {/* Authors */}
                  <div className="paper-authors-list">
                    {paper.authors.map((auth, idx) => (
                      <span key={idx} className="paper-author-item">
                        {auth.name}
                        <sup>{idx + 1}</sup>
                        {auth.is_corresponding ? "*" : ""}
                        {idx < paper.authors.length - 1 ? "," : ""}
                      </span>
                    ))}
                  </div>

                  {/* Affiliations */}
                  <div className="paper-affiliations">
                    {paper.authors.map((auth, idx) => (
                      <div key={idx}>
                        <sup>{idx + 1}</sup> {auth.affiliation}
                        {auth.email ? ` • Email: ${auth.email}` : ""}
                        {auth.orcid ? ` • ORCID: ${auth.orcid}` : ""}
                      </div>
                    ))}
                  </div>

                  {/* Abstract Callout */}
                  <div className="paper-abstract-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div className="paper-abstract-title">Abstract</div>
                      <button
                        type="button"
                        className="paper-no-print"
                        onClick={() => {
                          setActiveTab("abstract");
                          if (viewMode === "preview") setViewMode("split");
                        }}
                        style={{ border: "none", background: "none", color: "#0284c7", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
                      >
                        <Edit3 size={10} />
                        <span>Edit Abstract</span>
                      </button>
                    </div>
                    <div style={{ textAlign: "justify" }}>{paper.abstract}</div>
                    <div className="paper-keywords">
                      <strong>Keywords: </strong>
                      {paper.keywords.join(", ")}
                    </div>
                  </div>

                  {/* Multi-column body text */}
                  <div className={paper.column_layout === "twocolumn" ? "paper-cols-2" : "paper-cols-1"}>
                    {paper.sections.map((sec) => (
                      <div key={sec.id} style={{ breakInside: "avoid-column" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <h2
                            className="paper-section-heading"
                            onClick={() => {
                              setActiveTab(sec.id as EditorTab);
                              if (viewMode === "preview") setViewMode("split");
                            }}
                            title="Click to edit section"
                          >
                            {sec.number}. {sec.title}
                          </h2>
                          <button
                            type="button"
                            className="paper-no-print"
                            onClick={() => {
                              setActiveTab(sec.id as EditorTab);
                              if (viewMode === "preview") setViewMode("split");
                            }}
                            style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", padding: "0 4px" }}
                            title="Edit this section in studio"
                          >
                            <Edit3 size={11} />
                          </button>
                        </div>

                        <div className="paper-body-text" style={{ whiteSpace: "pre-line" }}>
                          {sec.content_markdown}
                        </div>

                        {/* Embed Figure 1 after Section 4 */}
                        {sec.id === "results" && includeFigures && (
                          <div className="paper-figure-card">
                            <img
                              src={`/api/v1/studies/${study.id}/paper/figures/funnel.png`}
                              alt="Screening Funnel"
                              className="paper-figure-img"
                              onClick={() =>
                                setLightbox({
                                  src: `/api/v1/studies/${study.id}/paper/figures/funnel.png`,
                                  title: "Figure 1: Multi-Stage Screening Funnel",
                                  caption:
                                    "Quantifies candidate retention across physical constraints, statistical surrogates, and active down-selection.",
                                })
                              }
                              title="Click to zoom"
                            />
                            <div className="paper-figure-caption">
                              <strong>Figure 1: </strong>Multi-stage screening and statistical exclusion funnel.
                              Quantifies candidate retention across physical constraints, statistical surrogates, and active down-selection.
                            </div>
                            <div className="paper-figure-tools paper-no-print">
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/funnel.svg`}
                                download="fig1_funnel.svg"
                                className="paper-fig-action-btn"
                              >
                                Download SVG
                              </a>
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/funnel.png`}
                                download="fig1_funnel.png"
                                className="paper-fig-action-btn"
                              >
                                Download PNG
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Embed Figure 2 after Section 4 */}
                        {sec.id === "results" && includeFigures && (
                          <div className="paper-figure-card">
                            <img
                              src={`/api/v1/studies/${study.id}/paper/figures/phase_space.png`}
                              alt="Phase Space"
                              className="paper-figure-img"
                              onClick={() =>
                                setLightbox({
                                  src: `/api/v1/studies/${study.id}/paper/figures/phase_space.png`,
                                  title: "Figure 2: Candidate Phase Space",
                                  caption:
                                    "Candidate phase space mapping across primary controlled parameter coordinates.",
                                })
                              }
                              title="Click to zoom"
                            />
                            <div className="paper-figure-caption">
                              <strong>Figure 2: </strong>Candidate phase space mapping across primary controlled parameter coordinates.
                              Highlights feasible boundaries and optimal experimental candidate clusters.
                            </div>
                            <div className="paper-figure-tools paper-no-print">
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/phase_space.svg`}
                                download="fig2_phase_space.svg"
                                className="paper-fig-action-btn"
                              >
                                Download SVG
                              </a>
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/phase_space.png`}
                                download="fig2_phase_space.png"
                                className="paper-fig-action-btn"
                              >
                                Download PNG
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Embed Figure 3 & 4 */}
                        {sec.id === "results" && includeFigures && (
                          <div className="paper-figure-card">
                            <img
                              src={`/api/v1/studies/${study.id}/paper/figures/sensitivity.png`}
                              alt="Sensitivity Tornado"
                              className="paper-figure-img"
                              onClick={() =>
                                setLightbox({
                                  src: `/api/v1/studies/${study.id}/paper/figures/sensitivity.png`,
                                  title: "Figure 3: Global Sensitivity Analysis",
                                  caption:
                                    "Global parameter sensitivity analysis (Sobol first-order and total effects).",
                                })
                              }
                              title="Click to zoom"
                            />
                            <div className="paper-figure-caption">
                              <strong>Figure 3: </strong>Global parameter sensitivity analysis (Sobol first-order and total effects).
                              Ranks parameter impact dictating target physical outcome variations.
                            </div>
                            <div className="paper-figure-tools paper-no-print">
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/sensitivity.svg`}
                                download="fig3_sensitivity.svg"
                                className="paper-fig-action-btn"
                              >
                                Download SVG
                              </a>
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/sensitivity.png`}
                                download="fig3_sensitivity.png"
                                className="paper-fig-action-btn"
                              >
                                Download PNG
                              </a>
                            </div>
                          </div>
                        )}

                        {sec.id === "results" && includeFigures && (
                          <div className="paper-figure-card">
                            <img
                              src={`/api/v1/studies/${study.id}/paper/figures/pareto.png`}
                              alt="Pareto Frontier"
                              className="paper-figure-img"
                              onClick={() =>
                                setLightbox({
                                  src: `/api/v1/studies/${study.id}/paper/figures/pareto.png`,
                                  title: "Figure 4: Multi-Objective Pareto Frontier",
                                  caption:
                                    "Multi-objective Pareto trade-off manifold with recommended candidate batch.",
                                })
                              }
                              title="Click to zoom"
                            />
                            <div className="paper-figure-caption">
                              <strong>Figure 4: </strong>Multi-objective Pareto trade-off manifold with recommended candidate batch.
                            </div>
                            <div className="paper-figure-tools paper-no-print">
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/pareto.svg`}
                                download="fig4_pareto.svg"
                                className="paper-fig-action-btn"
                              >
                                Download SVG
                              </a>
                              <a
                                href={`/api/v1/studies/${study.id}/paper/figures/pareto.png`}
                                download="fig4_pareto.png"
                                className="paper-fig-action-btn"
                              >
                                Download PNG
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* FAIR Statement */}
                    <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid #cbd5e1" }}>
                      <h3 style={{ fontSize: "10pt", textTransform: "uppercase", marginBottom: 4, fontFamily: "sans-serif" }}>
                        Data & Code Availability
                      </h3>
                      <p style={{ fontSize: "8.5pt", color: "#475569", lineHeight: 1.45 }}>
                        All candidate matrices, physical bench measurements, and mechanistic simulation graphs are preserved
                        in full reproducibility compliance under master RNG seed <code>{paper.master_seed}</code>.
                        Direct archive verification available via Lattice Lab Study ID: <code>{study.id}</code>.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Lightbox Modal for Figure Zoom */}
        {lightbox && (
          <div className="paper-lightbox-overlay" onClick={() => setLightbox(null)}>
            <div className="paper-lightbox-content" onClick={(e) => e.stopPropagation()}>
              <div className="paper-lightbox-header">
                <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{lightbox.title}</span>
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b" }}
                >
                  <X size={18} />
                </button>
              </div>
              <img src={lightbox.src} alt={lightbox.title} className="paper-lightbox-img" />
              <div style={{ padding: "10px 18px", fontSize: 11.5, color: "#475569", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                {lightbox.caption}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Subcomponent: Live Tokens Selector Bar
interface LiveTokensBarProps {
  study: Study;
  paper: PaperResponse | null;
  onInsertToken: (token: string) => void;
}

function LiveTokensBar({ study, paper, onInsertToken }: LiveTokensBarProps) {
  const [tokenCategory, setTokenCategory] = useState<"metrics" | "physics" | "figures">("metrics");

  const tokens = useMemo(() => {
    const confPct = `${Math.round(study.confidence * 100)}%`;
    return {
      metrics: [
        { label: "Candidates count", token: "{{n_candidates}}", val: "N" },
        { label: "Confidence", token: "{{confidence}}", val: confPct },
        { label: "Threshold τ", token: "{{threshold}}", val: `${study.exclusion_threshold}` },
        { label: "Stat Excluded", token: "{{stat_excluded}}", val: "n" },
        { label: "Constraint Excluded", token: "{{constraint_excluded}}", val: "n" },
        { label: "Recommended batch", token: "{{recommended_count}}", val: "n" },
      ],
      physics: [
        { label: "Domain", token: "{{domain}}", val: study.domain },
        { label: "RNG Seed", token: "{{rng_seed}}", val: `${study.rng_seed}` },
        { label: "Parameters count", token: "{{n_parameters}}", val: "k" },
        { label: "Outcomes count", token: "{{n_outcomes}}", val: "m" },
        { label: "Buckingham Π count", token: "{{buckingham_pi_count}}", val: "p" },
        { label: "Valid evidence", token: "{{evidence_count}}", val: "n" },
        { label: "Model version", token: "{{model_version}}", val: "v1" },
      ],
      figures: [
        { label: "Figure 1 (Funnel)", token: "{{fig:funnel}}", val: "Fig. 1" },
        { label: "Figure 2 (Phase Space)", token: "{{fig:phase_space}}", val: "Fig. 2" },
        { label: "Figure 3 (Sensitivity)", token: "{{fig:sensitivity}}", val: "Fig. 3" },
        { label: "Figure 4 (Pareto)", token: "{{fig:pareto}}", val: "Fig. 4" },
        { label: "Table 1 (Parameters)", token: "{{tab:parameters}}", val: "Tab. 1" },
        { label: "Table 3 (Funnel)", token: "{{tab:funnel}}", val: "Tab. 3" },
      ],
    };
  }, [study]);

  return (
    <div className="paper-tokens-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 5 }}>
          <Sparkles size={12} color="#0284c7" />
          {tr("დინამიური მონაცემთა ცვლადები (დააჭირეთ ჩასასმელად)", "Insert Live Reactive Token (Cursor-aware)")}:
        </span>

        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className={`paper-tool-btn ${tokenCategory === "metrics" ? "active" : ""}`}
            onClick={() => setTokenCategory("metrics")}
            style={{ fontSize: 10, padding: "2px 6px" }}
          >
            Metrics
          </button>
          <button
            type="button"
            className={`paper-tool-btn ${tokenCategory === "physics" ? "active" : ""}`}
            onClick={() => setTokenCategory("physics")}
            style={{ fontSize: 10, padding: "2px 6px" }}
          >
            Physics & Model
          </button>
          <button
            type="button"
            className={`paper-tool-btn ${tokenCategory === "figures" ? "active" : ""}`}
            onClick={() => setTokenCategory("figures")}
            style={{ fontSize: 10, padding: "2px 6px" }}
          >
            Figures & Tables
          </button>
        </div>
      </div>

      <div className="paper-token-pills-row">
        {tokens[tokenCategory].map((t) => (
          <button
            key={t.token}
            type="button"
            className="paper-token-chip"
            onClick={() => onInsertToken(t.token)}
            title={`Insert ${t.token} at cursor position`}
          >
            <span>{t.label}</span>
            <span className="paper-token-val">{t.token}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Subcomponent: Section Editor Panel
interface SectionEditorPanelProps {
  secId: string;
  study: Study;
  paper: PaperResponse | null;
  textValue: string;
  isCustomized: boolean;
  resolvedPreview: boolean;
  onToggleResolvedPreview: () => void;
  onChange: (val: string) => void;
  onReset: () => void;
  onInsertToken: (token: string) => void;
  onWrapText: (before: string, after: string, placeholder?: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  figureDeck: FigureDeckItem[];
  onZoomFigure: (fig: FigureDeckItem) => void;
}

function SectionEditorPanel({
  secId,
  study,
  paper,
  textValue,
  isCustomized,
  resolvedPreview,
  onToggleResolvedPreview,
  onChange,
  onReset,
  onInsertToken,
  onWrapText,
  textareaRef,
  figureDeck,
  onZoomFigure,
}: SectionEditorPanelProps) {
  const getSectionTitle = () => {
    switch (secId) {
      case "intro":
        return "1. Introduction (Physical Problem & Motivation)";
      case "dimensional":
        return "2. Theory & Buckingham Π Groups";
      case "methods":
        return "3. Computational & Experimental Methods";
      case "results":
        return "4. Screening Results & Commentary";
      case "discussion":
        return "5. Discussion & Methodological Limitations";
      case "conclusions":
        return "6. Conclusions & Next Experimental Steps";
      default:
        return secId;
    }
  };

  const getSectionHelp = () => {
    switch (secId) {
      case "intro":
        return "State your physical domain background, experimental problem, and hypotheses. Cite literature with [@citekey].";
      case "dimensional":
        return "Buckingham Π invariant equations are derived automatically from parameter units. Use this section for physical interpretation of dimensionless groups.";
      case "methods":
        return "Documents DoE hypercube boundaries, simulation engine SHA signature, and split-conformal surrogate coverage guarantees.";
      case "results":
        return "Analyze candidate screening decisions. Figures 1-4 and Tables 1-4 are auto-synced with live study data and referenced via {{fig:funnel}}, etc.";
      case "discussion":
        return "Discuss physical interpretations and boundary assumptions. Note: per Hard Rule 6, unvalidated models are disclosed as deprioritising only.";
      case "conclusions":
        return "Summarize key findings and outline high-priority experimental bench runs.";
      default:
        return "";
    }
  };

  const resolveTokens = (text: string): string => {
    if (!text) return "";
    let res = text;
    const tokenMap: Record<string, string> = {
      study_name: study.name,
      domain: study.domain,
      confidence: `${Math.round(study.confidence * 100)}%`,
      confidence_fraction: `${study.confidence}`,
      threshold: `${study.exclusion_threshold}`,
      rng_seed: `${study.rng_seed}`,
      master_seed: `${paper?.master_seed ?? study.rng_seed}`,
      evidence_fingerprint: paper?.evidence_fingerprint?.slice(0, 10) ?? "none",
      "fig:funnel": "Figure 1",
      "fig:phase_space": "Figure 2",
      "fig:sensitivity": "Figure 3",
      "fig:pareto": "Figure 4",
      "tab:parameters": "Table 1",
      "tab:outcomes": "Table 2",
      "tab:funnel": "Table 3",
      "tab:recommended": "Table 4",
    };
    Object.entries(tokenMap).forEach(([k, v]) => {
      res = res.replaceAll(`{{${k}}}`, v);
    });
    return res;
  };

  return (
    <>
      <div className="paper-binding-callout">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>⚡ {getSectionTitle()}</strong>
          {isCustomized ? (
            <span style={{ fontSize: 10, background: "#0284c7", color: "#fff", padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>
              Custom Narrative Active
            </span>
          ) : (
            <span style={{ fontSize: 10, background: "#e2e8f0", color: "#475569", padding: "1px 6px", borderRadius: 3 }}>
              Auto Template Baseline
            </span>
          )}
        </div>
        <span>{getSectionHelp()}</span>
      </div>

      {/* Dynamic Token Inserter Bar */}
      <LiveTokensBar study={study} paper={paper} onInsertToken={onInsertToken} />

      <div>
        {/* Editor Toolbar */}
        <div className="paper-editor-toolbar">
          <div className="paper-toolbar-btn-group">
            <button
              type="button"
              className="paper-tool-btn"
              onClick={() => onWrapText("**", "**", "bold text")}
              title="Bold text (**text**)"
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className="paper-tool-btn"
              onClick={() => onWrapText("*", "*", "italic text")}
              title="Italic text (*text*)"
            >
              <em>I</em>
            </button>
            <button
              type="button"
              className="paper-tool-btn"
              onClick={() => onWrapText("$", "$", "y = f(x)")}
              title="Inline math ($...$)"
            >
              $x$
            </button>
            <button
              type="button"
              className="paper-tool-btn"
              onClick={() => onWrapText("$$\n", "\n$$", "\\Pi_1 = \\frac{Q}{\\nu L}")}
              title="Display math ($$...$$)"
            >
              $$\dots$$
            </button>
            <button
              type="button"
              className="paper-tool-btn"
              onClick={() => onInsertToken("[@sobol2001]")}
              title="Insert literature reference citation"
            >
              [@cite]
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className={`paper-tool-btn ${resolvedPreview ? "active" : ""}`}
              onClick={onToggleResolvedPreview}
              style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
              title="Toggle between markdown and text with live numbers evaluated"
            >
              <Eye size={11} />
              <span>{resolvedPreview ? "Edit Mode" : "Preview Values"}</span>
            </button>

            {isCustomized && (
              <button
                type="button"
                onClick={onReset}
                style={{ border: "none", background: "none", color: "#0284c7", fontSize: 11, cursor: "pointer" }}
                title="Revert back to auto-generated draft"
              >
                {tr("ავტომატურზე დაბრუნება", "Reset to Auto")}
              </button>
            )}
          </div>
        </div>

        {resolvedPreview ? (
          <div className="paper-resolved-preview">{resolveTokens(textValue)}</div>
        ) : (
          <textarea
            ref={textareaRef}
            className="paper-textarea"
            rows={14}
            value={textValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Write your scientific narrative here using Markdown and {{tokens}}..."
          />
        )}
      </div>

      {/* Figures miniature drawer inside Results section */}
      {secId === "results" && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label className="paper-field-label" style={{ margin: 0, fontSize: 11.5 }}>
              📊 {tr("დაკავშირებული გრაფიკები (დააწკაპუნეთ გასადიდებლად)", "Bound Figures (Click thumbnail to inspect)")}:
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {figureDeck.map((fig) => (
              <div
                key={fig.id}
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 5,
                  padding: 8,
                  fontSize: 11,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ color: "#0f172a" }}>{fig.name}</strong>
                  <button
                    type="button"
                    onClick={() => onInsertToken(` ${fig.token} `)}
                    style={{
                      border: "none",
                      background: "#e0f2fe",
                      color: "#0369a1",
                      fontSize: 10,
                      padding: "1px 5px",
                      borderRadius: 3,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                    title="Insert figure reference token in text"
                  >
                    + Insert Ref
                  </button>
                </div>
                <img
                  src={fig.pngUrl}
                  alt={fig.title}
                  style={{ width: "100%", height: 75, objectFit: "contain", background: "#ffffff", borderRadius: 3, cursor: "zoom-in" }}
                  onClick={() => onZoomFigure(fig)}
                  title="Click to zoom figure"
                />
                <span style={{ fontSize: 10, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fig.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
