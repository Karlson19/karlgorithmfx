const signalService = require('./signalService');
const marketFocus = require('./marketFocusService');
const cache = require('../utils/cache');
const { listEnabledSymbols, getPair } = require('../config/pairs');

// ─── Multi-pair orchestration ────────────────────────────────────────────────
// Generates signals for every enabled pair in parallel, attaches a
// real-time MARKET FOCUS context (session, news, recommended pairs),
// and ranks opportunities so the top setup right NOW is always visible.
//
// Opportunity score combines:
//   - confidence (how convinced we are)
//   - calibrated historical win rate (how trustworthy our conviction is)
//   - market focus fit (is this pair LIVE in the current session?)
//   - MTF alignment + strategy confluence bonuses
//   - News proximity penalty (HIGH news soon → discount)
//
// Cached for 60s to multiplex over the per-pair signal caches.

const CACHE_KEY = 'signals_all_v2';
const CACHE_TTL = 60;

function scoreSignal(signal, focus) {
  if (!signal || signal.direction === 'NEUTRAL') return 0;

  let score = signal.confidence || 0;

  // Calibration: rewards pairs/bands with proven win rates.
  const cal = signal.calibration;
  if (cal && cal.calibrated) {
    score += (cal.win_rate - 50) * 0.4;
  } else {
    score -= 3;
  }

  // MTF alignment
  if (signal.mtf && signal.mtf.aligned) score += 8;

  // Indicator margin
  if (signal.margin_ratio && signal.margin_ratio > 0.25) score += 5;

  // Multiple strategies firing → strong confluence
  if (signal.strategies_fired && signal.strategies_fired >= 2) {
    score += (signal.strategies_fired - 1) * 6;
  }

  // Named strategy bonus — strategies have inherent quality scores.
  if (signal.fired_strategy && signal.fired_strategy.confidence) {
    score += (signal.fired_strategy.confidence - 60) * 0.2;
  }

  // ── Market focus bias ──────────────────────────────────────────────────────
  // Pair LIVE in current session → bonus.
  // Pair SIDELINED → significant penalty (low liquidity = unreliable signals).
  // Pair with HIGH news in next 30 min → penalty.
  if (focus) {
    const rel = focus.pair_relevance[signal.symbol];
    if (rel) {
      if (rel.tier === 'live')      score += 8;
      else if (rel.tier === 'active')   score += 3;
      else if (rel.tier === 'quiet')    score -= 8;
      else if (rel.tier === 'sidelined') score -= 15;
    }
    const newsAlert = focus.news_affected_pairs[signal.symbol];
    if (newsAlert && newsAlert.minutes_away < 30) score -= 10;
    else if (newsAlert && newsAlert.minutes_away < 90) score -= 4;
  }

  return Math.round(score * 10) / 10;
}

async function generateAllSignals() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  // Pull market focus once and reuse for scoring.
  const focus = await marketFocus.getMarketFocus().catch(() => null);

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
    .map(sig => ({ ...sig, opportunity_score: scoreSignal(sig, focus) }))
    .sort((a, b) => b.opportunity_score - a.opportunity_score);

  // Best opportunity: highest-scoring non-NEUTRAL signal on a LIVE pair.
  // If nothing is live, allow ACTIVE pairs.
  const livePicks = ranked.filter(s => s.direction !== 'NEUTRAL' &&
    focus && focus.pair_relevance[s.symbol] &&
    focus.pair_relevance[s.symbol].tier === 'live');
  const activePicks = ranked.filter(s => s.direction !== 'NEUTRAL');

  const out = {
    market_focus: focus,
    signals,
    ranked,
    errors,
    generated_at: new Date().toISOString(),
    best_opportunity: livePicks[0] || activePicks[0] || null,
  };

  cache.set(CACHE_KEY, out, CACHE_TTL);
  return out;
}

// Pure watchlist endpoint — all the strategies that are 50%+ ready across
// all pairs, sorted by how close they are to firing.
async function getWatchlist() {
  const focus = await marketFocus.getMarketFocus().catch(() => null);
  const symbols = listEnabledSymbols();
  const results = await Promise.allSettled(
    symbols.map(sym => signalService.generateSignal(sym))
  );

  const items = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const sig = r.value;
    if (!Array.isArray(sig.watchlist)) return;
    for (const w of sig.watchlist) {
      items.push({
        symbol: sig.symbol,
        display_name: sig.display_name,
        ...w,
      });
    }
  });

  items.sort((a, b) => b.completion_pct - a.completion_pct);
  return { items: items.slice(0, 15), market_focus: focus, generated_at: new Date().toISOString() };
}

module.exports = { generateAllSignals, getWatchlist, scoreSignal };
