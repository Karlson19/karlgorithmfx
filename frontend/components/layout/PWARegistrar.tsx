'use client';
import { useEffect } from 'react';

// Registers the service worker on load so PWA install + Web Push work.
// Kept dead simple and side-effect-only — no UI. The install prompt and
// notification opt-in live in the alerts panel / settings where there's a
// user gesture to attach to.
export default function PWARegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        // If an updated SW is waiting, activate it immediately so push logic
        // stays current.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage?.('SKIP_WAITING');
            }
          });
        });
      } catch (err) {
        console.warn('[PWA] service worker registration failed', err);
      }
    };

    // Register after load to avoid competing with first paint.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
