// ─── API Quota Tracker (multi-key aware) ─────────────────────────────────────
// Tracks outbound API calls per provider AND per key per UTC day in-memory.
// Two reasons:
//   1. Observability — the /api/health endpoint exposes per-key usage so we
//      know how close to the cliff each key is.
//   2. Auto-throttle / rotation — twelveDataKeys can call shouldThrottle()
//      or markExhausted() to drop a key that's out of budget.
//
// In-memory state is fine for a single-instance backend. If we ever scale
// to multiple replicas we'd persist to Redis or a Supabase counter row.

const cache = require('./cache');

const PROVIDERS = {
  twelve_data:   { name: 'Twelve Data',   daily_limit: 800, soft_throttle: 0.85, hard_throttle: 0.95 },
  alpha_vantage: { name: 'Alpha Vantage', daily_limit: 500, soft_throttle: 0.85, hard_throttle: 0.95 },
  openrouter:    { name: 'OpenRouter',    daily_limit: null, soft_throttle: 1, hard_throttle: 1 },
};

function utcDayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function callKey(provider, keyId) {
  return `quota:${provider}:${keyId || 'default'}:${utcDayKey()}`;
}

function exhaustedKey(provider, keyId) {
  return `quota:exhausted:${provider}:${keyId || 'default'}:${utcDayKey()}`;
}

// Record one call to a provider (optionally tagged with which API key was used).
function recordCall(provider, keyId = 'default') {
  if (!PROVIDERS[provider]) return;
  const key = callKey(provider, keyId);
  const current = cache.get(key) || 0;
  cache.set(key, current + 1, 26 * 3600); // long TTL — naturally rotates by UTC day
}

// Mark a specific API key as exhausted for the rest of the UTC day. The
// key manager calls this when an API responds with a 429 or "rate limit"
// error so we stop trying that key until midnight UTC.
function markExhausted(provider, keyId, reason = 'rate-limited') {
  if (!PROVIDERS[provider]) return;
  // TTL = seconds until next UTC midnight, capped at 26h as a safety net.
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  )).getTime();
  const ttl = Math.min(Math.ceil((midnight - now.getTime()) / 1000) + 60, 26 * 3600);
  cache.set(exhaustedKey(provider, keyId), { reason, exhausted_at: now.toISOString() }, ttl);
  console.warn(`[quota] ${provider} key '${keyId}' marked exhausted (${reason}) until next UTC day`);
}

function isExhausted(provider, keyId) {
  return !!cache.get(exhaustedKey(provider, keyId));
}

// Per-key usage snapshot.
function getKeyUsage(provider, keyId) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return null;
  const used = cache.get(callKey(provider, keyId)) || 0;
  const limit = cfg.daily_limit;
  const ratio = limit ? used / limit : 0;
  const exhausted = isExhausted(provider, keyId);
  return {
    provider, keyId, used,
    limit, remaining: limit ? Math.max(0, limit - used) : null,
    ratio: parseFloat(ratio.toFixed(3)),
    status: exhausted ? 'exhausted'
      : !limit ? 'unlimited'
      : ratio < cfg.soft_throttle ? 'ok'
      : ratio < cfg.hard_throttle ? 'soft_throttle'
      : ratio < 1                 ? 'hard_throttle'
      : 'exhausted',
  };
}

// Aggregate usage across multiple keys for one provider — used by /health.
function getProviderUsage(provider, keyIds = ['default']) {
  const perKey = keyIds.map(k => getKeyUsage(provider, k)).filter(Boolean);
  const totalUsed = perKey.reduce((s, k) => s + k.used, 0);
  const totalLimit = perKey.reduce((s, k) => s + (k.limit || 0), 0);
  const healthyKeys = perKey.filter(k => k.status === 'ok').length;
  return {
    provider,
    name: PROVIDERS[provider] ? PROVIDERS[provider].name : provider,
    total_used: totalUsed,
    total_limit: totalLimit,
    total_ratio: totalLimit ? parseFloat((totalUsed / totalLimit).toFixed(3)) : 0,
    keys: perKey,
    healthy_keys: healthyKeys,
    total_keys: perKey.length,
  };
}

// Should the caller skip a NON-ESSENTIAL request? (legacy single-key API)
function shouldThrottle(provider, { essential = true, keyId = 'default' } = {}) {
  const u = getKeyUsage(provider, keyId);
  if (!u || u.status === 'unlimited' || u.status === 'ok') return false;
  if (essential) return u.status === 'exhausted';
  return u.status !== 'ok';
}

module.exports = {
  recordCall,
  markExhausted,
  isExhausted,
  getKeyUsage,
  getProviderUsage,
  shouldThrottle,
};
