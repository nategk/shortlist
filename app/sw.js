// Service worker: keeps the app shell and every listing photo available
// offline.
// - App shell: stale-while-revalidate, so the app opens instantly and picks
//   up new versions in the background.
// - Photos: the page requests ./photo/<stable id>?src=<remote url>. The first
//   fetch stores the image under its stable id, so photo hosts that rotate
//   signed URLs still hit the cache later.
// - The page can post {type: "warm-photos", photos: [{id, url}]} to download
//   every photo in the background.
const SHELL = "shortlist-shell-v11";
const PHOTOS = "shortlist-photos-v1";
const SHELL_FILES = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "js/main.js", "js/ui.js", "js/store.js", "js/model.js",
  "js/adapters/index.js", "js/adapters/api.js",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("shortlist-shell-") && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

function photoKey(id) { return new URL("photo/" + encodeURIComponent(id), self.registration.scope).href; }

async function fetchPhoto(id, src) {
  const cache = await caches.open(PHOTOS);
  const key = photoKey(id);
  const hit = await cache.match(key);
  if (hit) return hit;
  // no-cors: photo hosts rarely send CORS headers; an opaque response still
  // renders in <img> and can be cached.
  const res = await fetch(src, { mode: "no-cors", credentials: "omit" });
  if (res.ok || res.type === "opaque") await cache.put(key, res.clone());
  return res;
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  const photo = url.pathname.match(/\/photo\/([^/]+)$/);
  if (photo && url.origin === self.location.origin) {
    const src = url.searchParams.get("src");
    e.respondWith(fetchPhoto(decodeURIComponent(photo[1]), src).catch(() => new Response("", { status: 504 })));
    return;
  }

  // Data calls (this site's /api, Airtable, etc.) always go to the network;
  // the app's own store handles offline for data.
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  e.respondWith(caches.open(SHELL).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener("message", e => {
  if (!e.data || e.data.type !== "warm-photos") return;
  const photos = e.data.photos || [];
  e.waitUntil((async () => {
    let i = 0;
    const worker = async () => { while (i < photos.length) { const p = photos[i++]; try { await fetchPhoto(p.id, p.url); } catch (err) {} } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const clients = await self.clients.matchAll();
    for (const c of clients) c.postMessage({ type: "photos-warmed", count: photos.length });
  })());
});
