const CACHE = 'cse-portal-v1';
const PRECACHE = [
  './',
  'index.html',
  'css/output.css',
  'js/api.js',
  'js/app.js',
  'manifest.json',
  'icon-192.svg',
  'icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
      if (res.ok && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
      }
      return res;
    })).catch(() => caches.match('./index.html'))
  );
});
