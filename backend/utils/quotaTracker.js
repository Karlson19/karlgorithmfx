// ─── API Quota Tracker ───────────────────────────────────────────────────────
// Tracks outbound API calls per provider per UTC day in-memory. Two reasons:
//   1. Observability — the /api/health endpoint exposes "we've used 470/800
//      Twelve Data calls today" so you know how close to the cliff you are.
//   2. Auto-throttle — priceService can call shouldThrottle() before a
//      non-essential request and skip it when we're past the threshold.
//
// In-memory is intentional. Per-instance counter on Render is fine because:
//   - Free tier runs a single instance (no replicas)
//   - Counter resets if the process restarts, which is conservative
//     (under-counting once a day, never over-counting → we never falsely
//     "we're at limit" when we're not).
//
// If we ever scale to multiple instances we'd persist this to Redis or a
// Supabase counter row — but that's overkill until then.

const cache = require('./cache');

const PROVIDERS = {
  twelve_data:   { name: 'Twelve Data',   daily_limit: 800, soft_throttle: 0.85, hard_throttle: 0.95 },
  alpha_vantage: { name: 'Alpha Vantage', daily_limit: 500, soft_throttle: 0.85, hard_throttle: 0.95 },
  openrouter:    { name: 'OpenRouter',    daily_limit: null, soft_throttle: 1, hard_throttle: 1 }, // paid — no hard cap
};

function utcDayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function cacheKey(provider) {
  return `quota:${provider}:${utcDayKey()}`;
}

// Record one call to a provider.
function recordCall(provider) {
  if (!PROVIDERS[provider]) return;
  const key = cacheKey(provider);
  const current = cache.get(key) || 0;
  // Long TTL — slightly over 24h to survive any minor clock skew, and the
  // key includes the UTC day so it naturally rotates at midnight.
  cache.set(key, current + 1, 26 * 3600);
}

// How many calls have we made today on this provider?
function getUsage(provider) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return null;
  const used = cache.get(cacheKey(provider)) || 0;
  const limit = cfg.daily_limit;
  const ratio = limit ? used / limit : 0;
  return {
    provider,
    name: cfg.name,
    used,
    limit,
    remaining: limit ? Math.max(0, limit - used) : null,
    ratio: parseFloat(ratio.toFixed(3)),
    status: !limit ? 'unlimited'
      : ratio < cfg.soft_throttle ? 'ok'
      : ratio < cfg.hard_throttle ? 'soft_throttle'
      : ratio < 1                 ? 'hard_throttle'
      : 'exhausted',
  };
}

// Should the caller skip a NON-ESSENTIAL request?
//   - essential = true: signal generation, user-initiated fetches → never skip
//   - essential = false: speculative refresh, MTF re-fetch → skip when soft-throttled
function shouldThrottle(provider, { essential = true } = {}) {
  const u = getUsage(provider);
  if (!u || u.status === 'unlimited' || u.status === 'ok') return false;
  if (essential) {
    // Only block essential calls when we're literally exhausted.
    return u.status === 'exhausted';
  }
  // Non-essential: back off as soon as we hit soft throttle.
  return u.status !== 'ok';
}

// Snapshot for the /health endpoint.
function getAllUsage() {
  return Object.keys(PROVIDERS).map(getUsage);
}

module.exports = { recordCall, getUsage, getAllUsage, shouldThrottle };
