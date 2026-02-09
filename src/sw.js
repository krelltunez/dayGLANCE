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

// Handle notification action clicks
self.addEventListener('notificationclick', (event) => {
  const { action, data } = event.notification;
  event.notification.close();

  const message = action
    ? { type: 'notification-action', action, data }
    : { type: 'notification-action', action: 'focus', data };

  event.waitUntil(
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
  );
});
