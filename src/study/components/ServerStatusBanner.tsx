import { AlertTriangle, RefreshCw } from "lucide-react";
import { useServerHealth } from "../api/hooks";
import { tr } from "../../i18n";

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
        padding: "10px 16px",
        background: "#fef3c7",
        borderBottom: "1px solid #f59e0b",
        color: "#92400e",
        fontSize: "12px",
        fontWeight: 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={16} color="#d97706" />
        <span>
          <strong>{tr("სერვერი გათიშულია:", "Study server is not running —")}</strong>{" "}
          {tr(
            "გაუშვით `npm run server` ტერმინალში კვლევების ფუნქციონალისთვის. ფლოუს რედაქტორი ჩვეულებრივ მუშაობს.",
            "start it with `npm run server`. The flow editor works offline without the server."
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={recheck}
        disabled={checking}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "#fff",
          color: "#92400e",
          border: "1px solid #d97706",
          padding: "4px 10px",
          borderRadius: 4,
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <RefreshCw size={12} className={checking ? "spin" : ""} />
        <span>{tr("ხელახლა შემოწმება", "Retry")}</span>
      </button>
    </div>
  );
}
