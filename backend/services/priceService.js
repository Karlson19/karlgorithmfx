const axios = require('axios');
const cache = require('../utils/cache');
const quota = require('../utils/quotaTracker');
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

// ─── Retry helper ────────────────────────────────────────────────────────────
async function withRetry(fn, attempts = 3, baseDelayMs = 400) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// ─── Symbol normalisation ────────────────────────────────────────────────────
// Accept "EURUSD", "eur/usd", "EUR/USD" etc — always normalise to canonical
// upper-case slashed form. Reject anything not in the pair config.
function normalizeSymbol(symbol) {
  if (!symbol) return PRIMARY_SYMBOL;
  const cleaned = String(symbol).toUpperCase().replace(/[^A-Z/]/g, '');
  // Inject slash if user passed e.g. "EURUSD"
  if (cleaned.length === 6 && !cleaned.includes('/')) {
    return `${cleaned.slice(0, 3)}/${cleaned.slice(3)}`;
  }
  return cleaned;
}

function resolveSymbol(symbol) {
  const norm = normalizeSymbol(symbol);
  if (!isSupported(norm)) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }
  return norm;
}

// ─── Live price (per-pair) ───────────────────────────────────────────────────
async function fetchLivePrice(symbol = PRIMARY_SYMBOL) {
  const sym = resolveSymbol(symbol);
  const cacheKey = `live_price_${sym}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const data = await withRetry(async () => {
      quota.recordCall('twelve_data');
      const res = await axios.get(`${TWELVE_DATA_BASE}/quote`, {
        params: { symbol: sym, apikey: process.env.TWELVE_DATA_API_KEY },
        timeout: 8000,
      });
      if (res.data && res.data.status === 'error') throw new Error(res.data.message);
      return res.data;
    });

    const close = parseFloat(data.close);
    if (!isFinite(close) || close <= 0) throw new Error('Bad live price payload');

    const pair = getPair(sym);
    const price = {
      symbol: sym,
      display_name: pair.display_name,
      price: close,
      // Free tier doesn't publish bid/ask — null with `spread_estimated` flag.
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
    return price;
  } catch (err) {
    console.error(`[${sym}] Twelve Data live price error, falling back:`, err.message);
    return fetchFromAlphaVantage(sym);
  }
}

async function fetchFromAlphaVantage(symbol) {
  const sym = resolveSymbol(symbol);
  // Alpha Vantage uses separate from/to. Split "EUR/USD" → "EUR", "USD".
  // Gold (XAU/USD) requires a different endpoint we don't support here — we
  // simply return the last-known-good cached price for that pair.
  const [from, to] = sym.split('/');
  if (sym === 'XAU/USD') {
    const stale = cache.get(`live_price_${sym}`);
    if (stale) return stale;
    return null;
  }
  try {
    const res = await withRetry(() => {
      quota.recordCall('alpha_vantage');
      return axios.get(ALPHA_VANTAGE_BASE, {
        params: {
          function: 'CURRENCY_EXCHANGE_RATE',
          from_currency: from,
          to_currency:   to,
          apikey: process.env.ALPHA_VANTAGE_API_KEY,
        },
        timeout: 8000,
      });
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
      bid: null,
      ask: null,
      spread_pips: null,
      spread_estimated: true,
      typical_spread: pair.typical_spread,
      change: 0,
      change_percent: 0,
      open: p, high: p, low: p, volume: 0,
      timestamp: new Date().toISOString(),
      source: 'alpha_vantage',
    };

    cache.set(`live_price_${sym}`, price, 30);
    return price;
  } catch (err) {
    console.error(`[${sym}] Alpha Vantage error:`, err.message);
    const stale = cache.get(`live_price_${sym}`);
    return stale || null;
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
    const data = await withRetry(async () => {
      quota.recordCall('twelve_data');
      const res = await axios.get(`${TWELVE_DATA_BASE}/time_series`, {
        params: {
          symbol: sym,
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
    if (candles.length > outputsize) candles = candles.slice(-outputsize);

    const ttl = Math.min(secondsUntilCandleClose(interval), intervalSeconds(interval));
    cache.set(cacheKey, candles, ttl);
    // Stash a "last known good" copy with a long TTL so we can survive
    // outages without crashing signal generation.
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
