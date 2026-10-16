import test from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
const { app, validProposal, validPages } = await import("./index.js");
const { isBlockedIp } = await import("./ip.js");
import { createServer } from "node:http";
const server=createServer(app);
let base;
test("start isolated test server",async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));base="http://127.0.0.1:"+server.address().port;});
test("health endpoint reports service state without revealing credentials",async()=>{const r=await fetch(base+"/health");const data=await r.json();assert.equal(r.status,200);assert.equal(data.ok,true);assert.equal(data.service,"seo-scenario-agent");assert.equal("apiKey" in data,false);});
test("disabled scenario proposal endpoint does not call Gemini",async()=>{const r=await fetch(base+"/api/agent/propose",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"Run Panda quality experiment",pages:[]})});assert.equal(r.status,410);const data=await r.json();assert.match(data.error,/disabled/i);});
test("AI chat rejects missing or malformed message history",async()=>{const r=await fetch(base+"/api/ai/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages:[]})});assert.equal(r.status,400);});
test("URL inspection blocks localhost and non-HTTP protocols",async()=>{let r=await fetch(base+"/api/ai/analyze-url",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:"http://localhost:3000"})});assert.equal(r.status,400);r=await fetch(base+"/api/ai/analyze-url",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:"file:///etc/passwd"})});assert.equal(r.status,400);});
test("disabled scenario explanation endpoint does not call Gemini",async()=>{const r=await fetch(base+"/api/agent/explain",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:"Why?",context:{}})});assert.equal(r.status,410);const data=await r.json();assert.match(data.error,/disabled/i);});

test("SSRF IP guard blocks reserved IPv4, mapped IPv6, NAT64, 6to4 and reserved IPv6",()=>{
  for(const ip of ["224.0.0.1","239.255.255.250","240.0.0.1","255.255.255.255","192.0.0.1","192.0.2.1","198.51.100.1","203.0.113.1","192.88.99.1","::ffff:10.0.0.1","::ffff:a00:1","::ffff:169.254.169.254","::ffff:a9fe:a9fe","::ffff:192.168.1.1","::ffff:7f00:1","64:ff9b::7f00:1","64:ff9b::a9fe:a9fe","2002:7f00:1::1","2002:a9fe:a9fe::1","ff02::1","fec0::1","2001:db8::1"]) assert.equal(isBlockedIp(ip),true,ip);
  assert.equal(isBlockedIp("8.8.8.8"),false);
});
test("health remains available beyond API endpoint rate budgets",async()=>{
  const responses=await Promise.all(Array.from({length:35},()=>fetch(base+"/health")));
  assert.ok(responses.every(r=>r.status===200));
});
test("URL inspection rejects credentials and non-standard ports before DNS or fetch",async()=>{
  for(const url of ["https://user:pass@example.com/","http://example.com:8080/","https://example.com:444/"]){
    const r=await fetch(base+"/api/ai/analyze-url",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    assert.equal(r.status,400,url);
  }
});

test("stop test server",async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});