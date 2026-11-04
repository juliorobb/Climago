const CACHE_NAME = "climago-shell-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./assets/icon.svg",
  "./assets/mascot-sun.png",
  "./assets/mascot-cloud.png",
  "./assets/mascot-rain.png",
  "./assets/mascot-storm.png",
  "./assets/mascot-cold.png",
  "./assets/mascot-wind.png",
  "./assets/mascot-heat.png"
];
const SHELL_PATHS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("climago-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Nunca interceptar APIs meteorológicas, tiles de mapas ni servicios externos.
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate";
  if (!isNavigation && !SHELL_PATHS.has(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: "no-store" });
      if (response && response.ok) {
        await cache.put(isNavigation ? "./index.html" : request, response.clone());
      }
      return response;
    } catch {
      const cached = await cache.match(isNavigation ? "./index.html" : request);
      return cached || (isNavigation ? Response.error() : new Response("Recurso no disponible sin conexión.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      }));
    }
  })());
});
