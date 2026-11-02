const CACHE_NAME="climago-shell-smn-base-1";
const APP_SHELL=["./","./index.html","./styles.css","./app.js","./manifest.json","./assets/icon.svg","./assets/mascot-sun.png","./assets/mascot-cloud.png","./assets/mascot-rain.png","./assets/mascot-storm.png","./assets/mascot-cold.png","./assets/mascot-wind.png","./assets/mascot-heat.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)));self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(request,{cache:"no-store"}).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||caches.match("./index.html"))));
});
