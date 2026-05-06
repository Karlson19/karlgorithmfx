const supabase = require('../db/supabase');
const priceService = require('./priceService');

// ─── Save a new signal to Supabase ───────────────────────────────────────────

async function saveSignal(signal) {
  if (signal.direction === 'NEUTRAL') return null;

  const { data, error } = await supabase
    .from('signals')
    .insert({
      direction: signal.direction,
      entry: signal.entry,
      stop_loss: signal.stop_loss,
      take_profit_1: signal.take_profit_1,
      take_profit_2: signal.take_profit_2,
      confidence: signal.confidence,
      strategy: signal.strategy,
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

// ─── Evaluate open signals against current price ─────────────────────────────

async function evaluateOpenSignals() {
  // Fetch all signals that have no outcome yet and are older than 15 minutes
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: openSignals, error } = await supabase
    .from('signals')
    .select('*')
    .is('outcome', null)
    .lt('created_at', cutoff);

  if (error || !openSignals || openSignals.length === 0) return;

  let priceData;
  try {
    priceData = await priceService.fetchLivePrice();
  } catch {
    return;
  }
  if (!priceData) return;

  const currentPrice = priceData.price;
  const now = new Date().toISOString();

  for (const sig of openSignals) {
    const ageHours = (Date.now() - new Date(sig.created_at).getTime()) / 3600000;

    // Expire signals older than 24 hours with no outcome
    if (ageHours > 24) {
      await supabase
        .from('signals')
        .update({ outcome: 'EXPIRED', outcome_price: currentPrice, outcome_at: now })
        .eq('id', sig.id);
      continue;
    }

    let outcome = null;

    if (sig.direction === 'BUY') {
      if (sig.take_profit_2 && currentPrice >= sig.take_profit_2) {
        outcome = 'WIN_TP2';
      } else if (sig.take_profit_1 && currentPrice >= sig.take_profit_1) {
        outcome = 'WIN_TP1';
      } else if (sig.stop_loss && currentPrice <= sig.stop_loss) {
        outcome = 'LOSS';
      }
    } else if (sig.direction === 'SELL') {
      if (sig.take_profit_2 && currentPrice <= sig.take_profit_2) {
        outcome = 'WIN_TP2';
      } else if (sig.take_profit_1 && currentPrice <= sig.take_profit_1) {
        outcome = 'WIN_TP1';
      } else if (sig.stop_loss && currentPrice >= sig.stop_loss) {
        outcome = 'LOSS';
      }
    }

    if (outcome) {
      await supabase
        .from('signals')
        .update({ outcome, outcome_price: currentPrice, outcome_at: now })
        .eq('id', sig.id);
    }
  }
}

// ─── Fetch recent signal history ─────────────────────────────────────────────

async function getSignalHistory(limit = 50) {
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('getSignalHistory error:', error.message);
    return [];
  }
  return data || [];
}

// ─── Compute performance stats ────────────────────────────────────────────────

async function getSignalStats() {
  const { data, error } = await supabase
    .from('signals')
    .select('direction, confidence, outcome')
    .not('outcome', 'is', null)
    .neq('outcome', 'EXPIRED');

  if (error || !data || data.length === 0) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      avg_confidence: 0,
      win_confidence: 0,
      loss_confidence: 0,
      buy_win_rate: 0,
      sell_win_rate: 0,
    };
  }

  const wins  = data.filter(s => s.outcome === 'WIN_TP1' || s.outcome === 'WIN_TP2');
  const losses = data.filter(s => s.outcome === 'LOSS');
  const total = wins.length + losses.length;

  const avg = arr => arr.length > 0 ? Math.round(arr.reduce((s, x) => s + x.confidence, 0) / arr.length) : 0;

  const buySignals  = data.filter(s => s.direction === 'BUY');
  const sellSignals = data.filter(s => s.direction === 'SELL');
  const buyWins  = buySignals.filter(s => s.outcome === 'WIN_TP1' || s.outcome === 'WIN_TP2');
  const sellWins = sellSignals.filter(s => s.outcome === 'WIN_TP1' || s.outcome === 'WIN_TP2');

  return {
    total,
    wins: wins.length,
    losses: losses.length,
    win_rate: total > 0 ? Math.round((wins.length / total) * 100) : 0,
    avg_confidence: avg(data),
    win_confidence:  avg(wins),
    loss_confidence: avg(losses),
    buy_win_rate:  buySignals.length  > 0 ? Math.round((buyWins.length  / buySignals.length)  * 100) : 0,
    sell_win_rate: sellSignals.length > 0 ? Math.round((sellWins.length / sellSignals.length) * 100) : 0,
  };
}

module.exports = { saveSignal, evaluateOpenSignals, getSignalHistory, getSignalStats };
