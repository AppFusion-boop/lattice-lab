import { Workflow, FlaskConical, Globe } from "lucide-react";
import Workspace from "../Workspace";
import { StudyList } from "../study/StudyList";
import { StudyLayout } from "../study/StudyLayout";
import { useRoute, navigate } from "./router";
import { useLang, setLang, tr } from "../i18n";
import "./AppShell.css";

export function AppShell() {
  const route = useRoute();
  const lang = useLang();

  return (
    <div className="app-shell">
      <header className="app-shell-topbar">
        <nav className="app-shell-nav" aria-label="Module switcher">
          <button
            className={`app-shell-tab ${route.name === "flow" ? "active" : ""}`}
            onClick={() => navigate("flow")}
            aria-current={route.name === "flow" ? "page" : undefined}
          >
            <Workflow size={13} />
            <span>{tr("ფლოუები", "Flows")}</span>
          </button>
          <button
            className={`app-shell-tab ${route.name !== "flow" ? "active" : ""}`}
            onClick={() => navigate("studies")}
            aria-current={route.name !== "flow" ? "page" : undefined}
          >
            <FlaskConical size={13} />
            <span>{tr("კვლევები", "Studies")}</span>
          </button>
        </nav>

        <div className="app-shell-actions">
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
