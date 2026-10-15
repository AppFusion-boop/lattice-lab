import { useSyncExternalStore } from "react";

export type RouteName = "flow" | "studies" | "study";

export interface Route {
  name: RouteName;
  path: string;
  params: {
    id?: string;
    tab?: string;
    query?: Record<string, string>;
  };
}

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  const [pathOnly, searchStr] = clean.split("?");
  const parts = pathOnly.split("/").filter(Boolean);
  const query: Record<string, string> = {};
  if (searchStr) {
    new URLSearchParams(searchStr).forEach((val, key) => {
      query[key] = val;
    });
  }

  if (parts.length === 0 || parts[0] === "studies") {
    if (parts.length <= 1) {
      return { name: "studies", path: "#/studies", params: { query } };
    }
    const id = parts[1];
    const tab = parts[2] || "overview";
    return {
      name: "study",
      path: `#/studies/${id}/${tab}${searchStr ? "?" + searchStr : ""}`,
      params: { id, tab, query },
    };
  }

  if (parts[0] === "flow") {
    return { name: "flow", path: "#/flow", params: { query } };
  }

  return { name: "studies", path: "#/studies", params: { query } };
}

let currentRoute: Route = parseHash(typeof window !== "undefined" ? window.location.hash : "");

const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    currentRoute = parseHash(window.location.hash);
    listeners.forEach((l) => l());
  });
}

export function navigate(path: string) {
  if (typeof window !== "undefined") {
    const formatted = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
    window.location.hash = formatted;
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => currentRoute,
    () => ({ name: "studies", path: "#/studies", params: {} }),
  );
}
