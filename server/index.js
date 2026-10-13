import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import dns from "node:dns/promises";
import net from "node:net";
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

const tutorTools=[{functionDeclarations:[
 {name:"propose_scenario",description:"Propose a supported educational Panda-style content quality experiment for student approval. Do not execute it.",parameters:{type:Type.OBJECT,properties:{title:{type:Type.STRING},learningObjective:{type:Type.STRING},milestoneId:{type:Type.STRING},searchIntent:{type:Type.STRING},query:{type:Type.STRING},hypothesis:{type:Type.STRING},controlledVariables:{type:Type.ARRAY,items:{type:Type.STRING}},changedVariables:{type:Type.ARRAY,items:{type:Type.STRING}},pageIds:{type:Type.ARRAY,items:{type:Type.STRING}},reflectionQuestions:{type:Type.ARRAY,items:{type:Type.STRING}}},required:["title","learningObjective","milestoneId","searchIntent","query","hypothesis","pageIds"]}},
 {name:"explain_simulation_results",description:"Explain actual supplied simulator results without changing scores or positions.",parameters:{type:Type.OBJECT,properties:{summary:{type:Type.STRING},keyFactors:{type:Type.ARRAY,items:{type:Type.STRING}},pedagogicalTakeaway:{type:Type.STRING},suggestedNextStep:{type:Type.STRING}},required:["summary","keyFactors","pedagogicalTakeaway"]}}
]}];
const tutorInstruction=`You are the AI SEO Tutor inside an SEO classroom. Follow Learn → Predict → Experiment → Observe → Analyze → Improve → Reflect. Distinguish documented Google history from synthetic classroom assumptions and deterministic calculated outcomes. Never claim live Google/Search Console data. Never invent positions or scores. When a student asks to run an experiment, call propose_scenario and wait for approval; only Panda-style content-quality experiments are currently executable. Do not claim other milestones are executed. In Learn mode answer concepts; in Experiment mode ask for a hypothesis; in Real Website mode discuss only user-provided inspection evidence. For before/after analysis use headings: 1) Before the update, 2) What changed, 3) Why simulated results moved, 4) Learning takeaway. Be encouraging and concise.`;
function isPrivateOrReservedIp(ip){
 if(net.isIPv4(ip)){const p=ip.split(".").map(Number);return p[0]===0||p[0]===10||p[0]===127||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||p[0]>=224;}
 if(net.isIPv6(ip)){const x=ip.toLowerCase();return x==="::1"||x==="::"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe80")||x.startsWith("::ffff:127.");}
 return true;
}
async function validatePublicUrl(raw){
 let url;try{url=new URL(raw);}catch{return {error:"Enter a valid website URL."};}
 if(!["http:","https:"].includes(url.protocol))return {error:"Only HTTP and HTTPS URLs are allowed."};
 const host=url.hostname.toLowerCase();
 if(!host||host==="localhost"||host.endsWith(".localhost"))return {error:"Localhost URLs are not allowed."};
 let addresses=[];try{addresses=net.isIP(host)?[host]:(await dns.lookup(host,{all:true})).map(x=>x.address);}catch{return {error:"The website hostname could not be resolved."};}
 if(!addresses.length||addresses.some(isPrivateOrReservedIp))return {error:"Private, loopback, and reserved network addresses are blocked."};
 return {url};
}
app.post("/api/ai/chat",async(req,res)=>{
 const messages=req.body?.messages;const state=req.body?.simulatorState;const mode=["learn","experiment","real-website"].includes(req.body?.mode)?req.body.mode:"learn";
 if(!Array.isArray(messages)||!messages.length||messages.length>20||messages.some(m=>!isRecord(m)||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>2000))return res.status(400).json({error:"Provide 1–20 valid chat messages, each under 2,000 characters."});
 if(!ai)return res.status(503).json({error:"Gemini is not configured on the backend. Set GEMINI_API_KEY."});
 const contents=messages.map((m,i)=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content+(i===messages.length-1&&isRecord(state)?"\n\n[CURRENT SIMULATOR STATE]\nQuery: "+safeText(state.query,180)+"\nIntent: "+safeText(state.intent,40)+"\nPage count: "+(Number.isFinite(state.pageCount)?Math.max(0,Math.min(40,state.pageCount)):0)+"\nTop result: "+safeText(state.topTitle,180)+" (score "+(Number.isFinite(state.topScore)?state.topScore:"unknown")+")\nMode: "+mode:"") }]}));
 try{
  let response;try{response=await ai.models.generateContent({model,contents,config:{systemInstruction:tutorInstruction,tools:tutorTools,temperature:0.4}});}catch(primary){console.warn("Gemini primary request failed; retrying fallback model:",primary?.message||primary);response=await ai.models.generateContent({model:"gemini-2.5-flash",contents,config:{systemInstruction:tutorInstruction,tools:tutorTools,temperature:0.4}});}
  res.json({text:safeText(response.text,5000),functionCalls:(response.functionCalls||[]).slice(0,3).map(call=>({name:safeText(call.name,80),args:isRecord(call.args)?call.args:{}})),finishReason:response.candidates?.[0]?.finishReason});
 }catch(e){console.error("AI tutor chat failed:",e?.message||e);res.status(502).json({error:"The AI tutor could not respond right now. Please try again."});}
});
app.post("/api/ai/analyze-url",async(req,res)=>{
 const raw=safeText(req.body?.url,2048);if(!raw)return res.status(400).json({error:"A website URL is required."});
 const checked=await validatePublicUrl(raw);if(checked.error)return res.status(400).json({error:checked.error});
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6000);
 try{
  const response=await fetch(checked.url.href,{signal:controller.signal,redirect:"manual",headers:{"User-Agent":"SEO-Strategy-Lab-EducationalBot/1.0","Accept":"text/html,application/xhtml+xml"}});
  if(response.status>=300&&response.status<400)return res.status(400).json({error:"Redirected URLs are not fetched for safety. Enter the final HTTPS address directly."});
  const type=response.headers.get("content-type")||"";if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))return res.status(415).json({error:"The URL did not return an HTML page."});
  const reader=response.body?.getReader();let size=0;const chunks=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;if(value){size+=value.length;if(size>512*1024){controller.abort();return res.status(413).json({error:"HTML page is larger than the 512 KB inspection limit."});}chunks.push(value);}}
  const html=Buffer.concat(chunks).toString("utf8");
  const match=(regex)=>html.match(regex)?.[1]?.replace(/&amp;/g,"&").replace(/&quot;/g,'"').trim()||"";
  const title=match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description=match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)||match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  const h1s=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>m[1].replace(/<[^>]+>/g," ").trim()).filter(Boolean).slice(0,5);
  const canonical=match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
  const robots=match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  const images=(html.match(/<img\b/gi)||[]).length;const imagesWithAlt=(html.match(/<img\b(?=[^>]*\balt\s*=)[^>]*>/gi)||[]).length;
  res.json({url:checked.url.href,statusCode:response.status,contentType:type,observed:{title,metaDescription:description,h1Count:h1s.length,h1s,canonical,robotsMeta:robots,imagesFound:images,imagesWithAlt,hasStructuredData:/<script\s+type=["']application\/ld\+json["']/i.test(html)},extractedSignals:{title:title||"Inspected webpage",url:checked.url.href,description:description||"Extracted from page metadata.",crawlability:response.status===200&&!/noindex/i.test(robots)?92:20,indexable:!/noindex/i.test(robots),titleHeadingMatch:title&&h1s.length?82:title?55:25,structuredDataValidity:/<script\s+type=["']application\/ld\+json["']/i.test(html)?85:30,relevance:75,usefulness:70,internalLinkSupport:65,backlinkQuality:50,mobileUsability:75,pageExperience:70,freshness:70,trustEvidence:65,intentFit:70,duplicateContent:10},limitations:["Signal values not directly observable from HTML are illustrative defaults, not measurements.","This inspection does not crawl Google or validate live search rankings."]});
 }catch(e){console.error("URL analysis failed:",e?.message||e);res.status(e?.name==="AbortError"?408:502).json({error:e?.name==="AbortError"?"Website inspection timed out.":"The website could not be inspected."});}finally{clearTimeout(timer);}
});

app.post("/api/agent/propose",async(req,res)=>{
 const prompt=safeText(req.body?.prompt,1200);const pages=req.body?.pages;const query=safeText(req.body?.query,180);const intent=["informational","navigational","commercial","transactional"].includes(req.body?.intent)?req.body.intent:"commercial";
 if(prompt.length<5)return res.status(400).json({error:"Describe the experiment in at least 5 characters."});
 if(!validPages(pages))return res.status(400).json({error:"Provide 1–40 valid example pages with supported SEO signals."});
 try{
  const compact=pages.map(p=>({id:p.id,title:p.title,url:p.url,usefulness:p.usefulness,duplicateContent:p.duplicateContent,trustEvidence:p.trustEvidence,relevance:p.relevance,intentFit:p.intentFit}));
  const result=await generate("You are an SEO classroom scenario planner. Return JSON only with keys action,title,summary,rationale,pageIds,followUp. Only supported action is panda_content_quality. Choose exactly three distinct page ids from AVAILABLE_PAGES. Prefer pages with contrasting usefulness and duplicate-content risk. Do not invent page ids or claim Google ranking formulas. Do not request or generate arbitrary code. If the user requests unsupported behavior, still return a supported educational Panda-style content-quality experiment and explain the limitation in summary/rationale. Keep text concise. followUp must be a short question.\nCURRENT SIMULATOR QUERY: "+query+"\nSEARCH INTENT: "+intent+"\nUSER REQUEST: "+prompt+"\nAVAILABLE_PAGES: "+JSON.stringify(compact));
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
