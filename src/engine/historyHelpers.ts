import type { PageSignals } from "./types";
import type { RankingResult } from "./ranking";
import { compareRankings } from "./ranking";

export type RankingMovement = ReturnType<typeof compareRankings>[number];

/** Return the page with the largest absolute movement. Stable tie-break: page id. */
export function getBiggestMover(rows: RankingMovement[]): RankingMovement | null {
  const moved = rows.filter((row) =>
    row.status === "ranked" && row.movement !== null && row.movement !== 0
  );
  if (!moved.length) return null;
  return [...moved].sort((a, b) =>
    Math.abs(b.movement ?? 0) - Math.abs(a.movement ?? 0) || a.pageId.localeCompare(b.pageId)
  )[0] ?? null;
}

/** Copy signal objects so a lab edit cannot mutate the shared app state. */
export function copyPages(pages: readonly PageSignals[]): PageSignals[] {
  return pages.map((page) => ({ ...page }));
}

export interface QuizLike {
  id: string;
  milestoneId?: string;
}
export function selectQuizQuestions<T extends QuizLike>(
  questions: readonly T[],
  visitedMilestones: ReadonlySet<string>,
  limit: number,
): T[] {
  const visited = questions.filter((q) => q.milestoneId && visitedMilestones.has(q.milestoneId));
  const general = questions.filter((q) => !q.milestoneId);
  const unseen = questions.filter((q) => q.milestoneId && !visitedMilestones.has(q.milestoneId));
  const chosen = [...visited, ...general, ...unseen];
  return chosen.slice(0, Math.max(0, limit));
}
