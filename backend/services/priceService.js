const axios = require('axios');
const cache = require('../utils/cache');

const TWELVE_DATA_BASE   = 'https://api.twelvedata.com';
const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';
const SYMBOL = 'EUR/USD';

// ─── Interval helpers ────────────────────────────────────────────────────────
// Map provider interval strings to seconds. Used for forming-candle detection
// and cache-TTL alignment.
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

// Seconds remaining until the next candle close for a given interval.
// Used so cache TTL never outlives the candle it was computed on.
function secondsUntilCandleClose(interval) {
  const sec = intervalSeconds(interval);
  const nowMs = Date.now();
  const nextCloseMs = (Math.floor(nowMs / (sec * 1000)) + 1) * sec * 1000;
  return Math.max(5, Math.ceil((nextCloseMs - nowMs) / 1000));
}

// ─── Candle validation ───────────────────────────────────────────────────────
// Throw out malformed bars before they poison indicators.
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

// Drop the forming (still-open) bar at the end of a series.
// Twelve Data's time_series includes the current incomplete candle as the
// most recent value — using it leaks future information into indicators.
function dropFormingCandle(candles, interval) {
  if (!candles || candles.length === 0) return candles;
  const sec = intervalSeconds(interval);
  const nowSec = Math.floor(Date.now() / 1000);
  const last = candles[candles.length - 1];
  // A closed bar has timestamp + interval <= now. If the last bar's window
  // hasn't ended yet, it's still forming — drop it.
  if (last && (last.time + sec) > nowSec) {
    return candles.slice(0, -1);
  }
  return candles;
}

// Remove duplicate timestamps (some providers double-emit the latest bar).
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

// ─── Retry helper ────────────────────────────────────────────────────────────
async function withRetry(fn, attempts = 3, baseDelayMs = 400) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

// ─── Live price ──────────────────────────────────────────────────────────────
// Returns the most recent tick — used for display and for mark-to-market only.
// DO NOT use this for indicator math or signal direction comparisons.
// Use getCanonicalPrice() instead so price and indicators come from the
// same source (last closed candle).
async function fetchLivePrice() {
  const cached = cache.get('live_price');
  if (cached) return cached;

  try {
    const data = await withRetry(async () => {
      const res = await axios.get(`${TWELVE_DATA_BASE}/quote`, {
        params: { symbol: SYMBOL, apikey: process.env.TWELVE_DATA_API_KEY },
        timeout: 8000,
      });
      if (res.data && res.data.status === 'error') throw new Error(res.data.message);
      return res.data;
    });

    const close = parseFloat(data.close);
    if (!isFinite(close) || close <= 0) throw new Error('Bad live price payload');

    // NOTE: Twelve Data free tier does NOT publish bid/ask.
    // We mark spread_estimated=true so callers know not to trust it for
    // execution decisions. Real bid/ask requires a broker-grade feed.
    const price = {
      price: close,
      bid: null,
      ask: null,
      spread_pips: null,
      spread_estimated: true,
      change: parseFloat(data.change) || 0,
      change_percent: parseFloat(data.percent_change) || 0,
      open:   parseFloat(data.open)   || close,
      high:   parseFloat(data.high)   || close,
      low:    parseFloat(data.low)    || close,
      volume: parseFloat(data.volume) || 0,
      timestamp: new Date().toISOString(),
      source: 'twelve_data',
    };

    cache.set('live_price', price, 30); // short — live tick should refresh often
    return price;
  } catch (err) {
    console.error('Twelve Data live price error, falling back:', err.message);
    return fetchFromAlphaVantage();
  }
}

async function fetchFromAlphaVantage() {
  try {
    const res = await withRetry(() => axios.get(ALPHA_VANTAGE_BASE, {
      params: {
        function: 'CURRENCY_EXCHANGE_RATE',
        from_currency: 'EUR',
        to_currency:   'USD',
        apikey: process.env.ALPHA_VANTAGE_API_KEY,
      },
      timeout: 8000,
    }));

    const data = res.data && res.data['Realtime Currency Exchange Rate'];
    if (!data) throw new Error('Alpha Vantage rate limit or empty payload');

    const p = parseFloat(data['5. Exchange Rate']);
    if (!isFinite(p) || p <= 0) throw new Error('Bad Alpha Vantage payload');

    const price = {
      price: p,
      bid: null,
      ask: null,
      spread_pips: null,
      spread_estimated: true,
      change: 0,
      change_percent: 0,
      open: p, high: p, low: p, volume: 0,
      timestamp: new Date().toISOString(),
      source: 'alpha_vantage',
    };

    cache.set('live_price', price, 30);
    return price;
  } catch (err) {
    console.error('Alpha Vantage error:', err.message);
    // Last-resort: serve stale rather than null so the UI doesn't blank out.
    const stale = cache.get('live_price');
    return stale || null;
  }
}

// ─── Historical candles (closed only) ────────────────────────────────────────
// Always returns ONLY fully-closed candles. The forming bar from the API is
// stripped before return. Cache is keyed and TTL'd to expire at the next
// candle close so we don't serve stale data across boundaries.
async function fetchHistoricalData(interval = '1h', outputsize = 200) {
  const cacheKey = `history_v3_${interval}_${outputsize}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Request one extra so we still have `outputsize` closed bars after dropping
  // the forming one.
  const requestSize = outputsize + 1;

  try {
    const data = await withRetry(async () => {
      const res = await axios.get(`${TWELVE_DATA_BASE}/time_series`, {
        params: {
          symbol: SYMBOL,
          interval,
          outputsize: requestSize,
          apikey: process.env.TWELVE_DATA_API_KEY,
        },
        timeout: 12000,
      });
      if (res.data && res.data.status === 'error') throw new Error(res.data.message);
      return res.data;
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

    // Cap at requested size in case the provider over-returned.
    if (candles.length > outputsize) {
      candles = candles.slice(-outputsize);
    }

    // Cache only until next candle close so the next caller across the
    // boundary forces a refresh.
    const ttl = Math.min(secondsUntilCandleClose(interval), intervalSeconds(interval));
    cache.set(cacheKey, candles, ttl);
    return candles;
  } catch (err) {
    console.error('Historical data error:', err.message);
    // If we have a previously cached set, serve it stale rather than crashing
    // signal generation — better to act on slightly old closed candles than
    // to fail entirely.
    const stale = cache.get(cacheKey + '_lkg');
    if (stale) {
      console.warn('Serving last-known-good historical data for', interval);
      return stale;
    }
    throw err;
  }
}

// ─── Canonical price ─────────────────────────────────────────────────────────
// THE price reference for all indicator/signal math. This is the close of
// the last fully-closed candle on the working timeframe. Using this instead
// of the live tick eliminates the indicator-vs-price drift that flips
// signals mid-candle.
async function getCanonicalPrice(interval = '1h') {
  const candles = await fetchHistoricalData(interval, 50);
  if (!candles || candles.length === 0) return null;
  const last = candles[candles.length - 1];
  return {
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
};
