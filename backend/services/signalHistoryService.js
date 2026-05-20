const supabase = require('../db/supabase');
const priceService = require('./priceService');
const { listEnabledSymbols, PRIMARY_SYMBOL } = require('../config/pairs');

// ─── Save a new signal to Supabase ───────────────────────────────────────────
// Now persists the `symbol` column. Legacy rows without symbol are treated
// as EUR/USD by all readers (see the COALESCE in stats queries).
async function saveSignal(signal) {
  if (signal.direction === 'NEUTRAL') return null;

  const { data, error } = await supabase
    .from('signals')
    .insert({
      symbol: signal.symbol || PRIMARY_SYMBOL,
      direction: signal.direction,
      entry: signal.entry,
      stop_loss: signal.stop_loss,
      take_profit_1: signal.take_profit_1,
      take_profit_2: signal.take_profit_2,
      confidence: signal.confidence,
      strategy: signal.strategy,
      // Persist the NAMED strategy that fired (single value, not the
      // composite `strategy` text) so we can compute per-strategy win rates.
      fired_strategy_name: signal.fired_strategy ? signal.fired_strategy.name : null,
      market_condition: signal.market_condition,
      timeframe: signal.timeframe || 'H1',
      risk_reward: signal.risk_reward,
      indicators_agreeing: signal.indicators_agreeing,
      total_indicators: signal.total_indicators,
    })
    .select()
    .single();

  if (error) {
    console.error('saveSignal error:', error.message);
    return null;
  }
  return data;
}

// ─── Candle-walking outcome evaluation ───────────────────────────────────────
// For each open signal, walk M15 candles between signal creation time and
// "now". Determine which of SL / TP1 / TP2 is touched FIRST, in time order.
// This replaces the broken "sample current price" approach which produced
// nonsense outcomes for any signal whose price visited a level and reversed
// before the next cron run.
//
// Ambiguity inside a single candle: when one bar's range contains BOTH the
// SL AND a TP level, we can't know intra-bar order without sub-M15 data.
// Conservative rule: assume the SL hit first. Better to under-state wins
// than overstate them when measuring algorithm performance.
//
// Returns the outcome decision so the caller (evaluateOpenSignals OR the
// one-shot backfill route) can persist it. Pure function — no DB writes.
async function determineOutcomeFromCandles(sig, candles) {
  const sigStartSec = Math.floor(new Date(sig.created_at).getTime() / 1000);
  // Only consider candles that opened AT or AFTER the signal time.
  // (A candle whose open is BEFORE signal time may have already had its
  // SL/TP-side wick happen before our signal even existed.)
  const relevant = candles.filter(c => c.time >= sigStartSec);

  for (const c of relevant) {
    if (sig.direction === 'BUY') {
      const slHit = sig.stop_loss     != null && c.low  <= sig.stop_loss;
      const tp1Hit = sig.take_profit_1 != null && c.high >= sig.take_profit_1;
      const tp2Hit = sig.take_profit_2 != null && c.high >= sig.take_profit_2;

      // Same-candle ambiguity: SL + TP both in this bar's range → SL first.
      if (slHit && (tp1Hit || tp2Hit)) {
        return { outcome: 'LOSS', outcome_price: sig.stop_loss, outcome_at_sec: c.time };
      }
      if (slHit) return { outcome: 'LOSS', outcome_price: sig.stop_loss, outcome_at_sec: c.time };
      // Prefer the higher target — if both TPs hit in the same bar, the
      // bigger win is consistent with how the price would have unfolded
      // (TP1 then TP2) since they're on the same side.
      if (tp2Hit) return { outcome: 'WIN_TP2', outcome_price: sig.take_profit_2, outcome_at_sec: c.time };
      if (tp1Hit) return { outcome: 'WIN_TP1', outcome_price: sig.take_profit_1, outcome_at_sec: c.time };
    } else if (sig.direction === 'SELL') {
      const slHit = sig.stop_loss     != null && c.high >= sig.stop_loss;
      const tp1Hit = sig.take_profit_1 != null && c.low  <= sig.take_profit_1;
      const tp2Hit = sig.take_profit_2 != null && c.low  <= sig.take_profit_2;

      if (slHit && (tp1Hit || tp2Hit)) {
        return { outcome: 'LOSS', outcome_price: sig.stop_loss, outcome_at_sec: c.time };
      }
      if (slHit) return { outcome: 'LOSS', outcome_price: sig.stop_loss, outcome_at_sec: c.time };
      if (tp2Hit) return { outcome: 'WIN_TP2', outcome_price: sig.take_profit_2, outcome_at_sec: c.time };
      if (tp1Hit) return { outcome: 'WIN_TP1', outcome_price: sig.take_profit_1, outcome_at_sec: c.time };
    }
  }

  // No level hit in any candle yet.
  return null;
}

// Worker: take a list of signals and decide outcomes for each by candle-walk.
// Persists the decision. Returns counts for logging.
async function processSignalBatch(signals) {
  if (!signals || signals.length === 0) return { total: 0, decided: 0, expired: 0 };

  // Group signals by symbol so we only fetch candles once per pair.
  const bySymbol = {};
  for (const s of signals) {
    const sym = s.symbol || PRIMARY_SYMBOL;
    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push(s);
  }

  // For each pair, fetch M15 candles wide enough to cover the oldest open
  // signal. M15 gives reasonable intra-trade resolution; with 24h max age
  // that's at most 96 candles per pair.
  const candleMap = {};
  await Promise.all(Object.keys(bySymbol).map(async sym => {
    try {
      candleMap[sym] = await priceService.fetchHistoricalData('15min', 120, sym);
    } catch (err) {
      console.warn(`[evaluateOpenSignals] no M15 candles for ${sym}:`, err.message);
      candleMap[sym] = null;
    }
  }));

  let decided = 0;
  let expired = 0;

  for (const sig of signals) {
    const sym = sig.symbol || PRIMARY_SYMBOL;
    const candles = candleMap[sym];

    let result = null;
    if (Array.isArray(candles) && candles.length > 0) {
      result = await determineOutcomeFromCandles(sig, candles);
    }

    const ageHours = (Date.now() - new Date(sig.created_at).getTime()) / 3600000;

    if (result) {
      await supabase
        .from('signals')
        .update({
          outcome: result.outcome,
          outcome_price: result.outcome_price,
          outcome_at: new Date(result.outcome_at_sec * 1000).toISOString(),
        })
        .eq('id', sig.id);
      decided++;
    } else if (ageHours > 24) {
      // No level was ever hit AND the signal has aged out → expire it.
      // outcome_price stays null (no actual hit price).
      await supabase
        .from('signals')
        .update({
          outcome: 'EXPIRED',
          outcome_price: null,
          outcome_at: new Date().toISOString(),
        })
        .eq('id', sig.id);
      expired++;
    }
    // else: still open, leave alone — next run will try again.
  }

  return { total: signals.length, decided, expired };
}

// ─── Cron-callable: evaluate open signals ────────────────────────────────────
async function evaluateOpenSignals() {
  // Only consider signals at least 15 min old so we have at least one full
  // M15 candle since they were generated.
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: openSignals, error } = await supabase
    .from('signals')
    .select('*')
    .is('outcome', null)
    .lt('created_at', cutoff);

  if (error || !openSignals || openSignals.length === 0) return;
  const result = await processSignalBatch(openSignals);
  if (result.decided > 0 || result.expired > 0) {
    console.log(`[evaluateOpenSignals] processed ${result.total}: ${result.decided} decided, ${result.expired} expired`);
  }
}

// ─── One-shot: re-evaluate ALL signals (fixes historical wrong outcomes) ─────
// Call this once after deploying the candle-walking logic. It picks up
// every signal (open OR previously-closed) and re-decides the outcome from
// candle data. This corrects historical rows that were wrongly marked WIN/
// LOSS by the old "sample current price" approach.
async function reEvaluateAllSignals({ includeClosed = true } = {}) {
  let query = supabase.from('signals').select('*');
  if (!includeClosed) query = query.is('outcome', null);

  const { data, error } = await query;
  if (error) throw new Error(`reEvaluateAllSignals fetch failed: ${error.message}`);
  if (!data || data.length === 0) return { total: 0, decided: 0, expired: 0 };

  return await processSignalBatch(data);
}

// ─── History fetch (optionally per-symbol) ───────────────────────────────────
async function getSignalHistory(limit = 50, symbol = null) {
  let query = supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (symbol) query = query.eq('symbol', symbol);

  const { data, error } = await query;
  if (error) {
    console.error('getSignalHistory error:', error.message);
    return [];
  }
  return data || [];
}

// ─── Stats (overall + per-pair breakdown) ────────────────────────────────────
function emptyStats() {
  return {
    total: 0, wins: 0, losses: 0, win_rate: 0,
    avg_confidence: 0, win_confidence: 0, loss_confidence: 0,
    buy_win_rate: 0, sell_win_rate: 0,
  };
}

function computeStats(rows) {
  if (!rows || rows.length === 0) return emptyStats();
  const wins   = rows.filter(s => s.outcome === 'WIN_TP1' || s.outcome === 'WIN_TP2');
  const losses = rows.filter(s => s.outcome === 'LOSS');
  const total  = wins.length + losses.length;
  const avg = arr => arr.length > 0 ? Math.round(arr.reduce((s, x) => s + x.confidence, 0) / arr.length) : 0;
  const buys     = rows.filter(s => s.direction === 'BUY');
  const sells    = rows.filter(s => s.direction === 'SELL');
  const buyWins  = buys.filter(s => s.outcome === 'WIN_TP1' || s.outcome === 'WIN_TP2');
  const sellWins = sells.filter(s => s.outcome === 'WIN_TP1' || s.outcome === 'WIN_TP2');
  return {
    total,
    wins:  wins.length,
    losses: losses.length,
    win_rate: total > 0 ? Math.round((wins.length / total) * 100) : 0,
    avg_confidence:  avg(rows),
    win_confidence:  avg(wins),
    loss_confidence: avg(losses),
    buy_win_rate:  buys.length  > 0 ? Math.round((buyWins.length  / buys.length)  * 100) : 0,
    sell_win_rate: sells.length > 0 ? Math.round((sellWins.length / sells.length) * 100) : 0,
  };
}

// Overall stats — also returns a per-pair breakdown for the UI.
async function getSignalStats(symbol = null) {
  let query = supabase
    .from('signals')
    .select('symbol, direction, confidence, outcome')
    .not('outcome', 'is', null)
    .neq('outcome', 'EXPIRED');
  if (symbol) query = query.eq('symbol', symbol);

  const { data, error } = await query;
  if (error || !data) return { ...emptyStats(), per_pair: {} };

  const overall = computeStats(data);

  // Per-pair breakdown (always include all enabled pairs, even if zero stats)
  const per_pair = {};
  for (const sym of listEnabledSymbols()) per_pair[sym] = emptyStats();
  for (const row of data) {
    const sym = row.symbol || PRIMARY_SYMBOL;
    if (!per_pair[sym]) per_pair[sym] = emptyStats();
  }
  for (const sym of Object.keys(per_pair)) {
    per_pair[sym] = computeStats(data.filter(r => (r.symbol || PRIMARY_SYMBOL) === sym));
  }

  return { ...overall, per_pair };
}

// ─── Per-strategy stats (cross-pair + per-pair win rates) ────────────────────
// Reads from signals.fired_strategy_name (populated by signalService since
// Phase 4 migration). Tells you which named strategies actually work for
// each pair — the single most useful "is this system worth trusting" stat.
async function getStrategyStats() {
  const { data, error } = await supabase
    .from('signals')
    .select('symbol, fired_strategy_name, confidence, outcome')
    .not('outcome', 'is', null)
    .neq('outcome', 'EXPIRED')
    .not('fired_strategy_name', 'is', null);

  if (error || !data) return { strategies: [], by_pair: {} };

  // Aggregate cross-pair per strategy
  const byStrat = {};
  for (const row of data) {
    const k = row.fired_strategy_name;
    if (!byStrat[k]) byStrat[k] = { name: k, wins: 0, losses: 0, total: 0, confidence_sum: 0 };
    byStrat[k].total += 1;
    byStrat[k].confidence_sum += row.confidence;
    if (row.outcome === 'WIN_TP1' || row.outcome === 'WIN_TP2') byStrat[k].wins += 1;
    else if (row.outcome === 'LOSS') byStrat[k].losses += 1;
  }

  // Aggregate per pair per strategy
  const byPair = {};
  for (const row of data) {
    const sym = row.symbol || PRIMARY_SYMBOL;
    const strat = row.fired_strategy_name;
    if (!byPair[sym]) byPair[sym] = {};
    if (!byPair[sym][strat]) byPair[sym][strat] = { name: strat, wins: 0, losses: 0, total: 0 };
    byPair[sym][strat].total += 1;
    if (row.outcome === 'WIN_TP1' || row.outcome === 'WIN_TP2') byPair[sym][strat].wins += 1;
    else if (row.outcome === 'LOSS') byPair[sym][strat].losses += 1;
  }

  // Finalise cross-pair stats
  const strategies = Object.values(byStrat).map(s => ({
    name: s.name,
    total: s.total,
    wins: s.wins,
    losses: s.losses,
    win_rate: s.total > 0 ? Math.round((s.wins / s.total) * 100) : 0,
    avg_confidence: s.total > 0 ? Math.round(s.confidence_sum / s.total) : 0,
  })).sort((a, b) => b.total - a.total);

  // Finalise per-pair stats
  const by_pair = {};
  for (const sym of Object.keys(byPair)) {
    by_pair[sym] = Object.values(byPair[sym]).map(s => ({
      ...s,
      win_rate: s.total > 0 ? Math.round((s.wins / s.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }

  return { strategies, by_pair, min_samples: 8 };
}

module.exports = {
  saveSignal,
  evaluateOpenSignals,
  reEvaluateAllSignals,
  getSignalHistory,
  getSignalStats,
  getStrategyStats,
};
