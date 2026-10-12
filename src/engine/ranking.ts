import { scorePage, validatePageSignals } from "./scoring";
import type { PageSignals, RankedPage, SearchIntent } from "./types";

export interface RankingResult {
  query: string;
  intent: SearchIntent;
  results: RankedPage[];
  excluded: RankedPage[];
  summary: { total: number; eligible: number; excluded: number };
}

/** Stable, deterministic ranking for classroom experiments; not Google's ranking formula. */
export function rankPages(query: string, intent: SearchIntent, pages: PageSignals[]): RankingResult {
  if (!query.trim()) throw new TypeError("Enter a search query before running the simulation.");
  if (pages.length === 0) throw new TypeError("Add at least one example page before running the simulation.");
  const ids = new Set<string>();
  const scored = pages.map((page) => {
    const errors = validatePageSignals(page);
    if (errors.length) throw new TypeError(`${page.title || page.id || "Unnamed page"}: ${errors.join(" ")}`);
    if (ids.has(page.id)) throw new TypeError(`Duplicate page id: ${page.id}`);
    ids.add(page.id);
    const score = scorePage(page, intent);
    return { ...page, score: score.score, position: null, eligible: score.eligible, contributions: score.contributions, warnings: score.warnings };
  });

  const compare = (a: RankedPage, b: RankedPage) =>
    Number(b.eligible) - Number(a.eligible) ||
    b.score - a.score ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id);
  scored.sort(compare);
  let position = 0;
  for (const page of scored) {
    if (!page.eligible) continue;
    page.position = ++position;
  }
  const results = scored.filter((page) => page.eligible);
  const excluded = scored.filter((page) => !page.eligible);
  return { query: query.trim(), intent, results, excluded, summary: { total: pages.length, eligible: results.length, excluded: excluded.length } };
}

export function compareRankings(before: RankingResult, after: RankingResult) {
  const oldPositions = new Map(before.results.map((page) => [page.id, page.position as number]));
  const newPositions = new Map(after.results.map((page) => [page.id, page.position as number]));
  const ids = new Set([...oldPositions.keys(), ...newPositions.keys()]);
  return [...ids].map((id) => ({
    pageId: id,
    before: oldPositions.get(id) ?? null,
    after: newPositions.get(id) ?? null,
    movement: oldPositions.has(id) && newPositions.has(id)
      ? (oldPositions.get(id) as number) - (newPositions.get(id) as number)
      : null,
    status: !oldPositions.has(id) ? "newly-eligible" as const : !newPositions.has(id) ? "excluded" as const : "ranked" as const,
  })).sort((a, b) => (a.after ?? Number.MAX_SAFE_INTEGER) - (b.after ?? Number.MAX_SAFE_INTEGER) || a.pageId.localeCompare(b.pageId));
}
