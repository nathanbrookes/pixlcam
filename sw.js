// Offline support. The app always opens straight from the saved copy (instant, even
// with no or bad signal). Each launch also re-downloads the app in the background, so
// a new version shows up the *next* time it's opened. Files are only replaced once all
// of them arrived, so a dropped connection can't leave a half-updated app.
//
// Add any new file the app loads to SHELL, or it won't be available offline.

const CACHE = 'pixlcam';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/main.js',
  'js/gl.js',
  'js/effects.js',
  'js/pixelsort.js',
  'js/renderer.js',
  'js/camera.js',
  'js/presets.js',
  'js/demo.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

let refreshing = null;
function refresh() {
  refreshing ||= (async () => {
    // no-cache: revalidate with the server instead of trusting the browser's HTTP cache.
    // Each body is read as soon as it arrives: leaving responses unread while waiting for
    // the rest ties up the browser's ~6 connections per server and deadlocks.
    const fresh = await Promise.all(SHELL.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return [url, new Response(await res.blob(), { headers: res.headers })];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(fresh.map(([url, res]) => cache.put(url, res)));
  })().finally(() => { refreshing = null; });
  return refreshing;
}

self.addEventListener('install', (e) => {
  e.waitUntil(refresh().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Opening the app: serve the saved copy now, fetch the latest version in the background.
  if (req.mode === 'navigate') e.waitUntil(refresh().catch(() => { /* offline or flaky — keep the saved copy */ }));

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
