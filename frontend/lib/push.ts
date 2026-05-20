import api from './api';

// ─── Web Push subscription helpers ───────────────────────────────────────────
// Subscribes the browser to background push and registers the subscription
// with the backend. Works on Android/Chrome anywhere; on iOS it ONLY works
// when the app is installed to the home screen (iOS 16.4+).

// VAPID public key — exposed to the client. Fetched from the backend if the
// env var isn't baked in (so we don't hard-fail when only the backend has it).
const ENV_VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

// Is this running as an installed PWA (standalone)? iOS push requires this.
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    // iOS Safari exposes navigator.standalone
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

async function getVapidKey(): Promise<string | null> {
  if (ENV_VAPID) return ENV_VAPID;
  try {
    const res = await api.getVapidPublicKey();
    return res?.publicKey || null;
  } catch {
    return null;
  }
}

// Subscribe to push + register with backend. Returns true on success.
// Assumes Notification permission has ALREADY been granted (call from a
// user gesture that first requests permission).
export async function subscribeToPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted') return { ok: false, reason: 'permission' };

  const vapidKey = await getVapidKey();
  if (!vapidKey) return { ok: false, reason: 'no-vapid-key' };

  try {
    const reg = await navigator.serviceWorker.ready;
    // Reuse an existing subscription if present, else create one.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: the Web Push key is a Uint8Array; TS's newer ArrayBuffer
        // generic types are over-strict about BufferSource here.
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
      });
    }
    await api.savePushSubscription(sub.toJSON());
    return { ok: true };
  } catch (err) {
    console.warn('[push] subscribe failed', err);
    return { ok: false, reason: 'subscribe-failed' };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.removePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
}
