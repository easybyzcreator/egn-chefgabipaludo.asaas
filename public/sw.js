// Service Worker for PWA compliance (v2 - bypasses /api/* and non-GET requests)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  try {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/')) {
      return;
    }
  } catch {
    return;
  }
  event.respondWith(fetch(event.request));
});
