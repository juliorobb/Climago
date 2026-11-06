const CACHE_NAME="climago-shell-v17";
const APP_SHELL=["./","./index.html","./styles.css","./app.js","./manifest.json","./assets/icon.svg","./assets/scenery-sierras.svg","./assets/scenery-ciudad.svg","./assets/scenery-mar.svg","./assets/mascot-sun.png","./assets/mascot-cloud.png","./assets/mascot-rain.png","./assets/mascot-storm.png","./assets/mascot-cold.png","./assets/mascot-wind.png","./assets/mascot-heat.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)));self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  const isAppShell=url.pathname.endsWith("/")||url.pathname.endsWith("/index.html");
  if(isAppShell){
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));}
      return response;
    }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));return response;
  }).catch(()=>caches.match("./index.html"))));
});
