const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("service-worker.js", "utf8");
const start = source.indexOf("async function cachedAlertsResponse(");
const end = source.indexOf('self.addEventListener("fetch"', start);
assert.notEqual(start, -1, "Missing cachedAlertsResponse");
assert.notEqual(end, -1, "Missing fetch handler boundary");
const code = source.slice(start, end) + "\nglobalThis.alertCacheFns={networkFirstAlerts};";
let fetchResult;
let fetchError = null;
let cached = new Response(JSON.stringify({alerts:[{identifier:"cached-alert"}]}), {
  headers:{"Content-Type":"application/json"}
});
let putCount = 0;
const cache = {
  async match(){return cached ? cached.clone() : undefined;},
  async put(){putCount++;}
};
const sandbox = {
  caches:{async open(){return cache;}},
  Request, Headers, Response, URL,
  async fetch(){if(fetchError)throw fetchError;return fetchResult;}
};
vm.runInNewContext(code, sandbox);
const {networkFirstAlerts}=sandbox.alertCacheFns;
const url=new URL("https://climago.test/data/smn-alerts.json?refresh=123");
const request=new Request(url);

test("HTTP 503 uses cached data and marks it stale", async()=>{
  fetchError=null;
  fetchResult=new Response("unavailable",{status:503});
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("X-ClimaGo-Data-Status"),"stale-cache");
  assert.equal((await response.json()).alerts[0].identifier,"cached-alert");
});
test("HTTP 429 uses cached data and marks it stale", async()=>{
  fetchResult=new Response("rate limited",{status:429});
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.headers.get("X-ClimaGo-Data-Status"),"stale-cache");
});
test("HTTP 200 with HTML instead of JSON uses cached data", async()=>{
  fetchResult=new Response("<html>error</html>",{status:200,headers:{"Content-Type":"text/html"}});
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.headers.get("X-ClimaGo-Data-Status"),"stale-cache");
});
test("HTTP 200 with invalid JSON uses cached data", async()=>{
  fetchResult=new Response("{broken",{status:200,headers:{"Content-Type":"application/json"}});
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.headers.get("X-ClimaGo-Data-Status"),"stale-cache");
});
test("HTTP 200 without alert schema does not replace cached data", async()=>{
  fetchResult=new Response(JSON.stringify({status:"unavailable"}),{status:200,headers:{"Content-Type":"application/json"}});
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.headers.get("X-ClimaGo-Data-Status"),"stale-cache");
});
test("network failure uses cached data and marks it stale", async()=>{
  fetchError=new Error("offline");
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.headers.get("X-ClimaGo-Data-Status"),"stale-cache");
});
test("network failure without cache returns explicit unavailable data", async()=>{
  cached=null;
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.status,503);
  assert.equal((await response.json()).status,"unavailable");
});
test("successful JSON response refreshes the alert cache", async()=>{
  cached=null;
  fetchError=null;
  fetchResult=new Response(JSON.stringify({status:"partial",generatedAt:new Date().toISOString(),alerts:[]}),{
    status:200,headers:{"Content-Type":"application/json"}
  });
  const before=putCount;
  const response=await networkFirstAlerts(request,url);
  assert.equal(response.status,200);
  assert.equal(putCount,before+1);
});
