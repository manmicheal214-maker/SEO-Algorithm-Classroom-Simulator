import type { PageSignals } from "./types";

/** Helpers that turn pasted HTML + a few student inputs into simulator signals. No live crawling is performed. */

export type SignalKey = Exclude<keyof PageSignals, "id" | "title" | "url" | "description" | "indexable">;

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  relevance: "Query relevance", usefulness: "Content usefulness", titleHeadingMatch: "Title and headings",
  intentFit: "Search intent fit", internalLinkSupport: "Internal links", backlinkQuality: "Backlink quality",
  crawlability: "Crawlability", mobileUsability: "Mobile usability", pageExperience: "Page experience",
  structuredDataValidity: "Structured data", freshness: "Freshness", trustEvidence: "Trust and evidence",
  duplicateContent: "Duplicate-content risk",
};
export const SIGNAL_KEYS = Object.keys(SIGNAL_LABELS) as SignalKey[];

export interface HtmlFinding { label: string; ok: boolean; note: string }
export interface DerivedSite {
  title: string;
  description: string;
  indexable: boolean;
  signals: Partial<Record<SignalKey, number>>;
  findings: HtmlFinding[];
}

export const MAX_HTML_INPUT_LENGTH = 512 * 1024;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();

export function queryTerms(query: string): string[] {
  return [...new Set(query.normalize("NFKC").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => [...t].length > 2))];
}
/** Share of query terms found in the text (0..1). */
export function coverage(text: string, query: string): number {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  const lower = text.normalize("NFKC").toLocaleLowerCase();
  return terms.filter((t) => lower.includes(t)).length / terms.length;
}

function metaContent(html: string, name: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (new RegExp(`name\\s*=\\s*["']${name}["']`, "i").test(tag)) {
      const m = tag.match(/content\s*=\s*["']([^"']*)["']/i);
      return m ? m[1].trim() : "";
    }
  }
  return "";
}

export function deriveSignalsFromHtml(input: string, query: string, url = ""): DerivedSite {
  const html = input.slice(0, MAX_HTML_INPUT_LENGTH);
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = metaContent(html, "description");
  const robots = metaContent(html, "robots").toLowerCase();
  const indexable = !robots.includes("noindex");
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
  const body = stripTags(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " "));
  const words = body ? body.split(" ").length : 0;
  const hasViewport = /<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html);
  const hasCanonical = /<link\b[^>]*rel\s*=\s*["']canonical["']/i.test(html);
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesMissingAlt = images.filter((i) => !/\balt\s*=/i.test(i)).length;

  let host = "";
  try { host = new URL(url).host; } catch { /* url is validated separately */ }
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const internalLinks = anchors.filter((h) => h.startsWith("/") || (!!host && h.includes(host))).length;

  const ld = [...html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const ldValid = ld.filter((block) => { try { JSON.parse(block); return true; } catch { return false; } }).length;

  const titleCov = coverage(title, query), h1Cov = coverage(h1s.join(" "), query), bodyCov = coverage(body, query);
  const signals: DerivedSite["signals"] = {
    titleHeadingMatch: clamp(100 * (0.6 * titleCov + 0.4 * h1Cov)),
    relevance: clamp(100 * (0.7 * bodyCov + 0.3 * titleCov)),
    usefulness: words < 150 ? 35 : words < 400 ? 55 : words < 800 ? 70 : 80,
    crawlability: clamp((indexable ? 90 : 20) - (hasCanonical ? 0 : 10) - (title ? 0 : 15)),
    mobileUsability: hasViewport ? 85 : 45,
    structuredDataValidity: ld.length === 0 ? 20 : ldValid === ld.length ? 90 : 40,
    internalLinkSupport: internalLinks === 0 ? 15 : internalLinks < 3 ? 40 : internalLinks < 10 ? 65 : 80,
  };

  const findings: HtmlFinding[] = [
    { label: "Title tag", ok: title.length >= 10 && title.length <= 60, note: title ? `${title.length} characters (aim for roughly 10–60).` : "Missing — add a descriptive title." },
    { label: "Meta description", ok: description.length >= 50 && description.length <= 160, note: description ? `${description.length} characters (aim for roughly 50–160).` : "Missing — add a helpful description." },
    { label: "Single H1", ok: h1s.length === 1, note: `${h1s.length} H1 heading(s) found.` },
    { label: "Query in title/H1", ok: titleCov + h1Cov > 0, note: `Title covers ${Math.round(titleCov * 100)}% and H1 ${Math.round(h1Cov * 100)}% of query terms.` },
    { label: "Image alt text", ok: imagesMissingAlt === 0, note: images.length ? `${imagesMissingAlt} of ${images.length} images lack alt text.` : "No images found." },
    { label: "Canonical link", ok: hasCanonical, note: hasCanonical ? "Found." : "Review canonical URL handling." },
    { label: "Mobile viewport", ok: hasViewport, note: hasViewport ? "Found." : "Add a viewport meta tag." },
    { label: "Structured data", ok: ld.length > 0 && ldValid === ld.length, note: ld.length ? `${ldValid}/${ld.length} JSON-LD blocks parse.` : "No JSON-LD found (optional)." },
    { label: "Indexable", ok: indexable, note: indexable ? "No noindex directive found." : "robots meta contains noindex — page would be excluded." },
  ];
  return { title, description, indexable, signals, findings };
}

export interface Improvement { key: SignalKey; label: string; yours: number; top: number; gap: number }

/** Biggest signal gaps between a page and the current top result (duplicate risk: lower is better). */
export function suggestImprovements(mine: PageSignals, top: PageSignals, limit = 3, minGap = 10): Improvement[] {
  return SIGNAL_KEYS.map((key) => {
    const yours = mine[key] as number, best = top[key] as number;
    const gap = key === "duplicateContent" ? yours - best : best - yours;
    return { key, label: SIGNAL_LABELS[key], yours, top: best, gap };
  }).filter((x) => x.gap >= minGap).sort((a, b) => b.gap - a.gap || a.key.localeCompare(b.key)).slice(0, limit);
}
