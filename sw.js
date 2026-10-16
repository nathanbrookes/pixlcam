// Offline support. Network-first so updates show up right away; the cache is the
// fallback when there's no connection. Bump VERSION to clear old caches.

const VERSION = 'pixlcam-v1';
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

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
