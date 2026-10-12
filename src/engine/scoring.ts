import type { PageScore, PageSignals, ScoringWeights, SearchIntent, ScoreContribution } from "./types";

const BASE_WEIGHTS: Record<SearchIntent, ScoringWeights> = {
  informational: { relevance: 0.17, usefulness: 0.16, titleHeadingMatch: 0.09, internalLinkSupport: 0.06, backlinkQuality: 0.08, crawlability: 0.08, mobileUsability: 0.05, pageExperience: 0.04, structuredDataValidity: 0.02, freshness: 0.06, trustEvidence: 0.11, intentFit: 0.08 },
  navigational: { relevance: 0.23, usefulness: 0.05, titleHeadingMatch: 0.08, internalLinkSupport: 0.04, backlinkQuality: 0.05, crawlability: 0.12, mobileUsability: 0.04, pageExperience: 0.03, structuredDataValidity: 0.01, freshness: 0.01, trustEvidence: 0.06, intentFit: 0.32 },
  commercial: { relevance: 0.15, usefulness: 0.13, titleHeadingMatch: 0.09, internalLinkSupport: 0.06, backlinkQuality: 0.09, crawlability: 0.07, mobileUsability: 0.05, pageExperience: 0.04, structuredDataValidity: 0.05, freshness: 0.08, trustEvidence: 0.11, intentFit: 0.08 },
  transactional: { relevance: 0.18, usefulness: 0.10, titleHeadingMatch: 0.10, internalLinkSupport: 0.05, backlinkQuality: 0.07, crawlability: 0.12, mobileUsability: 0.07, pageExperience: 0.06, structuredDataValidity: 0.06, freshness: 0.03, trustEvidence: 0.06, intentFit: 0.12 },
};

const LABELS: Record<keyof ScoringWeights, string> = {
  relevance: "Query relevance", usefulness: "Content usefulness", titleHeadingMatch: "Title and heading match",
  internalLinkSupport: "Internal link support", backlinkQuality: "Backlink quality", crawlability: "Crawlability",
  mobileUsability: "Mobile usability", pageExperience: "Page experience", structuredDataValidity: "Structured data",
  freshness: "Query-dependent freshness", trustEvidence: "Trust and evidence", intentFit: "Search intent fit",
};
const EXPLANATIONS: Record<keyof ScoringWeights, string> = {
  relevance: "How closely the page matches the meaning of the query.",
  usefulness: "An illustrative estimate of how well the page satisfies the task.",
  titleHeadingMatch: "How clearly the title and headings describe the topic.",
  internalLinkSupport: "How well the site's internal links help discovery and context.",
  backlinkQuality: "A teaching proxy for relevant, credible references—not raw link count.",
  crawlability: "Whether search systems can fetch and understand the page.",
  mobileUsability: "How usable the page is on mobile devices.",
  pageExperience: "A simplified page experience signal; not a ranking guarantee.",
  structuredDataValidity: "Whether structured data is valid and eligible for relevant enhancements.",
  freshness: "Potentially useful for queries where recency matters.",
  trustEvidence: "Visible evidence, authorship, and support for important claims.",
  intentFit: "How well the page serves the selected search intent.",
};

export const DEFAULT_WEIGHTS: Record<SearchIntent, ScoringWeights> = BASE_WEIGHTS;

function clampSignal(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("Every SEO signal must be a finite number.");
  if (value < 0 || value > 100) throw new RangeError("SEO signals must be between 0 and 100.");
  return value / 100;
}

/** Concave transform models diminishing returns: moving 20→40 matters more than 80→100. */
function diminishingReturn(normalized: number): number {
  return Math.sqrt(normalized);
}

export function validatePageSignals(page: PageSignals): string[] {
  const errors: string[] = [];
  if (!page.id.trim()) errors.push("Page id is required.");
  if (!page.title.trim()) errors.push("Page title is required.");
  try {
    const parsed = new URL(page.url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") errors.push("Page URL must use HTTP or HTTPS.");
  } catch {
    errors.push("Page URL must be a valid absolute URL.");
  }
  const signalKeys: (keyof ScoringWeights | "duplicateContent")[] = [
    "relevance", "usefulness", "titleHeadingMatch", "internalLinkSupport", "backlinkQuality",
    "crawlability", "mobileUsability", "pageExperience", "structuredDataValidity", "freshness",
    "trustEvidence", "intentFit", "duplicateContent",
  ];
  for (const key of signalKeys) {
    const value = page[key];
    if (!Number.isFinite(value) || value < 0 || value > 100) errors.push(`${key} must be a number from 0 to 100.`);
  }
  return errors;
}

export function scorePage(page: PageSignals, intent: SearchIntent): PageScore {
  const errors = validatePageSignals(page);
  if (errors.length) throw new TypeError(errors.join(" "));
  const weights = BASE_WEIGHTS[intent];
  const contributions: ScoreContribution[] = [];
  let weighted = 0;
  for (const key of Object.keys(weights) as (keyof ScoringWeights)[]) {
    const value = diminishingReturn(clampSignal(page[key]));
    const points = value * weights[key] * 100;
    weighted += points;
    contributions.push({ signal: key, label: LABELS[key], points, explanation: EXPLANATIONS[key] });
  }

  // Query relevance and usefulness reinforce one another; neither can fully substitute for the other.
  const interaction = Math.sqrt(clampSignal(page.relevance) * clampSignal(page.usefulness)) * 5;
  weighted += interaction;
  contributions.push({
    signal: "relevanceUsefulnessInteraction", label: "Relevance × usefulness", points: interaction,
    explanation: "A page that matches the query and helps the user can outperform one that has only one of these qualities.",
  });

  const duplicatePenalty = clampSignal(page.duplicateContent) * 12;
  weighted -= duplicatePenalty;
  contributions.push({
    signal: "duplicateContentPenalty", label: "Duplicate-content risk", points: -duplicatePenalty,
    explanation: "This illustrative penalty represents a possible quality concern, not a claim that Google applies a fixed duplicate-content penalty.",
  });

  const warnings: string[] = [];
  if (page.crawlability < 25) warnings.push("Low crawlability may prevent search engines from reliably accessing this page.");
  if (page.duplicateContent >= 70) warnings.push("High duplication risk: review whether this page adds distinct value.");
  if (page.structuredDataValidity < 25) warnings.push("Structured data may be missing or invalid; valid markup does not guarantee a rich result.");
  if (page.freshness < 30) warnings.push("Freshness is low; this matters most when the query deserves recent information.");
  const eligible = page.indexable && page.crawlability >= 15;
  if (!page.indexable) warnings.push("Page marked noindex or otherwise ineligible: excluded from simulated ranking.");
  else if (page.crawlability < 15) warnings.push("Crawlability is below the simulator's eligibility threshold.");

  return {
    pageId: page.id,
    score: eligible ? Math.max(0, Math.min(100, Number(weighted.toFixed(2)))) : 0,
    eligible,
    contributions: contributions.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    warnings,
  };
}

export function getScoringWeights(intent: SearchIntent): ScoringWeights {
  return { ...BASE_WEIGHTS[intent] };
}
