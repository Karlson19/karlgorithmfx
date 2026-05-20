/* KarlgorithmFX Service Worker
 * Handles:
 *   - PWA install lifecycle (install/activate, claim clients)
 *   - Web Push: receives push events and shows notifications EVEN WHEN THE
 *     APP IS CLOSED / phone is locked (this is the whole point — a gold
 *     reversal at 00:30 should wake you)
 *   - Notification clicks: focus an existing tab or open /monitor
 *
 * Deliberately NOT caching app shell aggressively — this is a live trading
 * tool; serving stale signals/prices would be dangerous. We only ensure the
 * SW is installed so push works. Network-first for everything.
 */

const SW_VERSION = 'karlfx-v1';

self.addEventListener('install', (event) => {
  // Activate this SW immediately without waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Fetch handler ───────────────────────────────────────────────────────────
// Network-passthrough only. We deliberately DO NOT cache app data — this is a
// live trading tool and stale prices/signals would be dangerous. The handler
// exists primarily because Chrome requires a service worker with a fetch
// handler before it will offer "Install app" / fire beforeinstallprompt.
// For navigations we add a tiny offline fallback message so a dropped
// connection doesn't show the browser's ugly error page.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POST/PUT/etc.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<body style="background:#0a0a0a;color:#a1a1aa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:2rem">' +
          '<div><h2 style="color:#fff">You’re offline</h2><p>KarlFX needs a connection for live data. Reconnect and reopen.</p></div>',
          { headers: { 'Content-Type': 'text/html' } }
        )
      )
    );
  }
  // Non-navigation GETs: let the browser handle them normally (no respondWith).
});

// ─── Push: show a notification ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'KarlFX Alert', body: event.data ? event.data.text() : 'Open trade needs attention' };
  }

  const {
    title = 'KarlFX Trade Alert',
    body = 'An open trade needs your attention.',
    severity = 'warning',
    tag,
    url = '/monitor',
    symbol,
  } = payload;

  const options = {
    body,
    // Branded icon + small badge (monochrome silhouette for the status bar)
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Critical alerts demand interaction — they won't auto-dismiss, so a
    // reversal alert stays on screen until acknowledged.
    requireInteraction: severity === 'critical',
    // Vibration pattern (Android) — more urgent for critical
    vibrate: severity === 'critical' ? [200, 100, 200, 100, 200] : [150, 75, 150],
    // tag dedupes: a newer alert with the same tag replaces the old one
    tag: tag || (symbol ? `karlfx-${symbol}` : 'karlfx-alert'),
    renotify: true,
    timestamp: Date.now(),
    data: { url, severity, symbol },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click: focus or open the app at the relevant page ──────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/monitor';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and navigate to the target.
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            try { client.navigate(targetUrl); } catch {}
          }
          return;
        }
      }
      // Otherwise open a fresh window.
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Allow the page to trigger skipWaiting (e.g., after an update).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
