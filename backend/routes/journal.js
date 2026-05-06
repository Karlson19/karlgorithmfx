const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');

// Verify JWT from Supabase and get user
async function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return user;
}

// GET /api/journal — all trades
router.get('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('opened_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/stats
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

    const winners = trades.filter(t => t.profit_loss > 0);
    const losers = trades.filter(t => t.profit_loss < 0);
    const totalProfit = winners.reduce((s, t) => s + parseFloat(t.profit_loss), 0);
    const totalLoss = Math.abs(losers.reduce((s, t) => s + parseFloat(t.profit_loss), 0));

    // Calculate streak
    const sorted = [...trades].sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
    let streak = 0;
    if (sorted.length > 0) {
      const firstDir = sorted[0].profit_loss > 0;
      for (const t of sorted) {
        if ((t.profit_loss > 0) === firstDir) streak++;
        else break;
      }
      if (!firstDir) streak = -streak;
    }

    res.json({
      total_trades: trades.length,
      winning_trades: winners.length,
      losing_trades: losers.length,
      win_rate: trades.length > 0 ? parseFloat((winners.length / trades.length * 100).toFixed(1)) : 0,
      total_profit: parseFloat((totalProfit - totalLoss).toFixed(2)),
      average_profit: winners.length > 0 ? parseFloat((totalProfit / winners.length).toFixed(2)) : 0,
      average_loss: losers.length > 0 ? parseFloat((totalLoss / losers.length).toFixed(2)) : 0,
      profit_factor: totalLoss > 0 ? parseFloat((totalProfit / totalLoss).toFixed(2)) : 0,
      best_trade: winners.length > 0 ? parseFloat(Math.max(...winners.map(t => parseFloat(t.profit_loss))).toFixed(2)) : 0,
      worst_trade: losers.length > 0 ? parseFloat(Math.min(...losers.map(t => parseFloat(t.profit_loss))).toFixed(2)) : 0,
      current_streak: streak
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/journal — log trade
router.post('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { direction, lot_size, entry_price, stop_loss, take_profit, strategy, notes, status, close_price } = req.body;

    let profit_loss = null;
    if (status === 'closed' && close_price) {
      const pips = direction === 'BUY'
        ? (parseFloat(close_price) - parseFloat(entry_price)) * 10000
        : (parseFloat(entry_price) - parseFloat(close_price)) * 10000;
      profit_loss = parseFloat((pips * parseFloat(lot_size) * 1).toFixed(2));
    }

    const { data, error } = await supabase.from('trades').insert({
      user_id: user.id,
      pair: 'EURUSD',
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
      closed_at: status === 'closed' ? new Date().toISOString() : null
    }).select().single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/journal/:id — update / close trade
router.put('/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const updates = req.body;

    // If closing, calculate P&L
    if (updates.status === 'closed' && updates.close_price) {
      const { data: existing } = await supabase
        .from('trades').select('*').eq('id', id).single();

      if (existing) {
        const pips = existing.direction === 'BUY'
          ? (parseFloat(updates.close_price) - parseFloat(existing.entry_price)) * 10000
          : (parseFloat(existing.entry_price) - parseFloat(updates.close_price)) * 10000;
        updates.profit_loss = parseFloat((pips * parseFloat(existing.lot_size) * 1).toFixed(2));
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
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/journal/:id
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

module.exports = router;
