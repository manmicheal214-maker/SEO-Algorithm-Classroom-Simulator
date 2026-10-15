import test from "node:test";
import assert from "node:assert/strict";
import { getBiggestMover, copyPages, selectQuizQuestions } from "./historyHelpers";
import type { PageSignals } from "./types";
import type { RankingMovement } from "./historyHelpers";

const row=(pageId:string,movement:number|null,status:RankingMovement["status"]="ranked"):RankingMovement=>({pageId,before:movement===null?null:4,after:movement===null?null:4-movement,movement,status});
const sample:PageSignals={id:"a",title:"Example",url:"https://example.com",description:"Description",relevance:50,usefulness:50,titleHeadingMatch:50,internalLinkSupport:50,backlinkQuality:50,crawlability:50,mobileUsability:50,pageExperience:50,structuredDataValidity:50,freshness:50,trustEvidence:50,intentFit:50,duplicateContent:0,indexable:true};

test("biggest mover selects largest absolute movement and stable tie-breaks by id",()=>{
 assert.equal(getBiggestMover([row("b",2),row("a",-2)])?.pageId,"a");
});
test("biggest mover returns null when every page is unchanged",()=>{
 assert.equal(getBiggestMover([row("a",0),row("b",null,"newly-eligible"),row("c",null,"excluded")]),null);
});
test("biggest mover ignores newly eligible and excluded pages",()=>{
 assert.equal(getBiggestMover([row("new",null,"newly-eligible"),row("excluded",null,"excluded"),row("ranked",1)])?.pageId,"ranked");
});
test("copyPages edits do not mutate original array or signal object",()=>{
 const original=[sample],copy=copyPages(original);copy[0].usefulness=99;copy.push({...sample,id:"b"});
 assert.equal(original.length,1);assert.equal(original[0].usefulness,50);assert.notEqual(copy[0],original[0]);
});
test("quiz selection prioritizes visited milestone questions then general fallback",()=>{
 const questions=[{id:"u1",milestoneId:"unseen"},{id:"g1"},{id:"v1",milestoneId:"visited"},{id:"g2"}];
 assert.deepEqual(selectQuizQuestions(questions,new Set(["visited"]),3).map(q=>q.id),["v1","g1","g2"]);
});
test("quiz selection uses unseen milestone questions after visited and general questions",()=>{
 const questions=[{id:"u1",milestoneId:"unseen"},{id:"g1"},{id:"v1",milestoneId:"visited"}];
 assert.deepEqual(selectQuizQuestions(questions,new Set(["visited"]),5).map(q=>q.id),["v1","g1","u1"]);
});
