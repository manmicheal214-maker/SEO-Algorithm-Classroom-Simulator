import { useMemo, useState } from "react";
import { Bot, CheckCircle2, CircleAlert, FlaskConical, LoaderCircle, RotateCcw, Send, Sparkles } from "lucide-react";
import { rankPages, compareRankings } from "../engine/ranking";
import { simulateMilestone } from "../engine/historySimulation";
import { milestones } from "../data/milestones";
import type { PageSignals, SearchIntent } from "../engine/types";

type Proposal={action:"panda_content_quality";title:string;summary:string;rationale:string;pageIds:string[];followUp:string};
type Ranked=ReturnType<typeof rankPages>;
type Comparison=ReturnType<typeof compareRankings>;
type Props={pages:PageSignals[];query:string;intent:SearchIntent};
const API_BASE=(import.meta.env.VITE_SCENARIO_API_URL as string|undefined)?.replace(/\/$/,"") || (import.meta.env.DEV?"http://localhost:8787":"");
const SUGGESTIONS=[
 "Run a Panda-style experiment on three websites: compare thin content, duplicated content, and a useful authoritative page.",
 "Use three example websites to explore how improving content usefulness could change this query's rankings.",
 "Compare three pages with contrasting duplicate-content risk and explain the trade-offs."
];
async function request<T>(path:string,body:unknown):Promise<T>{
 if(!API_BASE)throw new Error("The AI backend URL is not configured for this deployment yet.");
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),22000);
 try{
  const response=await fetch(API_BASE+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof data.error==="string"?data.error:"The AI service could not complete the request.");
  return data as T;
 }catch(error){if(error instanceof DOMException&&error.name==="AbortError")throw new Error("The request timed out. Please try again.");throw error;}finally{clearTimeout(timer);}
}
export default function AIScenarioAgent({pages,query,intent}:Props){
 const [prompt,setPrompt]=useState("");const [proposal,setProposal]=useState<Proposal|null>(null);const [before,setBefore]=useState<Ranked|null>(null);const [after,setAfter]=useState<Ranked|null>(null);const [comparisons,setComparisons]=useState<Comparison>([]);const [busy,setBusy]=useState<"propose"|"run"|"explain"|null>(null);const [error,setError]=useState("");const [status,setStatus]=useState("Ready for an experiment.");const [question,setQuestion]=useState("");const [answer,setAnswer]=useState("");const [followUp,setFollowUp]=useState("");
 const available=useMemo(()=>new Map(pages.map(p=>[p.id,p])),[pages]);
 const selectedPages=proposal?.pageIds.map(id=>available.get(id)).filter((p):p is PageSignals=>Boolean(p))??[];
 const reset=()=>{setBefore(null);setAfter(null);setComparisons([]);setAnswer("");setFollowUp("");setStatus("Reset to the current simulator baseline.");setError("");};
 const propose=async(text=prompt)=>{
  const trimmed=text.trim();if(trimmed.length<5){setError("Describe the experiment in a little more detail.");return;}
  setBusy("propose");setError("");setAnswer("");setFollowUp("");setStatus("Asking Gemini to draft a supported scenario…");
  try{const data=await request<{proposal:Proposal}>("/api/agent/propose",{prompt:trimmed,query,intent,pages:pages.map(p=>({id:p.id,title:p.title,url:p.url,usefulness:p.usefulness,duplicateContent:p.duplicateContent,trustEvidence:p.trustEvidence,relevance:p.relevance,intentFit:p.intentFit}))});
   setProposal(data.proposal);setBefore(null);setAfter(null);setComparisons([]);setStatus("Proposal ready. Review it before running.");setPrompt(trimmed);
  }catch(e){setError(e instanceof Error?e.message:"Could not create a proposal.");setStatus("Proposal was not created.");}finally{setBusy(null);}
 };
 const runScenario=()=>{
  if(!proposal){setError("Create and review a proposal first.");return;}
  if(proposal.action!=="panda_content_quality"){setError("This scenario type is not supported.");return;}
  const selected=proposal.pageIds.map(id=>available.get(id));
  if(selected.length!==3||selected.some(p=>!p)){setError("One or more selected example pages are no longer available. Create a new proposal.");return;}
  setBusy("run");setError("");setAnswer("");setFollowUp("");setStatus("Calculating with the existing ranking engine…");
  try{
   const baselinePages=pages.map(p=>({...p}));
   const beforeRank=rankPages(query,intent,baselinePages);
   const panda=milestones.find(m=>m.id==="panda");
   if(!panda)throw new Error("The Panda teaching profile is unavailable.");
   const changed=simulateMilestone(selected as PageSignals[],panda);
   const selectedIds=new Set(proposal.pageIds);
   const changedById=new Map(changed.pages.map(p=>[p.id,p]));
   const nextPages=baselinePages.map(p=>selectedIds.has(p.id)?(changedById.get(p.id)??p):p);
   const afterRank=rankPages(query,intent,nextPages);
   setBefore(beforeRank);setAfter(afterRank);setComparisons(compareRankings(beforeRank,afterRank));setStatus("Scenario executed. Positions and scores below come from the local ranking engine.");
  }catch(e){setError(e instanceof Error?e.message:"The scenario could not be executed.");setStatus("Execution failed.");}finally{setBusy(null);}
 };
 const explain=async(text=question)=>{
  if(!before||!after||!proposal){setError("Run the proposed scenario before asking about its results.");return;}
  const trimmed=text.trim();if(trimmed.length<2){setError("Enter a question about the calculated results.");return;}
  setBusy("explain");setError("");setStatus("Asking Gemini to explain the calculated results…");
  try{
   const rows=comparisons.map(c=>{const b=before.results.find(p=>p.id===c.pageId);const a=after.results.find(p=>p.id===c.pageId);const p=available.get(c.pageId);return {title:p?.title??c.pageId,beforePosition:c.before,afterPosition:c.after,beforeScore:b?.score??0,afterScore:a?.score??0,signals:p?{usefulness:p.usefulness,duplicateContent:p.duplicateContent,trustEvidence:p.trustEvidence}:undefined};});
   const data=await request<{answer:string;followUp:string}>("/api/agent/explain",{question:trimmed,context:{query,intent,scenario:proposal.summary,rows}});
   setAnswer(data.answer);setFollowUp(data.followUp);setQuestion(trimmed);setStatus("Explanation grounded in the calculated comparison.");
  }catch(e){setError(e instanceof Error?e.message:"Could not explain these results.");setStatus("Explanation failed.");}finally{setBusy(null);}
 };
 return <div className="agent-layout">
  <section className="card agent-hero"><div className="agent-icon"><Bot size={22}/></div><div><small>GEMINI-POWERED · HUMAN-APPROVED</small><h2>AI Scenario Agent</h2><p>Describe an SEO experiment. Gemini proposes a bounded scenario; you approve it, and the existing ranking engine calculates the results.</p></div><span className="agent-pill">● Controlled tools</span></section>
  <section className="card"><div className="agent-section-head"><div><h3><Sparkles size={16}/> Describe your experiment</h3><p>Start with a Panda-style content-quality experiment. Gemini cannot invent ranking positions or run arbitrary code.</p></div></div>
   <div className="suggestion-list">{SUGGESTIONS.map(s=><button key={s} className="suggestion" disabled={!!busy} onClick={()=>{setPrompt(s);void propose(s)}}>{s}</button>)}</div>
   <form className="agent-chat" onSubmit={e=>{e.preventDefault();void propose();}}><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={1200} rows={3} placeholder="Example: Compare three sites with different content quality and duplicate-content risk using a Panda-style update." aria-label="Describe an SEO experiment"/><div className="agent-chat-footer"><small>{prompt.length}/1200 · Current query: {query}</small><button className="primary" disabled={!!busy||prompt.trim().length<5}><Send size={14}/>{busy==="propose"?"Planning…":"Send to Gemini"}</button></div></form>
  </section>
  {proposal&&<section className="card"><div className="agent-section-head"><div><h3><FlaskConical size={16}/> Proposed scenario</h3><p>Review the plan before running it against the current synthetic dataset.</p></div><span className="agent-pill review">Approval required</span></div><h2 className="proposal-title">{proposal.title}</h2><p>{proposal.summary}</p><div className="proposal-rationale"><b>Why this setup?</b><p>{proposal.rationale}</p>{proposal.followUp&&<p><b>Suggested reflection:</b> {proposal.followUp}</p>}</div><div className="agent-page-list">{selectedPages.map(p=><article key={p.id}><b>{p.title}</b><small>{p.url}</small><span>Usefulness {p.usefulness} · Duplicate risk {p.duplicateContent} · Trust {p.trustEvidence}</span></article>)}</div><div className="agent-actions"><button className="primary" onClick={runScenario} disabled={!!busy||selectedPages.length!==3}><CheckCircle2 size={15}/>{busy==="run"?"Calculating…":"Approve & Run Scenario"}</button><button onClick={()=>{setProposal(null);reset();setStatus("Proposal cancelled.");setError("");}} disabled={!!busy}>Cancel</button><button onClick={reset} disabled={!!busy}><RotateCcw size={14}/> Reset results</button></div></section>}
  <section className="card"><div className="agent-section-head"><div><h3>Execution status</h3><p>{status}</p></div>{busy&&<LoaderCircle className="agent-spinner" size={19}/>}</div>{error&&<p className="agent-error"><CircleAlert size={15}/>{error}</p>}</section>
  {before&&after&&proposal&&<section className="card"><div className="agent-section-head"><div><h3>Calculated before-and-after results</h3><p>Query: <b>{query}</b> · Intent: {intent} · Full rankings recalculated from the selected pages' transformed signals.</p></div><span className="agent-pill success">Engine results</span></div><div className="agent-summary-metrics"><div><small>Eligible before</small><b>{before.summary.eligible}</b></div><div><small>Eligible after</small><b>{after.summary.eligible}</b></div><div><small>Pages compared</small><b>{comparisons.length}</b></div></div><div className="tablewrap"><table className="agent-table"><thead><tr><th>Example website</th><th>Before position</th><th>After position</th><th>Movement</th><th>Score before → after</th></tr></thead><tbody>{comparisons.map(c=>{const page=available.get(c.pageId);const b=before.results.find(p=>p.id===c.pageId);const a=after.results.find(p=>p.id===c.pageId);const move=c.movement??0;return <tr key={c.pageId}><td><b>{page?.title??c.pageId}</b><small>{page?.url}</small>{proposal.pageIds.includes(c.pageId)&&<small className="agent-tag">Panda profile applied</small>}</td><td>{c.before??"Excluded"}</td><td>{c.after??"Excluded"}</td><td><span className={"movement "+(c.status==="newly-eligible"?"gain":c.status==="excluded"?"loss":move>0?"gain":move<0?"loss":"same")}>{c.status==="newly-eligible"?"Newly eligible":c.status==="excluded"?"Excluded":move>0?"↑ "+move+" positions":move<0?"↓ "+Math.abs(move)+" positions":"— unchanged"}</span></td><td>{b?.score.toFixed(2)??"—"} → {a?.score.toFixed(2)??"—"}</td></tr>})}</tbody></table></div><h3 className="agent-subhead">Post-experiment search results</h3>{after.results.map(p=><div className="result" key={p.id}><b className="pos">{p.position}</b><span><small>{p.url}</small><strong>{p.title}</strong><p>{p.description}</p><em>Calculated score {p.score.toFixed(2)} · Usefulness {p.usefulness} · Duplicate risk {p.duplicateContent}</em></span><b>{p.score.toFixed(1)}</b></div>)}</section>}
  <section className="card"><div className="agent-section-head"><div><h3><Bot size={16}/> Ask about the results</h3><p>Gemini receives the calculated scores and positions, not permission to change them.</p></div></div><form className="agent-chat" onSubmit={e=>{e.preventDefault();void explain();}}><textarea value={question} onChange={e=>setQuestion(e.target.value)} maxLength={900} rows={2} disabled={!after||!!busy} placeholder={after?"Why did the three selected websites move the way they did?":"Approve and run a scenario first."} aria-label="Ask a follow-up question"/><div className="agent-chat-footer"><small>{question.length}/900</small><button className="primary" disabled={!after||!!busy||question.trim().length<2}><Send size={14}/>{busy==="explain"?"Thinking…":"Ask Gemini"}</button></div></form>{answer&&<div className="agent-answer"><b>AI tutor explanation</b><p>{answer}</p>{followUp&&<button className="follow-up" onClick={()=>{setQuestion(followUp);void explain(followUp)}} disabled={!!busy}>Follow-up: {followUp}</button>}</div>}</section>
  <p className="agent-disclaimer">Teaching approximation only: the historical Panda milestone supplies illustrative signal transformations, not Google's proprietary formula or actual historical SERPs. AI explains results calculated by this app and cannot set rankings.</p>
 </div>;
}
