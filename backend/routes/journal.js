const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const priceService = require('../services/priceService');
const tradeMonitor = require('../services/tradeMonitorService');
const { getPair, PRIMARY_SYMBOL, isSupported } = require('../config/pairs');

// ─── Auth helper ─────────────────────────────────────────────────────────────
async function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return user;
}

// ─── Pair-aware P&L math ─────────────────────────────────────────────────────
// Previously: `pips * lot_size * 1` — the "1" was supposed to be pip value
// but was literally the integer 1. Plus pip math hardcoded × 10000 (only
// correct for FX majors).
//
// Correct formula:
//   pips = abs(price_diff) / pair.pip_size  (signed for direction)
//   pnl_usd = pips * pair.pip_value_per_std_lot_usd * lot_size
//
// For USD-quoted pairs (X/USD) the pip value is fixed per std lot — easy.
// For USD/JPY the exact pip value is 1000/current_price but our config
// provides a conservative estimate (~$6.70 @ price=150). When computing
// P&L at trade-close we can recompute using the close_price for accuracy.
function pnlFromPrices({ pair, direction, entry_price, close_price, lot_size }) {
  if (!pair) return null;
  const dir = direction === 'BUY' ? 1 : -1;
  const priceDiff = (close_price - entry_price) * dir;
  const pips = priceDiff / pair.pip_size;

  // For USD/JPY style pairs (USD is base, JPY is quote), pip value
  // depends on the close price. Recompute precisely.
  let pipValue = pair.pip_value_per_std_lot_usd;
  if (pair.symbol === 'USD/JPY' && close_price > 0) {
    // 1 std lot of USD/JPY = 100,000 USD. Pip = 0.01 JPY. JPY value of
    // 1 pip = 100,000 × 0.01 = 1000 JPY. Convert to USD: 1000 / close_price.
    pipValue = 1000 / close_price;
  }
  return parseFloat((pips * pipValue * lot_size).toFixed(2));
}

// ─── GET /api/journal — all trades for the user ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { pair } = req.query;
    let query = supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('opened_at', { ascending: false });
    if (pair) query = query.eq('pair', pair);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/journal/stats ──────────────────────────────────────────────────
// Now includes per-pair breakdown alongside overall numbers so the journal
// UI can show "win rate on USD/JPY vs gold" at a glance.
router.get('/stats', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'closed');

    if (error) throw error;

    const compute = (rows) => {
      const winners = rows.filter(t => parseFloat(t.profit_loss) > 0);
      const losers  = rows.filter(t => parseFloat(t.profit_loss) < 0);
      const totalProfit = winners.reduce((s, t) => s + parseFloat(t.profit_loss), 0);
      const totalLoss   = Math.abs(losers.reduce((s, t) => s + parseFloat(t.profit_loss), 0));
      const sorted = [...rows].sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
      let streak = 0;
      if (sorted.length > 0) {
        const firstWin = parseFloat(sorted[0].profit_loss) > 0;
        for (const t of sorted) {
          if ((parseFloat(t.profit_loss) > 0) === firstWin) streak++;
          else break;
        }
        if (!firstWin) streak = -streak;
      }
      return {
        total_trades: rows.length,
        winning_trades: winners.length,
        losing_trades: losers.length,
        win_rate: rows.length > 0 ? parseFloat((winners.length / rows.length * 100).toFixed(1)) : 0,
        total_profit: parseFloat((totalProfit - totalLoss).toFixed(2)),
        average_profit: winners.length > 0 ? parseFloat((totalProfit / winners.length).toFixed(2)) : 0,
        average_loss: losers.length > 0 ? parseFloat((totalLoss / losers.length).toFixed(2)) : 0,
        profit_factor: totalLoss > 0 ? parseFloat((totalProfit / totalLoss).toFixed(2)) : 0,
        best_trade: winners.length > 0 ? parseFloat(Math.max(...winners.map(t => parseFloat(t.profit_loss))).toFixed(2)) : 0,
        worst_trade: losers.length > 0 ? parseFloat(Math.min(...losers.map(t => parseFloat(t.profit_loss))).toFixed(2)) : 0,
        current_streak: streak,
      };
    };

    const overall = compute(trades);

    // Per-pair breakdown
    const byPair = {};
    for (const t of trades) {
      const p = t.pair || PRIMARY_SYMBOL;
      if (!byPair[p]) byPair[p] = [];
      byPair[p].push(t);
    }
    const per_pair = {};
    for (const [p, rows] of Object.entries(byPair)) per_pair[p] = compute(rows);

    res.json({ ...overall, per_pair });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Risk circuit-breakers ───────────────────────────────────────────────────
// Called before inserting a new trade. Enforces user-configured limits:
//   - max_concurrent_positions: hard cap on number of simultaneously-open
//     trades (counts only status='open'). 0 = disabled.
//   - max_daily_loss_usd: hard cap on accumulated negative P&L for the
//     current UTC day. Once breached, no new trades until UTC midnight.
//     0 = disabled.
//
// max_daily_loss_usd / max_concurrent_positions are sent in the request
// body (frontend pulls them from user prefs) since the backend doesn't
// otherwise know the user's preferences. They're advisory limits the user
// controls.
async function checkRiskLimits(userId, { max_daily_loss_usd, max_concurrent_positions }) {
  // Max concurrent positions
  if (max_concurrent_positions > 0) {
    const { count, error } = await supabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'open');
    if (!error && (count || 0) >= max_concurrent_positions) {
      return {
        ok: false, reason: 'max_positions',
        message: `You already have ${count} open positions (limit ${max_concurrent_positions}). Close one before opening another.`,
      };
    }
  }

  // Daily loss limit (UTC day)
  if (max_daily_loss_usd > 0) {
    const utcMidnight = new Date();
    utcMidnight.setUTCHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from('trades')
      .select('profit_loss')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .gte('closed_at', utcMidnight.toISOString());
    if (!error && Array.isArray(data)) {
      const todayPnL = data.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0);
      // Negative P&L exceeding the loss limit blocks new trades
      if (todayPnL <= -Math.abs(max_daily_loss_usd)) {
        return {
          ok: false, reason: 'daily_loss',
          message: `Daily loss limit hit (P&L today: $${todayPnL.toFixed(2)}, limit -$${max_daily_loss_usd}). No new trades until 00:00 UTC.`,
        };
      }
    }
  }

  return { ok: true };
}

// ─── POST /api/journal — log trade ────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const {
      pair: pairSymbol,
      signal_id,
      direction,
      lot_size,
      entry_price,
      stop_loss,
      take_profit,
      strategy,
      notes,
      status,
      close_price,
      // Risk-limit prefs forwarded by the frontend
      max_daily_loss_usd,
      max_concurrent_positions,
    } = req.body;

    // Validate pair against the config — never accept an unknown symbol.
    const symbol = pairSymbol || PRIMARY_SYMBOL;
    if (!isSupported(symbol)) {
      return res.status(400).json({ error: `Unsupported pair: ${symbol}` });
    }
    const pair = getPair(symbol);

    // Validate direction
    if (direction !== 'BUY' && direction !== 'SELL') {
      return res.status(400).json({ error: 'direction must be BUY or SELL' });
    }

    // Risk circuit-breakers — only applied when opening a fresh position
    // (not when logging a trade that's already closed for historical record).
    if (status !== 'closed') {
      const limits = await checkRiskLimits(user.id, {
        max_daily_loss_usd: parseFloat(max_daily_loss_usd) || 0,
        max_concurrent_positions: parseInt(max_concurrent_positions) || 0,
      });
      if (!limits.ok) {
        return res.status(422).json({
          error: limits.message, reason: limits.reason,
        });
      }
    }

    // Pair-aware P&L computation if closed at insert time
    let profit_loss = null;
    if (status === 'closed' && close_price) {
      profit_loss = pnlFromPrices({
        pair, direction,
        entry_price: parseFloat(entry_price),
        close_price: parseFloat(close_price),
        lot_size:    parseFloat(lot_size),
      });
    }

    const { data, error } = await supabase.from('trades').insert({
      user_id: user.id,
      pair: symbol,
      signal_id: signal_id || null,
      direction,
      lot_size: parseFloat(lot_size),
      entry_price: parseFloat(entry_price),
      stop_loss: stop_loss ? parseFloat(stop_loss) : null,
      take_profit: take_profit ? parseFloat(take_profit) : null,
      close_price: close_price ? parseFloat(close_price) : null,
      profit_loss,
      status: status || 'open',
      strategy,
      notes,
      closed_at: status === 'closed' ? new Date().toISOString() : null,
    }).select().single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/journal/:id — update / close trade ─────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const updates = req.body;

    // If closing, recompute P&L using the pair's pip math.
    if (updates.status === 'closed' && updates.close_price) {
      const { data: existing } = await supabase
        .from('trades').select('*').eq('id', id).eq('user_id', user.id).single();
      if (existing) {
        const pair = getPair(existing.pair) || getPair(PRIMARY_SYMBOL);
        updates.profit_loss = pnlFromPrices({
          pair,
          direction: existing.direction,
          entry_price: parseFloat(existing.entry_price),
          close_price: parseFloat(updates.close_price),
          lot_size: parseFloat(existing.lot_size),
        });
        updates.closed_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from('trades')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;

    // If the user moved SL to break-even (or beyond) or closed the trade,
    // reset the peak-profit tracker so we stop nagging about giveback on
    // a position that's already protected.
    try {
      if (data) {
        const slMoved = data.stop_loss != null
          && ((data.direction === 'BUY'  && parseFloat(data.stop_loss) >= parseFloat(data.entry_price))
           || (data.direction === 'SELL' && parseFloat(data.stop_loss) <= parseFloat(data.entry_price)));
        if (slMoved || data.status === 'closed') {
          tradeMonitor.resetPeak(data.id);
        }
      }
    } catch {}

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/journal/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('trades')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/journal/alerts ─────────────────────────────────────────────────
// Per-user trade-monitor alerts: PROFIT_GIVEBACK, MOVE_TO_BREAKEVEN,
// DANGEROUS_SESSION, VOLATILITY_SPIKE, HIGH_NEWS_INCOMING, TP1_HIT.
// Computed live from open trades + market state — no DB writes.
router.get('/alerts', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const alerts = await tradeMonitor.analyseOpenTrades(user.id);
    res.json({ alerts, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('alerts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/journal/monitor ────────────────────────────────────────────────
// Rich per-trade monitor snapshot for the Monitor page: every open trade
// with its live P&L, peak, progress to TP, SL-at-breakeven flag, and alerts.
router.get('/monitor', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const snapshot = await tradeMonitor.getMonitorSnapshot(user.id);
    res.json(snapshot);
  } catch (err) {
    console.error('monitor error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
