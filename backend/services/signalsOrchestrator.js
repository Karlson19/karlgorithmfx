const signalService = require('./signalService');
const cache = require('../utils/cache');
const { listEnabledSymbols } = require('../config/pairs');

// ─── Multi-pair orchestration ────────────────────────────────────────────────
// Generates signals for every enabled pair in parallel and returns:
//   - signals: keyed map { 'EUR/USD': signal, ... } for direct lookups
//   - ranked:  array sorted by opportunity score (descending)
//
// Opportunity score combines:
//   - confidence (how convinced we are)
//   - calibration win rate (how trustworthy our conviction is)
//   - MTF alignment bonus
//   - regime fit bonus (TRENDING/RANGING with clear setup)
//
// NEUTRAL signals score zero — they're surfaced for visibility but never
// rank as opportunities.
//
// Cached briefly (60s) because individual signals each have their own
// candle-close-aligned cache; this layer just multiplexes.

const CACHE_KEY = 'signals_all_v1';
const CACHE_TTL = 60;

function scoreSignal(signal) {
  if (!signal || signal.direction === 'NEUTRAL') return 0;

  let score = signal.confidence || 0;

  // Calibration bonus / penalty: a calibrated win rate that beats
  // confidence-as-percentage gets a bonus; lagging history is a tax.
  const cal = signal.calibration;
  if (cal && cal.calibrated) {
    score += (cal.win_rate - 50) * 0.4;
  } else {
    // Uncalibrated → slight haircut to reward pairs we have data on.
    score -= 3;
  }

  // MTF alignment
  if (signal.mtf && signal.mtf.aligned) score += 8;

  // Margin of indicator agreement (10% min already; reward above 25%)
  if (signal.margin_ratio && signal.margin_ratio > 0.25) score += 5;

  return Math.round(score * 10) / 10;
}

// Fan out signal generation across all enabled pairs. We use allSettled so
// one provider hiccup on, say, gold doesn't blank EUR/USD too.
async function generateAllSignals() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const symbols = listEnabledSymbols();
  const results = await Promise.allSettled(
    symbols.map(sym => signalService.generateSignal(sym))
  );

  const signals = {};
  const errors  = {};
  results.forEach((r, i) => {
    const sym = symbols[i];
    if (r.status === 'fulfilled') signals[sym] = r.value;
    else                          errors[sym]  = r.reason ? r.reason.message : 'unknown';
  });

  const ranked = Object.values(signals)
    .map(sig => ({ ...sig, opportunity_score: scoreSignal(sig) }))
    .sort((a, b) => b.opportunity_score - a.opportunity_score);

  const out = {
    signals,
    ranked,
    errors,
    generated_at: new Date().toISOString(),
    best_opportunity: ranked.find(s => s.direction !== 'NEUTRAL') || null,
  };

  cache.set(CACHE_KEY, out, CACHE_TTL);
  return out;
}

module.exports = { generateAllSignals, scoreSignal };
