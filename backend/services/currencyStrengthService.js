const priceService = require('./priceService');
const cache = require('../utils/cache');
const { listEnabledSymbols } = require('../config/pairs');

// ─── Currency Strength Meter ─────────────────────────────────────────────────
// For each currency (USD, EUR, GBP, JPY, AUD, XAU), compute a relative
// strength score from how its pairs have moved over a recent window.
//
// Method:
//   - For each enabled pair, compute (close_now - close_24h_ago) / close_24h_ago
//   - For the BASE currency (first in the pair), the % change credits its strength
//   - For the QUOTE currency, the inverse credits its strength
//   - Sum and normalise across each currency's appearances
//
// This is a standard technical-analysis currency-strength approach. It's a
// directional bias signal — when USD shows strongly positive across multiple
// pairs and EUR shows strongly negative, EUR/USD shorts have a tailwind
// that the chart alone doesn't expose.
//
// Cached for 5 min — it's a slow-moving indicator anyway.

const CACHE_KEY = 'currency_strength_v1';
const CACHE_TTL = 5 * 60;

async function computeCurrencyStrength() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const symbols = listEnabledSymbols();

  // Fetch 30 H1 candles per pair (covers ~24h). Parallel.
  const candleData = await Promise.allSettled(
    symbols.map(sym => priceService.fetchHistoricalData('1h', 30, sym))
  );

  // currencyScores[ccy] = { sum: number, count: number }
  const currencyScores = {};

  candleData.forEach((res, i) => {
    if (res.status !== 'fulfilled') return;
    const candles = res.value;
    if (!Array.isArray(candles) || candles.length < 24) return;

    const sym = symbols[i];
    const [base, quote] = sym.split('/');
    if (!base || !quote) return;

    // % change of the pair over the window
    const first = candles[Math.max(0, candles.length - 25)].close;
    const last  = candles[candles.length - 1].close;
    if (!first || !last) return;
    const pctChange = ((last - first) / first) * 100;

    // BASE gets +pctChange (if pair went up, base strengthened)
    // QUOTE gets -pctChange (if pair went up, quote weakened)
    if (!currencyScores[base])  currencyScores[base]  = { sum: 0, count: 0 };
    if (!currencyScores[quote]) currencyScores[quote] = { sum: 0, count: 0 };
    currencyScores[base].sum  += pctChange;
    currencyScores[base].count += 1;
    currencyScores[quote].sum  -= pctChange;
    currencyScores[quote].count += 1;
  });

  // Average and normalise
  const rawScores = {};
  for (const [ccy, { sum, count }] of Object.entries(currencyScores)) {
    rawScores[ccy] = count > 0 ? sum / count : 0;
  }

  // Find min/max to scale to a -100..+100 display range so the UI bars
  // look reasonable. (Raw values are usually -2 to +2 %.)
  const values = Object.values(rawScores);
  const maxAbs = Math.max(0.1, ...values.map(v => Math.abs(v)));
  const normalized = {};
  for (const [ccy, v] of Object.entries(rawScores)) {
    normalized[ccy] = Math.round((v / maxAbs) * 100);
  }

  // Build ordered list strongest → weakest
  const ranked = Object.entries(rawScores)
    .map(([currency, raw]) => ({
      currency,
      raw_pct: parseFloat(raw.toFixed(3)),
      normalized: normalized[currency],
    }))
    .sort((a, b) => b.raw_pct - a.raw_pct);

  const out = {
    window: '24h',
    timestamp: new Date().toISOString(),
    ranked,
    strongest: ranked[0] || null,
    weakest: ranked[ranked.length - 1] || null,
  };

  cache.set(CACHE_KEY, out, CACHE_TTL);
  return out;
}

module.exports = { computeCurrencyStrength };
