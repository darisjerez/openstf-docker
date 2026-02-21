// Minimal service worker — required for PWA installability
// No caching logic since offline mode isn't needed for a device farm

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
