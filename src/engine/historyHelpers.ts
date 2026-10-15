import type { PageSignals } from "./types";
import { compareRankings } from "./ranking";

export type RankingMovement = ReturnType<typeof compareRankings>[number];

/** Find the largest meaningful position change. Eligibility changes count as moves. */
export function getBiggestMover(rows: RankingMovement[]): RankingMovement | null {
  const moved = rows.filter((row) =>
    row.status !== "ranked" || (row.movement !== null && row.movement !== 0)
  );
  if (!moved.length) return null;
  return [...moved].sort((a, b) => {
    const aEligibilityChange = a.status === "ranked" ? 0 : 1;
    const bEligibilityChange = b.status === "ranked" ? 0 : 1;
    return bEligibilityChange - aEligibilityChange ||
      Math.abs(b.movement ?? 0) - Math.abs(a.movement ?? 0) ||
      a.pageId.localeCompare(b.pageId);
  })[0] ?? null;
}

/** Copy signal objects so a lab edit cannot mutate the shared app state. */
export function copyPages(pages: readonly PageSignals[]): PageSignals[] {
  return pages.map((page) => ({ ...page }));
}

export interface QuizLike { id: string; milestoneId?: string; }
export function selectQuizQuestions<T extends QuizLike>(
  questions: readonly T[],
  visitedMilestones: ReadonlySet<string>,
  limit: number,
): T[] {
  const visited = questions.filter((q) => q.milestoneId && visitedMilestones.has(q.milestoneId));
  const general = questions.filter((q) => !q.milestoneId);
  const unseen = questions.filter((q) => q.milestoneId && !visitedMilestones.has(q.milestoneId));
  return [...visited, ...general, ...unseen].slice(0, Math.max(0, limit));
}
