// Minimal service worker — required for PWA installability
// No caching logic since offline mode isn't needed for a device farm

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass all requests through to the network — don't intercept anything.
// Without this handler, standalone PWA mode can silently drop requests
// from iframes (e.g. STF control page WebSocket upgrades).
self.addEventListener('fetch', (event) => {
  return;
});
