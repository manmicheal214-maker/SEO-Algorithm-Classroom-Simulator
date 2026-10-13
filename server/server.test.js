import test from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
const { app, validProposal, validPages } = await import("./index.js");
import { createServer } from "node:http";

const server=createServer(app);
let base;
test("start isolated test server",async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));base="http://127.0.0.1:"+server.address().port;});
test("health endpoint reports service state without revealing credentials",async()=>{const r=await fetch(base+"/health");const data=await r.json();assert.equal(r.status,200);assert.equal(data.ok,true);assert.equal(data.service,"seo-scenario-agent");assert.equal("apiKey" in data,false);});
test("proposal endpoint rejects short prompts and malformed page signals",async()=>{let r=await fetch(base+"/api/agent/propose",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"hi",pages:[]})});assert.equal(r.status,400);r=await fetch(base+"/api/agent/propose",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"Panda quality experiment",pages:[{id:"p1",title:"Page",url:"https://example.com",usefulness:140,duplicateContent:1,trustEvidence:1,relevance:1,intentFit:1}]})});assert.equal(r.status,400);});
test("explain endpoint rejects missing computed ranking context",async()=>{const r=await fetch(base+"/api/agent/explain",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:"Why?",context:{}})});assert.equal(r.status,400);});
test("proposal validator allows only three known unique page ids and the supported action",()=>{const ids=new Set(["a","b","c"]);const base={action:"panda_content_quality",title:"Panda test",summary:"Summary",rationale:"Reason",pageIds:["a","b","c"]};assert.equal(validProposal(base,ids),true);assert.equal(validProposal({...base,pageIds:["a","a","b"]},ids),false);assert.equal(validProposal({...base,pageIds:["a","b","x"]},ids),false);assert.equal(validProposal({...base,action:"arbitrary_code"},ids),false);});
test("proposal endpoint returns a clear setup error when Gemini key is absent",async()=>{if(process.env.GEMINI_API_KEY)return;const pages=["a","b","c"].map((id,i)=>({id,title:"Page "+id,url:"https://example.com/"+id,usefulness:40+i,duplicateContent:20+i,trustEvidence:50,relevance:60,intentFit:60}));const r=await fetch(base+"/api/agent/propose",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"Run Panda content quality experiment",pages})});assert.equal(r.status,503);const data=await r.json();assert.match(data.error,/GEMINI_API_KEY/);});
test("stop test server",async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
