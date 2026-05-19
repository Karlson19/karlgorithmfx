const quota = require('./quotaTracker');

// ─── Twelve Data API key manager ─────────────────────────────────────────────
// Supports rotation across multiple keys to multiply your effective daily
// quota. Reads keys from two env vars (either works):
//
//   TWELVE_DATA_API_KEYS = "key1,key2,key3"   ← preferred
//   TWELVE_DATA_API_KEY  = "key1"              ← legacy single-key fallback
//
// Each key gets its own ID (the last 4 chars are used as a stable label
// for quota tracking + the health UI; the full key is never exposed).
//
// Rotation strategy:
//   - Round-robin starting from a moving cursor
//   - Skip keys marked exhausted (429 / rate-limit error today)
//   - Skip keys past 95% of their daily budget
//   - When all keys are exhausted, return null so the caller can fall
//     back to Alpha Vantage / serve stale cache
//
// The key manager never logs the secret value. The `id` shown in errors
// and the health endpoint is just the last 4 chars (e.g., "..f7a2").

function parseKeysFromEnv() {
  const multi = process.env.TWELVE_DATA_API_KEYS;
  const single = process.env.TWELVE_DATA_API_KEY;
  const raw = multi || single || '';
  return raw.split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0)
    .map(value => ({
      // Last 4 chars as a stable label — never shows the full key.
      id: '...' + value.slice(-4),
      value,
    }));
}

let keys = parseKeysFromEnv();
let cursor = 0;

// Re-read keys on demand (in case env changed via redeploy without restart).
function refreshKeys() {
  keys = parseKeysFromEnv();
  if (cursor >= keys.length) cursor = 0;
}

// Get the next available key. Returns { id, value } or null if all are out.
//
// `essential = true`  → try harder (only skip truly exhausted keys)
// `essential = false` → skip keys past the soft throttle (preserves
//                       budget for essential calls later in the day)
function getNextKey({ essential = true } = {}) {
  if (keys.length === 0) refreshKeys();
  if (keys.length === 0) return null;

  const limit = keys.length;
  for (let i = 0; i < limit; i++) {
    const idx = (cursor + i) % limit;
    const k = keys[idx];
    const usage = quota.getKeyUsage('twelve_data', k.id);
    const skip = essential
      ? (usage && usage.status === 'exhausted')
      : (usage && usage.status !== 'ok' && usage.status !== 'unlimited');
    if (!skip) {
      // Advance cursor so the next call uses a different key first
      // (spreads load across keys, not just hammers the first one).
      cursor = (idx + 1) % limit;
      return k;
    }
  }
  return null;
}

// All key IDs (for /api/health to surface per-key usage).
function listKeyIds() {
  if (keys.length === 0) refreshKeys();
  return keys.map(k => k.id);
}

function keyCount() {
  if (keys.length === 0) refreshKeys();
  return keys.length;
}

// Map an axios/Twelve-Data error to "is this a rate-limit error?"
function isRateLimitError(err) {
  if (!err) return false;
  if (err.response && err.response.status === 429) return true;
  const msg = (err.message || '').toLowerCase();
  // Twelve Data sometimes returns 200 with status:error and a body explaining
  // the limit. The caller throws our own Error with that message.
  return msg.includes('limit') || msg.includes('rate') || msg.includes('exceed') || msg.includes('credit');
}

module.exports = {
  getNextKey,
  listKeyIds,
  keyCount,
  isRateLimitError,
  refreshKeys,
};
