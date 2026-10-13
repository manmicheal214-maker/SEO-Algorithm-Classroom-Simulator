# Gemini AI Scenario Agent

The AI agent is embedded in the existing React workspace. Gemini proposes a constrained experiment; the student must approve it; the browser then applies the supported deterministic transformation and computes rankings with the existing `simulateMilestone`, `rankPages`, and `compareRankings` functions. Gemini never returns ranking positions and cannot execute code.

## Local development

Requires Node.js 22.12+.

1. `npm install`
2. Copy `.env.example` to `.env` for local convenience. Put `GEMINI_API_KEY` only in the server-side environment. Never put it in a `VITE_*` variable.
3. In one terminal: `npm run dev:server`
4. In another: `npm run dev`
5. Open `http://localhost:3000/SEO-Algorithm-Classroom-Simulator/` and choose **AI Scenario Agent** for the approval-based Panda experiment or **AI SEO Tutor** for Learn, Experiment, and Real Website modes plus public HTML inspection.
6. Run `npm test`, `npm run test:server`, `npm run typecheck`, and `npm run build`.

The browser calls `VITE_SCENARIO_API_URL` (defaults to `http://localhost:8787` in local development). This URL is public configuration, not a secret.

## Deploy the backend (Render example)

GitHub Pages is static hosting and cannot securely store a Gemini key. Deploy this repository as a separate Render Web Service:
- Runtime: Node
- Build command: `npm install`
- Start command: `npm run start:server`
- Health check path: `/health`
- Environment secrets: `GEMINI_API_KEY` (required), `GEMINI_MODEL=gemini-2.5-flash`, `ALLOWED_ORIGINS=https://manmicheal214-maker.github.io`, `NODE_ENV=production`.
- Set a GitHub repository **Actions variable** named `VITE_SCENARIO_API_URL` to the backend HTTPS URL (Settings → Secrets and variables → Actions → Variables). The Pages workflow reads this variable during `npm run build`. Do not set it to the Gemini key. A frontend rebuild/redeploy is required after changing it.

For local development add `http://localhost:3000,http://localhost:5173` to `ALLOWED_ORIGINS`. Do not commit `.env`. The backend enforces JSON body limits, short text limits, page/signal validation, a per-IP in-memory request limit, timeout handling, and allowlisted scenario actions. The adapted AI Tutor also exposes `/api/ai/chat` with Gemini function declarations for `propose_scenario` and `explain_simulation_results`, and `/api/ai/analyze-url` for bounded public HTML inspection. URL inspection only fetches HTML, blocks localhost/private/reserved IPs, does not follow redirects, has a 6-second timeout and 512 KB response cap. DNS/IP checks are defense-in-depth, not a substitute for network-level egress restrictions on a production deployment. Rate limiting is per instance and resets on restart; use managed edge/API limits for high-traffic production.

## Supported first scenario

The first supported scenario is Panda-style content quality. The AI proposes exactly three existing page IDs and explains the suggested experiment. After approval, the frontend applies the existing educational Panda milestone transformation to those three pages only, reruns the existing ranking engine on the full page set, and computes movement from actual before/after results. The experiment is reproducible and can be reset. This is a teaching approximation, not Google's private formula.

## Deployment limitations

The backend must be deployed separately and its URL configured before the live AI feature can call Gemini. No Gemini key is required or sent by the frontend. The Pages workflow remains the static frontend deployment workflow.


## Reference workflow adapted

The public [New-SEO-Class-room](https://github.com/manmicheal214-maker/New-SEO-Class-room) project uses three tutor modes, a Gemini chat endpoint with function declarations, and a public URL inspection endpoint. This repository now adapts those workflow ideas into the existing SEO Strategy Lab rather than copying the reference application's bundled server/Vite deployment:
- **Learn Mode** answers conceptual SEO questions.
- **Experiment Mode** encourages a hypothesis and exposes a constrained `propose_scenario` tool call; execution remains in the existing AI Scenario Agent approval flow.
- **Real Website Mode** discusses SEO evidence and includes bounded public HTML inspection.
- **Function calling** advertises proposal and result-explanation tools. The model's function call is not directly executed as arbitrary code.
- **URL inspection** returns observed HTML fields and clearly labeled illustrative defaults for signals that cannot be inferred from static HTML.
