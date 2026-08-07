const CACHE_NAME = "card-field-app-v2";
const APP_SHELL = [
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/logo-192.png",
  "/logo-512.png",
  "/apple-touch-icon-180.png",
  "/apple-touch-icon-precomposed.png",
];

// Safari refuses to serve a cached Response for a navigation request if it
// carries redirect history. Rebuilding a plain Response strips that history
// before it is written to the cache.
async function stripRedirectHistory(response) {
  if (!response.redirected) return response;
  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function extractIndexAssetUrls(html) {
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const assetUrl = new URL(match[1], self.location.origin);
    if (assetUrl.origin === self.location.origin && assetUrl.pathname.startsWith("/assets/")) {
      urls.add(`${assetUrl.pathname}${assetUrl.search}`);
    }
  }
  return [...urls];
}

self.addEventListener("install", (event) => {
  // Deliberately no self.skipWaiting(): a new worker waits until existing
  // controlled pages close, then becomes active on a later open.
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL.filter((url) => url !== "/index.html"));
      const indexResponse = await fetch("/index.html");
      if (!indexResponse.ok) throw new Error(`Failed to cache app shell: ${indexResponse.status}`);
      const indexText = await indexResponse.clone().text();
      await cache.put("/index.html", await stripRedirectHistory(indexResponse));
      await cache.addAll(extractIndexAssetUrls(indexText));
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("card-field-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("/index.html").then((cached) => {
        const fetched = fetch(request)
          .then(async (response) => {
            if (!response.ok) return cached || response;
            const toCache = await stripRedirectHistory(response.clone());
            caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", toCache));
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      }),
    );
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/tesseract/") ||
    APP_SHELL.includes(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      }),
    );
  }
});
