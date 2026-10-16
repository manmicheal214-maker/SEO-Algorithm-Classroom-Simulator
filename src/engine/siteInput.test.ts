import test from "node:test";
import assert from "node:assert/strict";
import { deriveSignalsFromHtml, suggestImprovements, coverage } from "./siteInput";
import type { PageSignals } from "./types";

const good = `<html><head><title>Best Beginner Mirrorless Camera Guide</title><meta name="description" content="Compare beginner mirrorless cameras with practical buying advice, lenses and trade-offs."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"><script type="application/ld+json">{"@type":"Article"}</script></head><body><h1>Best beginner mirrorless camera</h1><a href="/lenses">Lenses</a><img src="a.jpg" alt="Camera"></body></html>`;

test("coverage counts query terms found in text", () => {
  assert.equal(coverage("Best mirrorless camera", "best beginner mirrorless camera"), 0.75);
});

test("query coverage handles Unicode terms and entity-encoded text", () => {
  assert.equal(coverage("Café camera", "café camera"), 1);
});

test("good HTML derives strong title, mobile, structured data and title", () => {
  const result = deriveSignalsFromHtml(good, "beginner mirrorless camera", "https://example.com/");
  assert.ok(result.signals.titleHeadingMatch! >= 90);
  assert.equal(result.signals.mobileUsability, 85);
  assert.equal(result.signals.structuredDataValidity, 90);
  assert.equal(result.indexable, true);
  assert.equal(result.title, "Best Beginner Mirrorless Camera Guide");
});

test("noindex excludes the page and marks the Indexable finding as failed", () => {
  const result = deriveSignalsFromHtml(good.replace('<meta name="viewport" content="width=device-width">', "").replace("</head>", '<meta name="robots" content="noindex,follow"></head>'), "beginner mirrorless camera");
  assert.equal(result.indexable, false);
  assert.equal(result.signals.mobileUsability, 45);
  assert.equal(result.findings.find(f => f.label === "Indexable")?.ok, false);
});

test("invalid JSON-LD receives a structured data score of 40", () => {
  const html = good.replace('{"@type":"Article"}', '{"@type":');
  assert.equal(deriveSignalsFromHtml(html, "beginner mirrorless camera").signals.structuredDataValidity, 40);
});

test("improvements sort by largest gap and treat duplicate content as lower-is-better", () => {
  const mine: PageSignals = {
    id: "mine", title: "Mine", url: "https://example.com/mine", description: "",
    relevance: 50, usefulness: 50, titleHeadingMatch: 50, internalLinkSupport: 50,
    backlinkQuality: 20, crawlability: 50, mobileUsability: 50, pageExperience: 50,
    structuredDataValidity: 50, freshness: 50, trustEvidence: 50, intentFit: 50,
    duplicateContent: 60, indexable: true,
  };
  const top: PageSignals = { ...mine, id: "top", backlinkQuality: 60, duplicateContent: 10 };
  const improvements = suggestImprovements(mine, top, 3, 10);
  assert.equal(improvements[0].key, "duplicateContent");
  assert.equal(improvements[0].gap, 50);
  assert.equal(improvements[1].key, "backlinkQuality");
  assert.equal(improvements[1].gap, 40);
});
