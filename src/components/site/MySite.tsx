import {useState} from "react";
import {Globe} from "lucide-react";
import type {PageSignals,SearchIntent} from "../../engine/types";
import type {RankingResult} from "../../engine/ranking";
import {validatePageSignals} from "../../engine/scoring";
import {SIGNAL_KEYS,SIGNAL_LABELS,deriveSignalsFromHtml,suggestImprovements,type HtmlFinding,type SignalKey} from "../../engine/siteInput";

export const MY_SITE_ID="my-site";
const STORAGE_KEY="seo-lab-my-site";
interface Draft{url:string;title:string;description:string;html:string;indexable:boolean;signals:Record<SignalKey,number>}
const blank=():Draft=>({url:"https://",title:"",description:"",html:"",indexable:true,signals:Object.fromEntries(SIGNAL_KEYS.map(k=>[k,k==="duplicateContent"?10:50])) as Record<SignalKey,number>});
const load=():Draft=>{try{const raw=localStorage.getItem(STORAGE_KEY);return raw?{...blank(),...JSON.parse(raw)}:blank();}catch{return blank();}};
const store=(d:Draft)=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch{/* storage unavailable: keep working in memory */}};

/** Form: student enters their own site data; optional pasted HTML pre-fills signals. */
export function MySiteForm({query,onSubmit}:{query:string;intent:SearchIntent;onSubmit:(p:PageSignals)=>void}){
  const [d,setD]=useState<Draft>(load),[derived,setDerived]=useState<Set<SignalKey>>(new Set()),[findings,setFindings]=useState<HtmlFinding[]>([]),[errors,setErrors]=useState<string[]>([]);
  const set=(patch:Partial<Draft>)=>setD(old=>({...old,...patch}));
  const setSignal=(k:SignalKey,v:number)=>setD(old=>({...old,signals:{...old.signals,[k]:v}}));
  const analyse=()=>{const r=deriveSignalsFromHtml(d.html,query,d.url);setFindings(r.findings);setDerived(new Set(Object.keys(r.signals) as SignalKey[]));
    setD(old=>({...old,title:old.title||r.title,description:old.description||r.description,indexable:r.indexable,signals:{...old.signals,...r.signals} as Record<SignalKey,number>}));};
  const submit=()=>{const page:PageSignals={id:MY_SITE_ID,title:d.title.trim(),url:d.url.trim(),description:d.description.trim(),indexable:d.indexable,...d.signals};
    const errs=validatePageSignals(page);setErrors(errs);if(errs.length)return;store(d);onSubmit(page);};
  return <div className="card"><h3><Globe size={15}/> My website</h3>
    <p className="note">Enter your page details. Nothing is crawled or sent anywhere — signals are estimates you control.</p>
    <label>Page URL<input value={d.url} onChange={e=>set({url:e.target.value})} placeholder="https://yoursite.com/page"/></label>
    <label>Page title<input value={d.title} onChange={e=>set({title:e.target.value})}/></label>
    <label>Meta description<input value={d.description} onChange={e=>set({description:e.target.value})}/></label>
    <label>Paste page HTML (optional)<textarea rows={6} value={d.html} onChange={e=>set({html:e.target.value})} placeholder="<title>…</title> <h1>…</h1>"/></label>
    <button onClick={analyse} disabled={!d.html.trim()}>Estimate signals from HTML</button>
    {findings.length>0&&<div className="findings" aria-live="polite">{findings.map(f=><p className="checkrow" key={f.label}><b>{f.ok?"✓":"!"}</b><span>{f.label}<small>{f.note}</small></span><em>{f.ok?"PASS":"REVIEW"}</em></p>)}</div>}
    <h4>Signals</h4><p className="note">Tagged “from HTML” were estimated from your paste; adjust any slider. Off-page signals (backlinks, trust) are self-assessed.</p>
    {SIGNAL_KEYS.map(k=><label className="range" key={k}>{SIGNAL_LABELS[k]}{derived.has(k)&&<small> · from HTML</small>}<output>{d.signals[k]}</output><input type="range" min="0" max="100" value={d.signals[k]} aria-label={SIGNAL_LABELS[k]} onChange={e=>setSignal(k,Number(e.target.value))}/></label>)}
    <label><input type="checkbox" checked={d.indexable} onChange={e=>set({indexable:e.target.checked})}/> Indexable</label>
    {errors.length>0&&<p className="error" role="alert">{errors.join(" ")}</p>}
    <button className="primary" onClick={submit}>Rank my website</button>
    <button onClick={()=>{setD(blank());setDerived(new Set());setFindings([]);setErrors([]);store(blank());}}>Clear my site</button></div>;
}

/** Result: where the student's page lands, vs. the top result, with the biggest gaps. */
export function MySiteResult({rank}:{rank:RankingResult}){
  const mine=rank.results.find(r=>r.id===MY_SITE_ID),out=rank.excluded.find(r=>r.id===MY_SITE_ID),top=rank.results.find(r=>r.id!==MY_SITE_ID);
  if(!mine&&!out)return null;
  if(!mine&&out)return <div className="card"><h3>My website result</h3><p className="error">Excluded from the simulated results.</p>{out.warnings.map(w=><p key={w}>{w}</p>)}</div>;
  const gaps=mine&&top?suggestImprovements(mine,top):[];
  return <div className="card"><h3>My website result</h3>
    <p aria-live="polite"><b>Position {mine!.position} of {rank.results.length}</b> · score {mine!.score.toFixed(1)} / 100{top&&mine!.id!==top.id&&<> · top result: {top.title} ({top.score.toFixed(1)})</>}</p>
    {mine!.position===1?<p className="note">Your page ranks first in this synthetic SERP for “{rank.query}”.</p>:gaps.length>0?<><b>Biggest gaps vs. the top result</b>{gaps.map(g=><div className="contrib" key={g.key}><b>{g.label}</b><strong>{g.yours} vs {g.top}</strong><p>{g.key==="duplicateContent"?"Lower duplicate risk is better.":"Raising this signal is the quickest route up."}</p></div>)}</>:<p className="note">No large signal gaps — differences are spread across several small factors.</p>}
    {mine!.warnings.map(w=><p className="note" key={w}>{w}</p>)}</div>;
}
