const CACHE_NAME="climago-shell-v29";
const DATA_CACHE="climago-data-v1";
const APP_SHELL=["./","./index.html","./styles.css","./app.js","./manifest.json","./assets/icon.svg","./assets/landscapes/sierras.jpg","./assets/landscapes/ciudad.jpg","./assets/landscapes/mar.jpg","./assets/landscapes/new-york.svg","./assets/weather-scenes.svg","./assets/recommendations/water-bottle.svg","./assets/mascot-sun.png","./assets/mascot-cloud.png","./assets/mascot-rain.png","./assets/mascot-storm.png","./assets/mascot-cold.png","./assets/mascot-wind.png","./assets/mascot-heat.png"];
const ALERTS_PATH="/data/smn-alerts.json";

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});
self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys
        .filter(key=>key.startsWith("climago-shell-")&&key!==CACHE_NAME)
        .map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});
async function networkFirstAlerts(request,url){
  const cache=await caches.open(DATA_CACHE);
  const key=new Request(url.origin+url.pathname,{method:"GET"});
  try{
    const response=await fetch(request,{cache:"no-store"});
    if(response.ok){
      const type=(response.headers.get("content-type")||"").toLowerCase();
      if(type.includes("json"))await cache.put(key,response.clone());
    }
    return response;
  }catch(error){
    const previous=await cache.match(key);
    if(previous){
      const headers=new Headers(previous.headers);
      headers.set("X-ClimaGo-Data-Status","stale-cache");
      return new Response(previous.body,{status:previous.status,statusText:previous.statusText,headers});
    }
    return new Response(JSON.stringify({
      status:"unavailable",
      alerts:[],
      error:"No hay conexión y todavía no existe una copia anterior de los avisos."
    }),{status:503,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
  }
}
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.endsWith(ALERTS_PATH)){
    event.respondWith(networkFirstAlerts(request,url));
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const cached=await cache.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response.ok)await cache.put(request,response.clone());
      return response;
    }catch(error){
      if(request.mode==="navigate"){
        const fallback=await cache.match("./index.html");
        if(fallback)return fallback;
      }
      return Response.error();
    }
  })());
});
