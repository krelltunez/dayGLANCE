if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' });
    // When a new SW takes control (skipWaiting + clients.claim), reload so the
    // page loads fresh assets from the new precache instead of running stale JS.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  });
}
