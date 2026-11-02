import { Workflow, FlaskConical, Globe, ChevronRight, Activity, Layers } from "lucide-react";
import Workspace from "../Workspace";
import { StudyList } from "../study/StudyList";
import { StudyLayout } from "../study/StudyLayout";
import { useRoute, navigate } from "./router";
import { useLang, setLang, tr } from "../i18n";
import { useApi, useServerHealth } from "../study/api/hooks";
import { apiGet } from "../study/api/client";
import type { Study } from "../study/api/types";
import "./AppShell.css";

export function AppShell() {
  const route = useRoute();
  const lang = useLang();
  const { isOnline } = useServerHealth();

  const studyId = route.name === "study" ? route.params.id : undefined;
  const { data: study } = useApi<Study>(
    studyId ? `topbar-study-${studyId}` : null,
    () => (studyId ? apiGet<Study>(`/studies/${studyId}`) : Promise.resolve(null as any)),
  );

  return (
    <div className="app-shell">
      <header className="app-shell-topbar">
        {/* Left: Brand & Breadcrumbs */}
        <div className="app-shell-left">
          <div
            className="app-shell-brand"
            onClick={() => navigate("studies")}
            role="button"
            tabIndex={0}
            title={tr("Lattice Lab — კვლევების კატალოგი", "Lattice Lab — Scientific Studies Catalog")}
          >
            <div className="app-shell-brand-icon">
              <FlaskConical size={13} strokeWidth={2.4} />
            </div>
            <div className="app-shell-brand-meta">
              <span className="app-shell-brand-title">Lattice Lab</span>
              <span className="app-shell-brand-tag">v2.2 · SCREENING</span>
            </div>
          </div>

          <span className="app-shell-breadcrumb-sep">/</span>

          <nav className="app-shell-breadcrumbs" aria-label="Breadcrumb">
            <button
              className={`app-shell-crumb-btn ${route.name === "studies" ? "active" : ""}`}
              onClick={() => navigate("studies")}
            >
              <span>{tr("კვლევები", "Studies")}</span>
            </button>

            {route.name === "study" && (
              <>
                <ChevronRight size={11} className="app-shell-crumb-arrow" />
                <span className="app-shell-crumb-current" title={study?.name || route.params.id}>
                  {study ? study.name : tr("კვლევის სივრცე", "Study Workbench")}
                </span>
                {route.params.tab && (
                  <>
                    <ChevronRight size={11} className="app-shell-crumb-arrow" />
                    <span className="app-shell-crumb-tab">
                      {route.params.tab === "flow" || route.params.tab === "models"
                        ? tr("3D ფლოუ & სიმულაცია", "3D Flow & Sim")
                        : route.params.tab === "micrograph" || route.params.tab === "microscope"
                          ? tr("მიკროსკოპი (Micrograph)", "Micrograph")
                          : route.params.tab}
                    </span>
                  </>
                )}
              </>
            )}

            {route.name === "flow" && (
              <>
                <ChevronRight size={11} className="app-shell-crumb-arrow" />
                <span className="app-shell-crumb-current">
                  {tr("3D ფლოუს სენდბოქსი", "3D Flow Sandbox")}
                </span>
              </>
            )}
          </nav>
        </div>

        {/* Right: Actions & Utilities */}
        <div className="app-shell-actions">
          {/* Server Engine Health Indicator */}
          <div
            className={`app-shell-status-pill ${isOnline === false ? "status-offline" : "status-online"}`}
            title={
              isOnline === false
                ? tr("FastAPI სერვერი გათიშულია (:8765)", "FastAPI server offline (:8765)")
                : tr("FastAPI + SQLite WAL ონლაინ რეჟიმშია (:8765)", "FastAPI engine active on 127.0.0.1:8765")
            }
          >
            <span className="status-dot" />
            <span className="status-label">
              {isOnline === false ? tr("ოფლაინ", "Offline") : "127.0.0.1:8765"}
            </span>
          </div>

          <div className="app-shell-divider-v" />

          {/* Mode Switcher */}
          <div className="app-shell-mode-nav">
            <button
              className={`app-shell-nav-pill ${route.name === "studies" || route.name === "study" ? "active" : ""}`}
              onClick={() => navigate("studies")}
              title={tr("კვლევების კატალოგი & DoE მატრიცა", "Studies catalog & DoE screening matrix")}
            >
              <Layers size={12} />
              <span>{tr("კვლევები", "Studies")}</span>
            </button>

            <button
              className={`app-shell-nav-pill ${route.name === "flow" ? "active" : ""}`}
              onClick={() => navigate("flow")}
              title={tr("3D ფლოუს ავტონომიური სენდბოქსი", "Open 3D flow physics sandbox")}
            >
              <Workflow size={12} />
              <span>{tr("სენდბოქსი", "3D Sandbox")}</span>
            </button>
          </div>

          <div className="app-shell-divider-v" />

          {/* Clean Segmented Language Toggle */}
          <div className="app-shell-lang-segmented" role="group" aria-label="Language">
            <button
              className={`lang-option ${lang === "en" ? "active" : ""}`}
              onClick={() => setLang("en")}
              title="English"
            >
              EN
            </button>
            <button
              className={`lang-option ${lang === "ka" ? "active" : ""}`}
              onClick={() => setLang("ka")}
              title="ქართული"
            >
              KA
            </button>
          </div>
        </div>
      </header>

      <main className="app-shell-content">
        {route.name === "flow" ? (
          <Workspace hideHeaderBrand={true} />
        ) : route.name === "study" && route.params.id ? (
          <StudyLayout id={route.params.id} tab={route.params.tab || "overview"} />
        ) : (
          <StudyList />
        )}
      </main>
    </div>
  );
}

export default AppShell;
