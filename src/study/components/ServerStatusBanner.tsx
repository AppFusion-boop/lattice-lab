import { AlertTriangle, RefreshCw } from "lucide-react";
import { useServerHealth } from "../api/hooks";
import { tr } from "../../i18n";
import "../study.css";

export function ServerStatusBanner() {
  const { isOnline, checking, recheck } = useServerHealth();

  if (isOnline !== false) {
    return null;
  }

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 20px",
        background: "var(--ll-amber-soft)",
        borderBottom: "1px solid var(--ll-amber-border)",
        color: "var(--ll-amber-text)",
        fontSize: "12px",
        fontWeight: 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={15} color="var(--ll-amber)" />
        <span>
          <strong>{tr("სერვერი გათიშულია:", "Study server is offline —")}</strong>{" "}
          {tr(
            "გაუშვით `npm run server` ტერმინალში კვლევებისა და სტატისტიკური სკრინინგისთვის. 3D ფლოუს რედაქტორი მუშაობს ავტონომიურად.",
            "Run `npm run server` to enable study persistence and statistical screening. Flow editor works offline.",
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={recheck}
        disabled={checking}
        className="btn-secondary"
        style={{
          padding: "3px 8px",
          fontSize: "11px",
          color: "var(--ll-amber-text)",
          borderColor: "var(--ll-amber-border)",
          background: "var(--ll-surface)",
        }}
      >
        <RefreshCw size={11} className={checking ? "spin" : ""} />
        <span>{tr("შემოწმება", "Retry")}</span>
      </button>
    </div>
  );
}
