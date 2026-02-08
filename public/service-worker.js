// This service worker unregisters itself to clean up old (pre-Workbox) installations.
// Once all clients have loaded the new Workbox-based sw.js, this file can be removed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister().then(() => {
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(client => client.navigate(client.url));
    });
  });
});
