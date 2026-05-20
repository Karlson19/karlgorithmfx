const webpush = require('web-push');
const supabase = require('../db/supabase');

// ─── Web Push Service ────────────────────────────────────────────────────────
// Sends background push notifications to a user's subscribed devices. Works
// even when the PWA is closed / phone is locked, because delivery is handled
// by the browser's push service (FCM/APNs) and shown by the service worker.
//
// Configured from env:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// Generate with: node scripts/generate-vapid.js
//
// Subscriptions live in the `push_subscriptions` table (see migration
// 003_push_subscriptions.sql). A user can have multiple (phone + laptop).

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false; // not set up yet — callers no-op gracefully
  }
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@karlfx.app',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// Store / update a subscription for a user (keyed by endpoint).
async function saveSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) {
    throw new Error('Invalid subscription');
  }
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys ? subscription.keys.p256dh : null,
      auth: subscription.keys ? subscription.keys.auth : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
  return true;
}

async function removeSubscription(endpoint) {
  if (!endpoint) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// Send a notification payload to ALL of a user's subscriptions.
// Auto-prunes dead subscriptions (410 Gone / 404).
async function sendToUser(userId, payload) {
  if (!ensureConfigured()) return { sent: 0, configured: false };

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);
  if (error || !subs || subs.length === 0) return { sent: 0, configured: true };

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(subs.map(async (sub) => {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, body, { TTL: 600 });
      sent++;
    } catch (err) {
      // 410 Gone / 404 → subscription expired or was revoked. Prune it.
      if (err.statusCode === 410 || err.statusCode === 404) {
        await removeSubscription(sub.endpoint);
      } else {
        console.warn('[push] send failed:', err.statusCode, err.body || err.message);
      }
    }
  }));

  return { sent, configured: true };
}

// List the distinct user_ids that have at least one push subscription —
// used by the cron to know who to monitor for background push.
async function listSubscribedUserIds() {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('user_id');
  if (error || !data) return [];
  return Array.from(new Set(data.map(r => r.user_id)));
}

module.exports = {
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendToUser,
  listSubscribedUserIds,
  isConfigured: ensureConfigured,
};
