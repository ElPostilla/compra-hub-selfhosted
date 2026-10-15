const CACHE = "lista-compra-v4";
const ASSETS = [
  "/lista/",
  "/lista/index.html",
  "/lista/manifest.json",
  "/lista/icon-192.png",
  "/lista/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Red primero, caché como respaldo solo si falla la red (offline). Con
// "caché primero" (versión anterior) una actualización de la app podia
// quedarse invisible durante una recarga entera aunque el SW ya se hubiera
// actualizado, porque se seguia sirviendo el HTML cacheado antes de que la
// respuesta de red llegara a rellenar la caché.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
