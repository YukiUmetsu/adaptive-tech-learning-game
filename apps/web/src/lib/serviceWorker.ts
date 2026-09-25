/**
 * Service-worker hygiene for local development.
 *
 * `vite-plugin-pwa` only registers the service worker in production builds, but
 * a registration made while previewing/serving a build on this origin persists.
 * When the source changes and a new build is produced, that stale worker keeps
 * serving the previously precached `index.html`, which references hashed assets
 * that no longer exist. The result is a blank page (and a bundle without the
 * latest edits) until the worker is removed.
 *
 * Development should never be affected by a worker, so we unregister every
 * registration and clear the Cache Storage it owns. This is a no-op in
 * production, and safe when the browser lacks the APIs.
 */
export function clearStaleServiceWorkers(): void {
  if (!import.meta.env.DEV) {
    return;
  }
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .catch(() => {
      // Unregistering is best-effort; development still works without it.
    });

  if (typeof caches === "undefined") {
    return;
  }
  void caches
    .keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch(() => {
      // Cache Storage may be unavailable (private mode); ignore.
    });
}
