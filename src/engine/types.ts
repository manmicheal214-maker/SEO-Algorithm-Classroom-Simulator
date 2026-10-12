/** Typed inputs and outputs for the educational SEO ranking model. */
export type SearchIntent = "informational" | "navigational" | "commercial" | "transactional";

export interface PageSignals {
  id: string;
  title: string;
  url: string;
  description: string;
  relevance: number;
  usefulness: number;
  titleHeadingMatch: number;
  internalLinkSupport: number;
  backlinkQuality: number;
  crawlability: number;
  mobileUsability: number;
  pageExperience: number;
  structuredDataValidity: number;
  freshness: number;
  trustEvidence: number;
  intentFit: number;
  duplicateContent: number;
  indexable: boolean;
}

export interface ScoringWeights {
  relevance: number;
  usefulness: number;
  titleHeadingMatch: number;
  internalLinkSupport: number;
  backlinkQuality: number;
  crawlability: number;
  mobileUsability: number;
  pageExperience: number;
  structuredDataValidity: number;
  freshness: number;
  trustEvidence: number;
  intentFit: number;
}

export interface ScoreContribution {
  signal: keyof ScoringWeights | "relevanceUsefulnessInteraction" | "duplicateContentPenalty";
  label: string;
  points: number;
  explanation: string;
}

export interface PageScore {
  pageId: string;
  score: number;
  eligible: boolean;
  contributions: ScoreContribution[];
  warnings: string[];
}

export interface RankedPage extends PageSignals {
  score: number;
  position: number | null;
  eligible: boolean;
  contributions: ScoreContribution[];
  warnings: string[];
}
