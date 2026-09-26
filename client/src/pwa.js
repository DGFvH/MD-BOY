// Registers the service worker (public/sw.js): offline start and "share to Hashlite" once
// the site is installed as an app. Skipped where it isn't supported, and on localhost dev.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not important enough to report: the site works without it.
    });
  });
}
