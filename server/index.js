import express from "express";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173,https://manmicheal214-maker.github.io").split(",").map(x=>x.trim()).filter(Boolean);
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
app.use((req,res,next)=>{
 const origin=req.headers.origin;
 if(origin && allowedOrigins.includes(origin)){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","POST,GET,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");}
 if(req.method==="OPTIONS") return res.sendStatus(204);
 next();
});
app.use(express.json({limit:MAX_BODY,strict:true}));
app.use((req,res,next)=>{
 const key=String(req.ip||req.socket.remoteAddress||"unknown");
 const now=Date.now(); let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>=WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket);}
 bucket.count++;
 if(bucket.count>LIMIT){res.setHeader("Retry-After","60");return res.status(429).json({error:"Too many requests. Please wait a minute and try again."});}
 if(buckets.size>2000) for(const [k,v] of buckets) if(now-v.start>=WINDOW_MS)buckets.delete(k);
 next();
});
const safeText=(v,max=1200)=>typeof v==="string"?v.trim().slice(0,max):"";
const isRecord=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function validPages(pages){
 return Array.isArray(pages)&&pages.length>=1&&pages.length<=40&&pages.every(p=>isRecord(p)&&typeof p.id==="string"&&p.id.length<=80&&typeof p.title==="string"&&p.title.length<=180&&typeof p.url==="string"&&p.url.length<=300&&["usefulness","duplicateContent","trustEvidence","relevance","intentFit"].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=100));
}
function parseJson(text){
 const clean=String(text||"").replace(/^`{3}(?:json)?\s*/i,"").replace(/\s*`{3}$/,"");
 return JSON.parse(clean);
}
async function generate(prompt){
 if(!ai) throw Object.assign(new Error("Gemini is not configured. Set GEMINI_API_KEY in the backend environment."),{status:503});
 const work=ai.models.generateContent({model,contents:prompt,config:{responseMimeType:"application/json"}});
 let timeout;
 try{
  const result=await Promise.race([work,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(new Error("The AI request timed out. Please try again."),{status:504})),timeoutMs);})]);
  return parseJson(result.text);
 }finally{clearTimeout(timeout);}
}
function validProposal(p,available){
 if(!isRecord(p)||p.action!=="panda_content_quality"||!Array.isArray(p.pageIds)||p.pageIds.length!==3||new Set(p.pageIds).size!==3||!p.pageIds.every(id=>available.has(id)))return false;
 return typeof p.title==="string"&&p.title.length<=140&&typeof p.summary==="string"&&p.summary.length<=700&&typeof p.rationale==="string"&&p.rationale.length<=900;
}
app.get("/health",(req,res)=>res.json({ok:true,service:"seo-scenario-agent",geminiConfigured:Boolean(ai)}));
app.post("/api/agent/propose",async(req,res)=>{
 const prompt=safeText(req.body?.prompt,1200);const pages=req.body?.pages;const query=safeText(req.body?.query,180);const intent=["informational","navigational","commercial","transactional"].includes(req.body?.intent)?req.body.intent:"commercial";
 if(prompt.length<5)return res.status(400).json({error:"Describe the experiment in at least 5 characters."});
 if(!validPages(pages))return res.status(400).json({error:"Provide 1–40 valid example pages with supported SEO signals."});
 try{
  const compact=pages.map(p=>({id:p.id,title:p.title,url:p.url,usefulness:p.usefulness,duplicateContent:p.duplicateContent,trustEvidence:p.trustEvidence,relevance:p.relevance,intentFit:p.intentFit}));
  const result=await generate("You are an SEO classroom scenario planner. Return JSON only with keys action,title,summary,rationale,pageIds,followUp. Only supported action is panda_content_quality. Choose exactly three distinct page ids from AVAILABLE_PAGES. Prefer pages with contrasting usefulness and duplicate-content risk. Do not invent page ids or claim Google ranking formulas. Do not request or generate arbitrary code. If the user requests unsupported behavior, still return a supported educational Panda-style content-quality experiment and explain the limitation in summary/rationale. Keep text concise. followUp must be a short question.\nUSER REQUEST: "+query+"\nSEARCH INTENT: "+intent+"\nUSER REQUEST: "+prompt+"\nAVAILABLE_PAGES: "+JSON.stringify(compact));
  const proposal={action:result.action,title:safeText(result.title,140),summary:safeText(result.summary,700),rationale:safeText(result.rationale,900),pageIds:result.pageIds,followUp:safeText(result.followUp,300)};
  if(!validProposal(proposal,new Set(pages.map(p=>p.id))))return res.status(502).json({error:"The AI returned an unsupported scenario. Try describing a Panda-style content-quality experiment."});
  res.json({proposal});
 }catch(e){console.error("scenario propose failed:",e?.message||e);res.status(e?.status||502).json({error:e?.status?e.message:"The scenario agent could not create a proposal. Please try again."});}
});
app.post("/api/agent/explain",async(req,res)=>{
 const question=safeText(req.body?.question,900);const context=req.body?.context;
 if(question.length<2)return res.status(400).json({error:"Ask a question about the experiment results."});
 if(!isRecord(context)||!Array.isArray(context.rows)||context.rows.length>40||typeof context.query!=="string"||!["informational","navigational","commercial","transactional"].includes(context.intent))return res.status(400).json({error:"Provide a valid computed experiment result."});
 const rows=context.rows.filter(r=>isRecord(r)&&typeof r.title==="string"&&Number.isFinite(r.beforeScore)&&Number.isFinite(r.afterScore)&&[r.beforePosition,r.afterPosition].every(v=>v===null||Number.isFinite(v))).map(r=>({title:safeText(r.title,160),beforePosition:r.beforePosition,afterPosition:r.afterPosition,beforeScore:r.beforeScore,afterScore:r.afterScore,signals:r.signals}));
 try{
  const answer=await generate("You are an SEO tutor. Explain only the calculated results supplied below. Never invent scores, positions, or causal certainty. Explicitly distinguish the simulator's deterministic educational model from Google's real systems. If asked for unsupported operations, state the limitation. Return JSON with keys answer and followUp. Answer in 2-5 concise sentences and end with a useful question in followUp.\nQUERY: "+safeText(context.query,180)+"\nINTENT: "+context.intent+"\nSELECTED SCENARIO: "+safeText(context.scenario,700)+"\nCALCULATED RESULTS: "+JSON.stringify(rows)+"\nSTUDENT QUESTION: "+question);
  const response={answer:safeText(answer.answer,1400),followUp:safeText(answer.followUp,300)};
  if(!response.answer)return res.status(502).json({error:"The AI returned an empty explanation. Please ask again."});
  res.json(response);
 }catch(e){console.error("scenario explain failed:",e?.message||e);res.status(e?.status||502).json({error:e?.status?e.message:"The AI tutor could not explain these results. Please try again."});}
});
app.use((err,req,res,next)=>{if(err?.type==="entity.too.large")return res.status(413).json({error:"Request is too large."});if(err instanceof SyntaxError)return res.status(400).json({error:"Request body must be valid JSON."});console.error("backend error:",err?.message||err);res.status(500).json({error:"Unexpected server error."});});
if (process.env.NODE_ENV !== "test") app.listen(port,"0.0.0.0",()=>console.log("SEO Scenario Agent listening on "+port));
export {app, validProposal, validPages};
