import { Workflow, FlaskConical, Globe, ChevronRight } from "lucide-react";
import Workspace from "../Workspace";
import { StudyList } from "../study/StudyList";
import { StudyLayout } from "../study/StudyLayout";
import { useRoute, navigate } from "./router";
import { useLang, setLang, tr } from "../i18n";
import { useApi } from "../study/api/hooks";
import { apiGet } from "../study/api/client";
import type { Study } from "../study/api/types";
import "./AppShell.css";

export function AppShell() {
  const route = useRoute();
  const lang = useLang();

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
            title={tr("Lattice Lab — კვლევების სია", "Lattice Lab — Studies Catalog")}
          >
            <div className="app-shell-brand-icon">
              <FlaskConical size={14} />
            </div>
            <span className="app-shell-brand-title">Lattice Lab</span>
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
                <ChevronRight size={12} className="app-shell-crumb-arrow" />
                <span className="app-shell-crumb-current" title={study?.name || route.params.id}>
                  {study ? study.name : tr("კვლევის სივრცე", "Study Workbench")}
                </span>
                {route.params.tab && (
                  <>
                    <ChevronRight size={12} className="app-shell-crumb-arrow" />
                    <span className="app-shell-crumb-tab">
                      {route.params.tab === "flow" || route.params.tab === "models"
                        ? tr("3D ფლოუ & სიმულაცია", "3D Flow & Simulation")
                        : route.params.tab}
                    </span>
                  </>
                )}
              </>
            )}

            {route.name === "flow" && (
              <>
                <ChevronRight size={12} className="app-shell-crumb-arrow" />
                <span className="app-shell-crumb-current">
                  {tr("სენდბოქს ფლოუ (ავტონომიური)", "Flow Sandbox (Draft)")}
                </span>
              </>
            )}
          </nav>
        </div>

        {/* Right: Actions & Utilities */}
        <div className="app-shell-actions">
          {route.name !== "flow" ? (
            <button
              className="app-shell-secondary-btn"
              onClick={() => navigate("flow")}
              title={tr(
                "ცარიელი ფლოუს სენდბოქსი (კვლევის კონტეინერის გარეშე მოდელირება)",
                "Open scratchpad flow sandbox without a study container",
              )}
            >
              <Workflow size={12} />
              <span>{tr("სენდბოქსი", "Sandbox")}</span>
            </button>
          ) : (
            <button
              className="app-shell-secondary-btn active"
              onClick={() => navigate("studies")}
            >
              <FlaskConical size={12} />
              <span>{tr("კვლევებში დაბრუნება", "Back to Studies")}</span>
            </button>
          )}

          <div className="app-shell-divider-v" />

          <button
            className="app-shell-lang-btn"
            onClick={() => setLang(lang === "ka" ? "en" : "ka")}
            title={
              lang === "ka"
                ? "Switch language to English (Note: node catalog labels stay Georgian until Phase 6)"
                : "ენის გადართვა ქართულზე"
            }
          >
            <Globe size={11} />
            <span>{lang === "ka" ? "EN" : "KA"}</span>
          </button>
        </div>
      </header>

      <main className="app-shell-content">
        {route.name === "flow" ? (
          <Workspace />
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
