// ShallowSID's service worker: what makes the site installable as an app and
// usable with a flaky connection.
//
//   * this site        network first, the cached copy as the offline fallback.
//                      Pages and the app's many modules always come fresh
//                      together, so a deploy never pairs new HTML with old
//                      scripts (and never serves old HTML for weeks).
//   * CDN files        stale-while-revalidate: their URLs carry versions, so a
//                      cached copy is as good as a fresh one.
//   * everything else  passed through untouched: tunes from HVSC, and above all
//                      sync and shared playlists on Firestore, which must never
//                      be answered from a cache.
//
// Files are cached as the app requests them, so offline works from the second
// visit on. Bumping CACHE drops the old entries.

const CACHE = "shallowsid-v1";
const SHELL = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
const CDN_HOSTS = new Set(["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(event, url));
  else if (CDN_HOSTS.has(url.host)) event.respondWith(staleWhileRevalidate(event));
});

// Stored without the ?query: routes live in the #fragment, so the app page is
// one entry however it was opened.
async function networkFirst(event, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  try {
    const response = await fetch(event.request);
    if (response.ok && response.type === "basic") event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
    return response;
  } catch {
    const cached = await cache.match(key) ?? (event.request.mode === "navigate" ? await cache.match("./") : null);
    if (cached) return cached;
    return event.request.mode === "navigate"
      ? new Response("ShallowSID is offline and hasn't been saved for offline use yet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
      : new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const fresh = fetch(event.request).then(async (response) => {
    // Opaque (no-cors) responses report status 0 even when they are fine.
    if (response.ok || response.type === "opaque") {
      try { await cache.put(event.request, response.clone()); } catch { /* unstorable */ }
    }
    return response;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return (await fresh) ?? new Response("", { status: 504, statusText: "Offline" });
}
