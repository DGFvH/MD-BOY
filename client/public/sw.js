// Hashlite's service worker: lets the installed app open offline, and receives text shared
// to it from other apps (the manifest's share_target). Only this site's own GET requests are
// cached; Supabase and everything else go straight to the network.
const CACHE = 'hashlite-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Shared text opens in the editor through #text=, which never reaches a server.
async function shareTarget(request) {
  const form = await request.formData();
  const parts = [form.get('title'), form.get('text'), form.get('url')].map((v) => String(v ?? '').trim()).filter(Boolean);
  const text = [...new Set(parts)].join('\n\n');
  return Response.redirect(`/#text=${encodeURIComponent(text)}`, 303);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return (await cache.match('/')) ?? Response.error();
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(shareTarget(request));
    return;
  }
  if (request.method !== 'GET' || url.pathname.startsWith('/s/')) return;
  // Hashed build files never change: serve them from the cache once stored.
  if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
