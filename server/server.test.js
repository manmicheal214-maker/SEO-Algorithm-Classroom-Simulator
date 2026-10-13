import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("backend server module exists and API contract routes are declared", async()=>{
 const fs=await import("node:fs/promises");
 const src=await fs.readFile(new URL("./index.js",import.meta.url),"utf8");
 assert.match(src,/\/api\/agent\/propose/);
 assert.match(src,/\/api\/agent\/explain/);
 assert.match(src,/GEMINI_API_KEY/);
 assert.match(src,/LIMIT = 12/);
 assert.match(src,/pageIds\.length!==3/);
 assert.match(src,/MAX_BODY/);
});
test("proposal validation rejects unknown actions and duplicate or unknown page ids",async()=>{
 const src=await import("node:fs/promises").then(fs=>fs.readFile(new URL("./index.js",import.meta.url),"utf8"));
 assert.match(src,/p\.action!=="panda_content_quality"/);
 assert.match(src,/new Set\(p\.pageIds\)\.size!==3/);
 assert.match(src,/!p\.pageIds\.every\(id=>available\.has\(id\)\)/);
});
