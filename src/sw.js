import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { createHandlerBoundToURL } from 'workbox-precaching';

// Workbox precaching — vite-plugin-pwa injects the manifest here
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback
const handler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(handler);
registerRoute(navigationRoute);

// Activate immediately
self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

// Queue notification actions in IndexedDB so the app can process them
// even if postMessage doesn't reach a backgrounded/killed tab
function openActionQueue() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dayglance-sw', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('actions', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAction(message) {
  try {
    const db = await openActionQueue();
    const tx = db.transaction('actions', 'readwrite');
    tx.objectStore('actions').add(message);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    db.close();
  } catch (e) {
    // Silently fail — postMessage is the primary path
  }
}

// Handle notification action clicks
self.addEventListener('notificationclick', (event) => {
  const { action, data } = event.notification;
  event.notification.close();

  const message = action
    ? { type: 'notification-action', action, data }
    : { type: 'notification-action', action: 'focus', data };

  event.waitUntil(
    // Queue in IndexedDB first (reliable fallback for mobile)
    queueAction(message).then(() =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        // Try to focus an existing tab
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            client.postMessage(message);
            return;
          }
        }
        // No existing tab — open the app
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
    )
  );
});
