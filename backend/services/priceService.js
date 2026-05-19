const axios = require('axios');
const cache = require('../utils/cache');
const quota = require('../utils/quotaTracker');
const tdKeys = require('../utils/twelveDataKeys');
const { PRIMARY_SYMBOL, getPair, isSupported } = require('../config/pairs');

const TWELVE_DATA_BASE   = 'https://api.twelvedata.com';
const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

// ─── Interval helpers ────────────────────────────────────────────────────────
const INTERVAL_SECONDS = {
  '1min':  60,
  '5min':  300,
  '15min': 900,
  '30min': 1800,
  '1h':    3600,
  '2h':    7200,
  '4h':    14400,
  '1day':  86400,
};

function intervalSeconds(interval) {
  return INTERVAL_SECONDS[interval] || 3600;
}

function secondsUntilCandleClose(interval) {
  const sec = intervalSeconds(interval);
  const nowMs = Date.now();
  const nextCloseMs = (Math.floor(nowMs / (sec * 1000)) + 1) * sec * 1000;
  return Math.max(5, Math.ceil((nextCloseMs - nowMs) / 1000));
}

// ─── Candle hygiene ──────────────────────────────────────────────────────────
function isValidCandle(c) {
  if (!c) return false;
  for (const k of ['open', 'high', 'low', 'close']) {
    const v = c[k];
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return false;
  }
  if (c.high < c.low) return false;
  if (c.high < c.open || c.high < c.close) return false;
  if (c.low  > c.open || c.low  > c.close) return false;
  return true;
}

function dropFormingCandle(candles, interval) {
  if (!candles || candles.length === 0) return candles;
  const sec = intervalSeconds(interval);
  const nowSec = Math.floor(Date.now() / 1000);
  const last = candles[candles.length - 1];
  if (last && (last.time + sec) > nowSec) return candles.slice(0, -1);
  return candles;
}

function dedupeCandles(candles) {
  const seen = new Set();
  const out = [];
  for (const c of candles) {
    if (seen.has(c.time)) continue;
    seen.add(c.time);
    out.push(c);
  }
  return out;
}

// ─── Twelve Data caller with key rotation + retry ────────────────────────────
// Tries each healthy key in round-robin order. When a key returns a rate-
// limit error we mark it exhausted (so subsequent calls today skip it) and
// try the next key. When all keys are exhausted we throw — the callers
// have their own fallbacks (Alpha Vantage / stale cache).
//
// `path` is appended to TWELVE_DATA_BASE, e.g. '/quote' or '/time_series'.
// `params` is everything BUT the apikey (we add that per attempt).
// `opts.essential` controls whether we'll burn keys past soft-throttle.
async function callTwelveData(path, params, opts = {}) {
  const essential = opts.essential !== false;
  const maxAttempts = Math.max(1, tdKeys.keyCount());
  let lastErr = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = tdKeys.getNextKey({ essential });
    if (!key) {
      const err = new Error('All Twelve Data keys exhausted for today');
      err.code = 'TD_ALL_EXHAUSTED';
      throw err;
    }

    try {
      quota.recordCall('twelve_data', key.id);
      const res = await axios.get(`${TWELVE_DATA_BASE}${path}`, {
        params: { ...params, apikey: key.value },
        timeout: 12000,
      });
      // Twelve Data returns 200 with a payload `{ status: 'error', code, message }`
      // for rate-limit problems — convert that into a thrown error so the
      // retry logic sees it.
      if (res.data && res.data.status === 'error') {
        const e = new Error(res.data.message || 'Twelve Data error');
        e.tdCode = res.data.code;
        throw e;
      }
      return res.data;
    } catch (err) {
      lastErr = err;
      if (tdKeys.isRateLimitError(err)) {
        // Mark this key dead for the rest of the UTC day and roll to next.
        quota.markExhausted('twelve_data', key.id, 'rate-limited by provider');
        continue;
      }
      // Non-rate-limit error (network, timeout, bad payload): one quick retry
      // with the SAME key before falling through to the next.
      try {
        await new Promise(r => setTimeout(r, 400));
        quota.recordCall('twelve_data', key.id);
        const res = await axios.get(`${TWELVE_DATA_BASE}${path}`, {
          params: { ...params, apikey: key.value },
          timeout: 12000,
        });
        if (res.data && res.data.status === 'error') {
          if (tdKeys.isRateLimitError({ message: res.data.message })) {
            quota.markExhausted('twelve_data', key.id, 'rate-limited by provider');
            continue;
          }
          throw new Error(res.data.message || 'Twelve Data error');
        }
        return res.data;
      } catch (err2) {
        lastErr = err2;
        // If even the retry looks rate-limited, blacklist + rotate.
        if (tdKeys.isRateLimitError(err2)) {
          quota.markExhausted('twelve_data', key.id, 'rate-limited by provider');
          continue;
        }
        // Otherwise rotate keys anyway — the provider might be flaky for this key.
        continue;
      }
    }
  }
  throw lastErr || new Error('Twelve Data call failed (no keys available)');
}

// ─── Symbol normalisation ────────────────────────────────────────────────────
function normalizeSymbol(symbol) {
  if (!symbol) return PRIMARY_SYMBOL;
  const cleaned = String(symbol).toUpperCase().replace(/[^A-Z/]/g, '');
  if (cleaned.length === 6 && !cleaned.includes('/')) {
    return `${cleaned.slice(0, 3)}/${cleaned.slice(3)}`;
  }
  return cleaned;
}

function resolveSymbol(symbol) {
  const norm = normalizeSymbol(symbol);
  if (!isSupported(norm)) throw new Error(`Unsupported symbol: ${symbol}`);
  return norm;
}

// ─── Live price (per-pair) ───────────────────────────────────────────────────
async function fetchLivePrice(symbol = PRIMARY_SYMBOL) {
  const sym = resolveSymbol(symbol);
  const cacheKey = `live_price_${sym}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const data = await callTwelveData('/quote', { symbol: sym });
    const close = parseFloat(data.close);
    if (!isFinite(close) || close <= 0) throw new Error('Bad live price payload');

    const pair = getPair(sym);
    const price = {
      symbol: sym,
      display_name: pair.display_name,
      price: close,
      bid: null,
      ask: null,
      spread_pips: null,
      spread_estimated: true,
      typical_spread: pair.typical_spread,
      change: parseFloat(data.change) || 0,
      change_percent: parseFloat(data.percent_change) || 0,
      open:   parseFloat(data.open)   || close,
      high:   parseFloat(data.high)   || close,
      low:    parseFloat(data.low)    || close,
      volume: parseFloat(data.volume) || 0,
      timestamp: new Date().toISOString(),
      source: 'twelve_data',
    };

    cache.set(cacheKey, price, 30);
    cache.set(cacheKey + '_lkg', price, 24 * 3600);
    return price;
  } catch (err) {
    console.error(`[${sym}] Twelve Data live price error, falling back:`, err.message);
    const fb = await fetchFromAlphaVantage(sym);
    if (fb) return fb;
    // Last-resort stale serve so the UI doesn't blank out.
    const stale = cache.get(cacheKey + '_lkg');
    if (stale) {
      console.warn(`[${sym}] Serving last-known-good live price`);
      return { ...stale, source: 'stale_cache' };
    }
    return null;
  }
}

async function fetchFromAlphaVantage(symbol) {
  const sym = resolveSymbol(symbol);
  const [from, to] = sym.split('/');
  if (sym === 'XAU/USD') {
    // Alpha Vantage doesn't expose XAU/USD on the simple FX endpoint — give up.
    return null;
  }
  try {
    quota.recordCall('alpha_vantage');
    const res = await axios.get(ALPHA_VANTAGE_BASE, {
      params: {
        function: 'CURRENCY_EXCHANGE_RATE',
        from_currency: from,
        to_currency:   to,
        apikey: process.env.ALPHA_VANTAGE_API_KEY,
      },
      timeout: 8000,
    });

    const data = res.data && res.data['Realtime Currency Exchange Rate'];
    if (!data) throw new Error('Alpha Vantage rate limit or empty payload');

    const p = parseFloat(data['5. Exchange Rate']);
    if (!isFinite(p) || p <= 0) throw new Error('Bad Alpha Vantage payload');

    const pair = getPair(sym);
    const price = {
      symbol: sym,
      display_name: pair.display_name,
      price: p,
      bid: null, ask: null, spread_pips: null, spread_estimated: true,
      typical_spread: pair.typical_spread,
      change: 0, change_percent: 0,
      open: p, high: p, low: p, volume: 0,
      timestamp: new Date().toISOString(),
      source: 'alpha_vantage',
    };

    cache.set(`live_price_${sym}`, price, 30);
    return price;
  } catch (err) {
    console.error(`[${sym}] Alpha Vantage error:`, err.message);
    return null;
  }
}

// ─── Historical candles (closed only, per-pair) ──────────────────────────────
async function fetchHistoricalData(interval = '1h', outputsize = 200, symbol = PRIMARY_SYMBOL) {
  const sym = resolveSymbol(symbol);
  const cacheKey = `history_v4_${sym}_${interval}_${outputsize}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const requestSize = outputsize + 1;

  try {
    const data = await callTwelveData('/time_series', {
      symbol: sym, interval, outputsize: requestSize,
    });

    let candles = (data.values || [])
      .map(v => ({
        time:   Math.floor(new Date(v.datetime).getTime() / 1000),
        open:   parseFloat(v.open),
        high:   parseFloat(v.high),
        low:    parseFloat(v.low),
        close:  parseFloat(v.close),
        volume: parseFloat(v.volume || 0),
      }))
      .reverse();

    candles = candles.filter(isValidCandle);
    candles = dedupeCandles(candles);
    candles = dropFormingCandle(candles, interval);

    if (candles.length === 0) throw new Error('No valid candles after cleaning');
    if (candles.length > outputsize) candles = candles.slice(-outputsize);

    const ttl = Math.min(secondsUntilCandleClose(interval), intervalSeconds(interval));
    cache.set(cacheKey, candles, ttl);
    cache.set(cacheKey + '_lkg', candles, 24 * 3600);
    return candles;
  } catch (err) {
    console.error(`[${sym}] Historical data error:`, err.message);
    const stale = cache.get(cacheKey + '_lkg');
    if (stale) {
      console.warn(`[${sym}] Serving last-known-good historical data for ${interval}`);
      return stale;
    }
    throw err;
  }
}

// ─── Canonical price (per-pair) ──────────────────────────────────────────────
async function getCanonicalPrice(interval = '1h', symbol = PRIMARY_SYMBOL) {
  const candles = await fetchHistoricalData(interval, 50, symbol);
  if (!candles || candles.length === 0) return null;
  const last = candles[candles.length - 1];
  return {
    symbol: resolveSymbol(symbol),
    price: last.close,
    candle_time: last.time,
    interval,
    source: 'last_closed_candle',
  };
}

module.exports = {
  fetchLivePrice,
  fetchHistoricalData,
  getCanonicalPrice,
  intervalSeconds,
  secondsUntilCandleClose,
  normalizeSymbol,
  resolveSymbol,
};
