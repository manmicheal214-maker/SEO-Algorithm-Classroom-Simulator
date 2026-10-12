# SEO Strategy Lab

A browser-based educational workspace building on the original classroom simulator. It separates ranking logic into testable TypeScript modules.

## Features

- Responsive overview, ranking simulator, competitor lab, HTML audit, algorithm history, learning center and settings.
- Deterministic typed ranking model with intent-specific teaching weights, diminishing returns, relevance/usefulness interaction, eligibility checks and stable tie-breaking.
- SERP-style results, contribution explanations, warnings, before/after comparisons, editable sample pages, local saves and JSON export.
- Local HTML pattern checks for title, description, H1, image alt, canonical and robots meta.
- Selected milestones with Google Search Central source links; lessons and quiz feedback.

## Methodology and limits

All pages and ranking outputs are synthetic. This transparent teaching model does not reproduce Google's private ranking systems or predict real rankings. Weights and thresholds are assumptions, not observed Google measurements. Intent changes weights, signals use diminishing returns, and ineligible pages are excluded.

The audit checks only supplied HTML. It does not fetch URLs, crawl websites, measure Core Web Vitals, verify server responses or connect to Search Console. Competitor comparisons use sample signals. Historical descriptions are concise summaries; follow source links and verify details before citation.

## Local development and checks

Requires Node.js compatible with Vite 8 (Node 22.12+ recommended).

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

GitHub Actions builds and publishes the Vite dist directory. In Settings → Pages choose GitHub Actions.

## AI tutor and secrets

The Gemini SDK and environment template exist, but static GitHub Pages cannot make secure server-side Gemini calls. No active AI tutor is claimed in this build. To add one, deploy a backend that stores GEMINI_API_KEY in server environment secrets, validates input, applies request limits and never returns the key to the browser. Never commit credentials.

## Privacy and next steps

Experiments and lesson progress remain in browser localStorage; there is no account or sync. No live site is fetched. Extend tests for persistence and UI flows, add a secure AI backend, and label any future checks requiring live crawling or browser measurement. Some industry milestone names are not official Google update names.
