const axios = require('axios');

// ─── Historical candles ──────────────────────────────────────────────────────
// H1 history comes from Twelve Data (up to 5000 candles per request, roughly
// 9 months of forex). H4 and daily candles are BUILT from the H1 candles, so
// the replay needs one API call per pair and they always agree with each other.
// (The 15-minute bias the live engine uses cannot be rebuilt from H1; the
// replay leaves it neutral. See the report footer.)

const H1 = 3600;

const validCandle = (c) =>
  [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0) &&
  c.high >= c.low && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close);

// Group H1 candles into buckets of `bucketSec` (4h, 1 day). A bucket is only
// handed to the engine once it has fully closed (see closedBuckets).
function aggregate(h1, bucketSec) {
  const out = [];
  let cur = null;
  for (const c of h1) {
    const start = Math.floor(c.time / bucketSec) * bucketSec;
    if (!cur || cur.time !== start) {
      cur = { time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume || 0;
    }
  }
  return out;
}

// The last `count` buckets that had fully closed by `nowSec`.
function closedBuckets(buckets, bucketSec, nowSec, count) {
  let lo = 0, hi = buckets.length - 1, last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (buckets[mid].time + bucketSec <= nowSec) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return last < 0 ? [] : buckets.slice(Math.max(0, last + 1 - count), last + 1);
}

function parseKeys() {
  return (process.env.TWELVE_DATA_API_KEYS || process.env.TWELVE_DATA_API_KEY || '')
    .split(',').map((k) => k.trim()).filter(Boolean);
}

async function fetchH1(symbol, bars, key) {
  const res = await axios.get('https://api.twelvedata.com/time_series', {
    params: { symbol, interval: '1h', outputsize: bars, timezone: 'UTC', apikey: key },
    timeout: 60000,
  });
  const d = res.data;
  if (!d || d.status === 'error' || !Array.isArray(d.values)) {
    throw new Error((d && d.message) || 'Twelve Data returned no candles');
  }
  const seen = new Set();
  let candles = d.values.map((v) => ({
    time: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000),
    open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close),
    volume: parseFloat(v.volume || 0),
  }))
    .filter((c) => Number.isFinite(c.time) && validCandle(c))
    .sort((a, b) => a.time - b.time)
    .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)));
  // Drop a candle that is still forming.
  const nowSec = Math.floor(Date.now() / 1000);
  if (candles.length && candles[candles.length - 1].time + H1 > nowSec) candles = candles.slice(0, -1);
  return candles;
}

module.exports = { aggregate, closedBuckets, fetchH1, parseKeys, validCandle, H1 };
