# SEO Algorithm Classroom Simulator

An interactive, browser-based teaching tool that demonstrates how selected Google Search milestones may affect example search results.

## Important data note

This project is an educational simulation, not a Google product and not a live search-ranking tool. Search result titles, domains, ranking positions, deltas, signal values, and scenario outcomes are illustrative examples. Historical summaries simplify complex changes; Google does not publish all ranking-system details or weights. Do not treat simulated values as verified historical measurements or predictions of real rankings.

Some example URLs and numerical claims are placeholders or fictional scenario data. Historical quotations should be independently verified before being used in academic work. Use primary Google Search Central posts and other reliable sources to validate dates and descriptions.

## Run locally

**Requirements:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env.local` from `.env.example` and configure `GEMINI_API_KEY` only if you use the Gemini-powered features.
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Create a production build:
   ```bash
   npm run build
   ```

## How to use the simulator

1. Choose a milestone from the timeline or dropdown.
2. Select one of the scenario options.
3. Run the simulation and inspect the changed example results.
4. Use **Compare with starting results** to discuss the differences.
5. Open the underlying page signals for a more detailed classroom discussion.

## GitHub Pages note

This repository uses Vite. GitHub Pages must serve the built `dist` output, and the Vite `base` setting must match the repository path (for a project site, usually `/SEO-Algorithm-Classroom-Simulator/`). A deployment workflow should build the app before publishing it. The app's server-side Gemini features will not work on a static GitHub Pages site unless they are replaced with a secure backend; never put a private API key in client-side code.

## Suggested data-quality improvements

- Add a source link and confidence note for each historical milestone.
- Remove or label unattributed quotations until their original sources are verified.
- Distinguish confirmed historical facts from hypothetical scenario values.
- Recheck dates and terminology when Google's systems change (for example, Core Web Vitals metrics and Helpful Content system history).
