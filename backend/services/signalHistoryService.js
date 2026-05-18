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

// ─── Evaluate open signals against current price (per-symbol) ────────────────
async function evaluateOpenSignals() {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: openSignals, error } = await supabase
    .from('signals')
    .select('*')
    .is('outcome', null)
    .lt('created_at', cutoff);

  if (error || !openSignals || openSignals.length === 0) return;

  // Fetch current price for every distinct symbol we have open signals on,
  // in parallel. Falls back to PRIMARY_SYMBOL for legacy rows.
  const symbols = Array.from(new Set(
    openSignals.map(s => s.symbol || PRIMARY_SYMBOL)
  ));
  const priceMap = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const p = await priceService.fetchLivePrice(sym);
      if (p) priceMap[sym] = p.price;
    } catch { /* leave priceMap[sym] undefined → signal stays open */ }
  }));

  const now = new Date().toISOString();

  for (const sig of openSignals) {
    const sym = sig.symbol || PRIMARY_SYMBOL;
    const currentPrice = priceMap[sym];
    if (currentPrice == null) continue; // skip until we get a price next run

    const ageHours = (Date.now() - new Date(sig.created_at).getTime()) / 3600000;

    if (ageHours > 24) {
      await supabase
        .from('signals')
        .update({ outcome: 'EXPIRED', outcome_price: currentPrice, outcome_at: now })
        .eq('id', sig.id);
      continue;
    }

    let outcome = null;
    if (sig.direction === 'BUY') {
      if (sig.take_profit_2 && currentPrice >= sig.take_profit_2) outcome = 'WIN_TP2';
      else if (sig.take_profit_1 && currentPrice >= sig.take_profit_1) outcome = 'WIN_TP1';
      else if (sig.stop_loss && currentPrice <= sig.stop_loss) outcome = 'LOSS';
    } else if (sig.direction === 'SELL') {
      if (sig.take_profit_2 && currentPrice <= sig.take_profit_2) outcome = 'WIN_TP2';
      else if (sig.take_profit_1 && currentPrice <= sig.take_profit_1) outcome = 'WIN_TP1';
      else if (sig.stop_loss && currentPrice >= sig.stop_loss) outcome = 'LOSS';
    }

    if (outcome) {
      await supabase
        .from('signals')
        .update({ outcome, outcome_price: currentPrice, outcome_at: now })
        .eq('id', sig.id);
    }
  }
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

module.exports = {
  saveSignal,
  evaluateOpenSignals,
  getSignalHistory,
  getSignalStats,
};
