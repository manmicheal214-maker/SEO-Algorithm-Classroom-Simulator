import test from "node:test";
import assert from "node:assert/strict";
import { compareRankings, rankPages } from "./ranking";
import { scorePage, validatePageSignals } from "./scoring";
import type { PageSignals } from "./types";

const page = (overrides: Partial<PageSignals> = {}): PageSignals => ({
  id: "sample", title: "A useful guide", url: "https://example.com/guide",
  description: "An example description", relevance: 75, usefulness: 80, titleHeadingMatch: 70,
  internalLinkSupport: 60, backlinkQuality: 50, crawlability: 90, mobileUsability: 85,
  pageExperience: 80, structuredDataValidity: 60, freshness: 50, trustEvidence: 75,
  intentFit: 80, duplicateContent: 0, indexable: true, ...overrides,
});

test("score is deterministic for unchanged input", () => {
  assert.deepEqual(scorePage(page(), "informational"), scorePage(page(), "informational"));
});
test("signals outside the 0-100 range are rejected", () => {
  assert.ok(validatePageSignals(page({ relevance: 101 })).some((e) => e.includes("relevance")));
  assert.throws(() => scorePage(page({ usefulness: -1 }), "informational"), /0 to 100/);
});
test("noindex pages are excluded regardless of score", () => {
  const result = rankPages("example query", "informational", [page({ id: "hidden", indexable: false })]);
  assert.equal(result.results.length, 0);
  assert.equal(result.excluded[0].position, null);
});
test("ranking is stable and gives higher score the better position", () => {
  const low = page({ id: "low", title: "Low", relevance: 20, usefulness: 20, intentFit: 20 });
  const high = page({ id: "high", title: "High", relevance: 95, usefulness: 95, intentFit: 95 });
  const result = rankPages("example query", "informational", [low, high]);
  assert.equal(result.results[0].id, "high");
  assert.equal(result.results[0].position, 1);
});
test("ties are broken deterministically by title then id", () => {
  const result = rankPages("example query", "informational", [
    page({ id: "z", title: "Zulu" }), page({ id: "a", title: "Alpha" }),
  ]);
  assert.equal(result.results[0].title, "Alpha");
});
test("duplicate ids and blank queries are rejected", () => {
  assert.throws(() => rankPages(" ", "informational", [page()]), /search query/);
  assert.throws(() => rankPages("query", "informational", [page(), page()]), /Duplicate page id/);
});
test("ranking comparison reports upward movement as positive", () => {
  const before = rankPages("query", "informational", [page({ id: "a", relevance: 40 }), page({ id: "b", relevance: 90 })]);
  const after = rankPages("query", "informational", [page({ id: "a", relevance: 95 }), page({ id: "b", relevance: 50 })]);
  const movement = compareRankings(before, after).find((item) => item.pageId === "a");
  assert.equal(movement?.movement, 1);
});
