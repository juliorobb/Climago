const CACHE_NAME="climago-shell-v6";
const APP_SHELL=["./","./index.html","./styles.css","./app.js","./manifest.json","./assets/icon.svg","./assets/mascot-sun.png","./assets/mascot-cloud.png","./assets/mascot-rain.png","./assets/mascot-storm.png","./assets/mascot-cold.png","./assets/mascot-wind.png","./assets/mascot-heat.png"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(key=>key.startsWith("climago-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;

  const url=new URL(request.url);
  // External services (Open-Meteo, geocoding, map tiles) must always use the network.
  if(url.origin!==self.location.origin)return;

  event.respondWith((async()=>{
    const cached=await caches.match(request);
    try{
      const response=await fetch(request);
      if(response&&response.ok){
        const cache=await caches.open(CACHE_NAME);
        cache.put(request,response.clone()).catch(()=>{});
      }
      return response;
    }catch(error){
      return cached||caches.match("./index.html");
    }
  })());
});
