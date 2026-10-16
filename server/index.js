import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { isBlockedIp } from "./ip.js";
import "dotenv/config";

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173,https://manmicheal214-maker.github.io")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const buckets = new Map();
const WINDOW_MS = 60_000;
const CHAT_LIMIT = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_CHAT || "30", 10) || 30);
const URL_LIMIT = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_URL_INSPECTION || "10", 10) || 10);
const MAX_BODY = "24kb";
const timeoutMs = 18_000;

app.disable("x-powered-by");
app.set("trust proxy", 1);

// CORS / preflight
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Route-specific budgets avoid making a whole classroom behind one NAT share a tiny global quota.
app.use((req, res, next) => {
  if (req.path === "/health" || req.method === "OPTIONS") return next();
  const limit = req.path === "/api/ai/chat" ? CHAT_LIMIT : req.path === "/api/ai/analyze-url" ? URL_LIMIT : null;
  if (limit === null) return next();
  const now = Date.now();
  const key = `${req.ip || req.socket.remoteAddress || "unknown"}:${req.path}`;
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.start)) / 1000))));
    return res.status(429).json({ error: "Too many requests for this endpoint. Please wait and try again." });
  }
  bucket.count++;
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) if (now - v.start >= WINDOW_MS) buckets.delete(k);
    while (buckets.size > 2000) buckets.delete(buckets.keys().next().value);
  }
  next();
});

app.use(express.json({ limit: MAX_BODY, strict: true }));

const safeText = (v, max = 1200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function validPages(pages) {
  if (!Array.isArray(pages)) return false;
  if (pages.length < 1 || pages.length > 40) return false;
  return pages.every((p) => {
    if (!isRecord(p)) return false;
    if (typeof p.id !== "string" || p.id.length > 80) return false;
    if (typeof p.title !== "string" || p.title.length > 180) return false;
    if (typeof p.url !== "string" || p.url.length > 240) return false;
    // numeric signal fields are optional in many test fixtures — validate only when present
    const checkNum = (k) => !(k in p) || (typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 100);
    if (!checkNum("usefulness")) return false;
    if (!checkNum("duplicateContent")) return false;
    if (!checkNum("trustEvidence")) return false;
    if (!checkNum("relevance")) return false;
    if (!checkNum("intentFit")) return false;
    if (!checkNum("pageQuality")) return false;
    return true;
  });
}

function parseJson(text) {
  const clean = String(text || "").replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/, "");
  return JSON.parse(clean);
}

async function withTimeout(work, ms = timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Object.assign(new Error("The AI request timed out. Please try again."), { status: 504 })), ms);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
async function generate(prompt) {
  if (!ai) throw Object.assign(new Error("Gemini is not configured. Set GEMINI_API_KEY in the backend environment."), { status: 503 });
  const result = await withTimeout(ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: "application/json" } }));
  return parseJson(result.text);
}

function validProposal(p, available) {
  if (!isRecord(p) || p.action !== "panda_content_quality" || !Array.isArray(p.pageIds) || p.pageIds.length !== 3) return false;
  if (new Set(p.pageIds).size !== 3) return false;
  if (!p.pageIds.every((id) => available.has(id))) return false;
  if (typeof p.title !== "string" || p.title.length > 140) return false;
  if (typeof p.summary !== "string" || p.summary.length > 700) return false;
  if (typeof p.rationale !== "string" || p.rationale.length > 900) return false;
  return true;
}

app.get("/health", (req, res) => res.json({ ok: true, service: "seo-scenario-agent", geminiConfigured: Boolean(ai) }));

const tutorTools = [
  {
    functionDeclarations: [
      {
        name: "propose_scenario",
        description: "Propose a supported educational Panda-style content quality experiment for student approval. Do not execute it.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Short experiment title." },
            summary: { type: Type.STRING, description: "One-paragraph summary of the experiment." },
            rationale: { type: Type.STRING, description: "Logic tying the experiment to Panda-style content quality improvement." },
            pageIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Exactly three relevant example page IDs." },
            followUp: { type: Type.STRING, description: "A brief next step question for the learner." },
          },
          required: ["title", "summary", "rationale", "pageIds", "followUp"],
        },
      },
      {
        name: "explain_simulation_results",
        description: "Explain actual supplied simulator results without changing scores or positions.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING, description: "Plain-language explanation of the actual results." },
            followUp: { type: Type.STRING, description: "Optional next-step prompt to deepen the learner's analysis." },
          },
          required: ["answer"],
        },
      },
    ],
  },
];

const tutorInstruction = `You are the AI SEO Tutor inside an SEO classroom. Follow Learn → Predict → Experiment → Observe → Analyze → Improve → Reflect. Distinguish documented Google historical guidance from the synthetic simulator model. Use the lesson intent and explain only the supplied data. If the question is outside the approved scenario, say so and guide the learner. Keep the tone supportive, precise, and educational.`;


async function validatePublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "Enter a valid website URL." };
  }
  if (!["http:", "https:"].includes(url.protocol)) return { error: "Only HTTP and HTTPS URLs are allowed." };
  if (url.username || url.password) return { error: "URLs with credentials are not allowed." };
  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) return { error: "Only ports 80 and 443 are allowed." };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return { error: "Localhost URLs are not allowed." };
  let addresses = [];
  try {
    addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((x) => x.address);
  } catch {
    return { error: "The website hostname could not be resolved." };
  }
  if (!addresses.length || addresses.some(isBlockedIp)) return { error: "Private, loopback, and reserved network addresses are blocked." };
  return { url, addresses };
}

function fetchPinnedHtml(url, addresses, timeoutMs = 6000, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const selected = addresses.find((address) => !isBlockedIp(address));
    if (!selected) return reject(new Error("No safe resolved address."));
    const family = net.isIP(selected);
    const req = transport.request(url, {
      method: "GET",
      headers: { "User-Agent": "SEO-Strategy-Lab-EducationalBot/1.0", Accept: "text/html,application/xhtml+xml" },
      // Pin the socket to an address already checked by validatePublicUrl. Keep url.hostname
      // as the request host so HTTPS certificate validation and SNI use the original hostname.
      lookup: (_hostname, _options, callback) => callback(null, selected, family),
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(Object.assign(new Error("HTML page is too large for analysis."), { code: "HTML_TOO_LARGE" }));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ statusCode: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("Website inspection timed out."), { name: "AbortError" })));
    req.on("error", reject);
    req.end();
  });
}

app.post("/api/ai/chat", async (req, res) => {
  const messages = req.body?.messages;
  const state = req.body?.simulatorState;
  const mode = ["learn", "experiment", "real-website"].includes(req.body?.mode) ? req.body.mode : "learn";
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 3 ||
    messages.some((m) => !isRecord(m) || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 2000)
  )
    return res.status(400).json({ error: "Send up to 3 recent messages with user/assistant roles and text content." });
  if (!ai) return res.status(503).json({ error: "Gemini is not configured on the backend. Set GEMINI_API_KEY." });

  const contents = messages.map((m, i) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content + (i === messages.length - 1 && isRecord(state) ? "\n\n[CURRENT SIMULATOR STATE]\nQuery: " + safeText(state.query, 500) + "\nIntent: " + safeText(state.intent, 40) + "\nResults: " + JSON.stringify({ pageCount: Array.isArray(state.pages) ? state.pages.length : 0, focus: safeText(state.focus, 150), timeframe: safeText(state.timeframe, 80) }) : "") }] }));

  try {
    let response;
    try {
      response = await withTimeout(ai.models.generateContent({ model, contents, config: { systemInstruction: tutorInstruction, tools: tutorTools, temperature: 0.4 } }));
    } catch (primary) {
      console.warn("Gemini primary call failed:", primary?.message || primary);
      // fallback without tools if primary fails
      response = await withTimeout(ai.models.generateContent({ model, contents, config: { systemInstruction: tutorInstruction, temperature: 0.4 } }));
    }
    const allowedCalls = new Set(["propose_scenario", "explain_simulation_results"]);
    const functionCalls = Array.isArray(response?.functionCalls) ? response.functionCalls.slice(0, 3).flatMap((call) => {
      if (!isRecord(call) || !allowedCalls.has(call.name) || !isRecord(call.args)) return [];
      if (call.name === "propose_scenario") {
        const args = call.args;
        const pageIds = Array.isArray(args.pageIds) ? args.pageIds.filter((id) => typeof id === "string").slice(0, 3) : [];
        const available = new Set(Array.isArray(state?.pages) ? state.pages.map((p) => p?.id).filter((id) => typeof id === "string") : []);
        if (pageIds.length !== 3 || new Set(pageIds).size !== 3 || !pageIds.every((id) => available.has(id))) return [];
        return [{ name: call.name, args: { title: safeText(args.title, 140), summary: safeText(args.summary, 700), rationale: safeText(args.rationale, 900), pageIds, followUp: safeText(args.followUp, 400) } }];
      }
      return [{ name: call.name, args: { answer: safeText(call.args.answer, 4000), followUp: safeText(call.args.followUp, 400) } }];
    }) : [];
    const text = safeText(response?.text, 5000);
    if (!text && functionCalls.length === 0) throw new Error("AI response contained no usable text or supported action.");
    res.json({ text, functionCalls, finishReason: safeText(response?.finishReason, 80) || "unknown" });
  } catch (e) {
    console.error("AI tutor chat failed:", e?.message || e);
    res.status(502).json({ error: "The AI tutor could not respond right now. Please try again." });
  }
});

app.post("/api/ai/analyze-url", async (req, res) => {
  const raw = safeText(req.body?.url, 2048);
  if (!raw) return res.status(400).json({ error: "A website URL is required." });
  const checked = await validatePublicUrl(raw);
  if (checked.error) return res.status(400).json({ error: checked.error });
  try {
    // Redirects are intentionally not followed: the user must submit the final URL so every
    // connection is validated and pinned to the DNS answers checked above.
    const response = await fetchPinnedHtml(checked.url, checked.addresses);
    if (response.statusCode >= 300 && response.statusCode < 400) return res.status(400).json({ error: "Redirected URLs are not fetched for safety. Enter the final HTTPS address directly." });
    if (response.statusCode < 200 || response.statusCode >= 300) return res.status(502).json({ error: "The website returned an unsuccessful response." });
    const type = String(response.headers["content-type"] || "");
    if (!type.toLowerCase().includes("text/html") && !type.toLowerCase().includes("application/xhtml+xml")) return res.status(415).json({ error: "The URL did not return an HTML page." });
    const html = response.body.toString("utf8");
    const decodeEntities = (value) => value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
    const match = (regex) => decodeEntities(html.match(regex)?.[1] || "").trim();
    const attr = (tag, name) => { const found = tag.match(new RegExp("\\b" + name + "\\s*=\\s*(['\"])(.*?)\\1", "i")); return found ? decodeEntities(found[2]).trim() : ""; };
    const metaValue = (name) => { for (const tag of html.match(/<meta\b[^>]*>/gi) || []) if (attr(tag, "name").toLowerCase() === name) return attr(tag, "content"); return ""; };
    const linkValue = (rel, attribute) => { for (const tag of html.match(/<link\b[^>]*>/gi) || []) if (attr(tag, "rel").toLowerCase().split(/\s+/).includes(rel)) return attr(tag, attribute); return ""; };
    const title = match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = metaValue("description");
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").trim()).filter(Boolean).slice(0, 5);
    const canonical = linkValue("canonical", "href");
    const robots = metaValue("robots");
    const images = (html.match(/<img\b/gi) || []).length;
    const imagesWithAlt = (html.match(/<img\b(?=[^>]*\balt\s*=)[^>]*>/gi) || []).length;
    res.json({ url: checked.url.href, statusCode: response.status, contentType: type, observed: { title, metaDescription: description, h1Count: h1s.length, h1s, canonical, robotsMeta: robots, imagesFound: images, imagesWithAlt } });
  } catch (e) {
    console.error("URL analysis failed:", e?.message || e);
    if (e?.code === "HTML_TOO_LARGE") return res.status(413).json({ error: "HTML page is too large for analysis." });
    res.status(e?.name === "AbortError" ? 408 : 502).json({ error: e?.name === "AbortError" ? "Website inspection timed out." : "The website could not be inspected right now." });
  }
});

// AI Scenario Agent is disabled to prevent unnecessary Gemini token usage.
app.post("/api/agent/propose", (req, res) => res.status(410).json({ error: "The AI Scenario Agent has been disabled." }));
app.post("/api/agent/explain", (req, res) => res.status(410).json({ error: "The AI Scenario Agent has been disabled." }));

app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
  if (err instanceof SyntaxError) return res.status(400).json({ error: "Request body is not valid JSON." });
  console.error("Unhandled server error:", err);
  res.status(500).json({ error: "Internal server error." });
});

if (process.env.NODE_ENV !== "test") app.listen(port, "0.0.0.0", () => console.log("SEO Scenario Agent listening on " + port));

export { app, validProposal, validPages };
