import type { PageSignals } from "../engine/types";
const STORAGE_KEY = "seo-strategy-lab-v1";
export interface SavedExperiment { id: string; name: string; query: string; intent: string; pages: PageSignals[]; savedAt: string; }
export function loadExperiments(): SavedExperiment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedExperiment =>
      item && typeof item.id === "string" && typeof item.name === "string" &&
      typeof item.query === "string" && Array.isArray(item.pages)
    );
  } catch { return []; }
}
export function saveExperiments(items: SavedExperiment[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  catch { throw new Error("Could not save in this browser. Check storage permissions or available space."); }
}
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}
