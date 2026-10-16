import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import dns from "node:dns/promises";
import net from "node:net";
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
const LIMIT = 12;
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: MAX_BODY, strict: true }));

// Simple in-memory rate limiting per IP
app.use((req, res, next) => {
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > LIMIT) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
  }
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) if (now - v.start >= WINDOW_MS) buckets.delete(k);
  }
  next();
});

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

async function generate(prompt) {
  if (!ai) throw Object.assign(new Error("Gemini is not configured. Set GEMINI_API_KEY in the backend environment."), { status: 503 });
  const work = ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: "application/json" } });
  let timeout;
  try {
    const result = await Promise.race([
      work,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Object.assign(new Error("The AI request timed out. Please try again."), { status: 504 })), timeoutMs);
      }),
    ]);
    return parseJson(result.text);
  } finally {
    clearTimeout(timeout);
  }
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
  if (url.username || url.password) return { error: "URLs with credentials are not allowed." };\n  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) return { error: "Only ports 80 and 443 are allowed." };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return { error: "Localhost URLs are not allowed." };
  let addresses = [];
  try {
    addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((x) => x.address);
  } catch {
    return { error: "The website hostname could not be resolved." };
  }
  if (!addresses.length || addresses.some(isBlockedIp)) return { error: "Private, loopback, and reserved network addresses are blocked." };
  return { url };
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
      response = await ai.models.generateContent({ model, contents, config: { systemInstruction: tutorInstruction, tools: tutorTools, temperature: 0.4 } });
    } catch (primary) {
      console.warn("Gemini primary call failed:", primary?.message || primary);
      // fallback without tools if primary fails
      response = await ai.models.generateContent({ model, contents, config: { systemInstruction: tutorInstruction, temperature: 0.4 } });
    }
    res.json({ text: safeText(response.text, 5000), functionCalls: (response.functionCalls || []).slice(0, 3).map((call) => ({ name: safeText(call.name, 80), args: isRecord(call.args) ? call.args : {} })), finishReason: response.finishReason || "unknown" });
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(checked.url.href, { signal: controller.signal, redirect: "manual", headers: { "User-Agent": "SEO-Strategy-Lab-EducationalBot/1.0", Accept: "text/html,application/xhtml+xml" } });
    if (response.status >= 300 && response.status < 400) return res.status(400).json({ error: "Redirected URLs are not fetched for safety. Enter the final HTTPS address directly." });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return res.status(415).json({ error: "The URL did not return an HTML page." });
    const reader = response.body?.getReader();
    let size = 0;
    const chunks = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          size += value.length;
          if (size > 512 * 1024) {
            controller.abort();
            return res.status(413).json({ error: "HTML page is too large for analysis." });
          }
          chunks.push(value);
        }
      }
    }
    const html = Buffer.concat(chunks).toString("utf8");
    const match = (regex) => html.match(regex)?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() || "";
    const title = match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").trim()).filter(Boolean).slice(0, 5);
    const canonical = match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
    const robots = match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
    const images = (html.match(/<img\b/gi) || []).length;
    const imagesWithAlt = (html.match(/<img\b(?=[^>]*\balt\s*=)[^>]*>/gi) || []).length;
    res.json({ url: checked.url.href, statusCode: response.status, contentType: type, observed: { title, metaDescription: description, h1Count: h1s.length, h1s, canonical, robotsMeta: robots, imagesFound: images, imagesWithAlt } });
  } catch (e) {
    console.error("URL analysis failed:", e?.message || e);
    res.status(e?.name === "AbortError" ? 408 : 502).json({ error: e?.name === "AbortError" ? "Website inspection timed out." : "The website could not be inspected right now." });
  } finally {
    clearTimeout(timer);
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
