const axios = require('axios');
const cache = require('../utils/cache');

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';
const SYMBOL = 'EUR/USD';
const CACHE_TTL = 120; // seconds — matches 2-min cron, stays within 800 req/day free tier

async function fetchLivePrice() {
  const cached = cache.get('live_price');
  if (cached) return cached;

  try {
    const [quoteRes] = await Promise.all([
      axios.get(`${TWELVE_DATA_BASE}/quote`, {
        params: { symbol: SYMBOL, apikey: process.env.TWELVE_DATA_API_KEY }
      })
    ]);

    const q = quoteRes.data;
    if (q.status === 'error') throw new Error(q.message);

    const price = {
      price: parseFloat(q.close),
      bid: parseFloat(q.close) - 0.00002,
      ask: parseFloat(q.close) + 0.00002,
      spread: 0.4,
      change: parseFloat(q.change),
      change_percent: parseFloat(q.percent_change),
      open: parseFloat(q.open),
      high: parseFloat(q.high),
      low: parseFloat(q.low),
      volume: parseFloat(q.volume || 0),
      timestamp: new Date().toISOString()
    };

    cache.set('live_price', price, CACHE_TTL);
    return price;
  } catch (err) {
    console.error('Twelve Data error, trying Alpha Vantage:', err.message);
    return fetchFromAlphaVantage();
  }
}

async function fetchFromAlphaVantage() {
  try {
    const res = await axios.get(ALPHA_VANTAGE_BASE, {
      params: {
        function: 'CURRENCY_EXCHANGE_RATE',
        from_currency: 'EUR',
        to_currency: 'USD',
        apikey: process.env.ALPHA_VANTAGE_API_KEY
      }
    });

    const data = res.data['Realtime Currency Exchange Rate'];
    if (!data) throw new Error('Alpha Vantage rate limit or error');

    const p = parseFloat(data['5. Exchange Rate']);
    const price = {
      price: p,
      bid: p - 0.00002,
      ask: p + 0.00002,
      spread: 0.4,
      change: 0,
      change_percent: 0,
      timestamp: new Date().toISOString(),
      source: 'alpha_vantage'
    };

    cache.set('live_price', price, CACHE_TTL);
    return price;
  } catch (err) {
    console.error('Alpha Vantage error:', err.message);
    // Return last cached even if stale
    const stale = cache.get('live_price');
    return stale || null;
  }
}

async function fetchHistoricalData(interval = '1h', outputsize = 200) {
  const cacheKey = `history_${interval}_${outputsize}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(`${TWELVE_DATA_BASE}/time_series`, {
      params: {
        symbol: SYMBOL,
        interval,
        outputsize,
        apikey: process.env.TWELVE_DATA_API_KEY
      }
    });

    const data = res.data;
    if (data.status === 'error') throw new Error(data.message);

    const candles = (data.values || []).map(v => ({
      time: Math.floor(new Date(v.datetime).getTime() / 1000),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume || 0)
    })).reverse();

    cache.set(cacheKey, candles, CACHE_TTL);
    return candles;
  } catch (err) {
    console.error('Historical data error:', err.message);
    throw err;
  }
}

module.exports = { fetchLivePrice, fetchHistoricalData };
