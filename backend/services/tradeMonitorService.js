const priceService = require('./priceService');
const indicatorService = require('./indicatorService');
const newsService = require('./newsService');
const supabase = require('../db/supabase');
const cache = require('../utils/cache');
const { getPair, listEnabledSymbols } = require('../config/pairs');

// ─── Trade Monitor Service ───────────────────────────────────────────────────
// Watches OPEN journal trades and produces structured risk-management
// alerts. This is what was missing when a +$44 gold trade reversed and
// wiped an account during the Asian session — the system gave the signal
// but never followed up once the trade was live.
//
// Alerts are computed live on each call (no DB persistence). They expire
// naturally when the underlying condition stops being true.
//
// Trade peak tracking is in-memory (cache util) keyed by trade_id —
// we remember the maximum favourable excursion seen so far so we can
// detect "trade gave back its profit" without storing it in Supabase.
//
// Severity tiers:
//   info     → useful FYI, no immediate action required
//   warning  → consider an action soon (move SL, watch closely)
//   critical → take action NOW (close, tighten, sit out)
//
// Each alert carries:
//   { id, trade_id, type, severity, title, message, suggested_action,
//     suggested_sl?, created_at }
//
// Public surface:
//   - analyseOpenTrades(userId) → returns this user's alerts
//   - resetPeak(tradeId) — used when user actually moves SL to BE so we
//     stop nagging.

const PEAK_CACHE_PREFIX = 'trade_peak_';
const PEAK_TTL_SECONDS  = 7 * 24 * 3600;  // peak survives a week of inactivity

// ─── Per-pair "dangerous session" map ────────────────────────────────────────
// Reuses the session_weights config — a session is DANGEROUS for a pair
// when its weight is ≤ 0.4 (i.e., thin liquidity for that pair).
function isDangerousSession(pair, sessionLabel) {
  const w = pair.session_weights[sessionLabel];
  return w != null && w <= 0.4;
}

// ─── Session detection (mirrors getSessionContext in signalService) ──────────
function currentSessionLabel(now = new Date()) {
  const h = now.getUTCHours();
  if (h >= 12 && h < 16) return 'LONDON_NY_OVERLAP';
  if (h >= 7  && h < 16) return 'LONDON';
  if (h >= 12 && h < 21) return 'NEW_YORK';
  if (h >= 21 && h < 23) return 'DEAD_ZONE';
  return 'ASIAN'; // 23-07 UTC
}

// ─── P&L calculation (pair-aware, matches backend/routes/journal.js) ─────────
function unrealizedPnL(trade, currentPrice) {
  const pair = getPair(trade.pair);
  if (!pair) return null;
  const dir = trade.direction === 'BUY' ? 1 : -1;
  const priceDiff = (currentPrice - parseFloat(trade.entry_price)) * dir;
  const pips = priceDiff / pair.pip_size;
  // For USD/JPY recompute pip value against current price; everything else
  // uses the static pip_value_per_std_lot_usd.
  let pipValue = pair.pip_value_per_std_lot_usd;
  if (pair.symbol === 'USD/JPY' && currentPrice > 0) {
    pipValue = 1000 / currentPrice;
  }
  return parseFloat((pips * pipValue * parseFloat(trade.lot_size)).toFixed(2));
}

// ─── Distance helpers ────────────────────────────────────────────────────────
// % progress from entry toward TP1 (BUY: 0 at entry, 100 at TP1).
// Returns null if no TP1 is set.
function progressToTP1(trade, currentPrice) {
  if (trade.take_profit_1 == null) return null;
  const entry = parseFloat(trade.entry_price);
  const tp1 = parseFloat(trade.take_profit_1);
  if (entry === tp1) return null;
  const direction = trade.direction;
  const traveled = direction === 'BUY'
    ? currentPrice - entry
    : entry - currentPrice;
  const distance = Math.abs(tp1 - entry);
  return distance > 0 ? (traveled / distance) * 100 : null;
}

// Was SL already adjusted to break-even or better? Same direction = SL on
// the "safe" side of entry.
function isSLAtBreakevenOrBetter(trade) {
  if (trade.stop_loss == null) return false;
  const entry = parseFloat(trade.entry_price);
  const sl = parseFloat(trade.stop_loss);
  if (trade.direction === 'BUY')  return sl >= entry;
  if (trade.direction === 'SELL') return sl <= entry;
  return false;
}

// ─── Peak tracking ───────────────────────────────────────────────────────────
function peakKey(tradeId) { return PEAK_CACHE_PREFIX + tradeId; }

function getPeakProfit(tradeId) {
  return cache.get(peakKey(tradeId)) || 0;
}

function updatePeakProfit(tradeId, currentPnL) {
  const peak = getPeakProfit(tradeId);
  if (currentPnL > peak) {
    cache.set(peakKey(tradeId), currentPnL, PEAK_TTL_SECONDS);
    return currentPnL;
  }
  return peak;
}

function resetPeak(tradeId) {
  cache.del(peakKey(tradeId));
}

// ─── Volatility spike detection ──────────────────────────────────────────────
// Compares current candle's range to the previous 20 candles' average.
// Returns the multiplier (e.g., 2.8 means current bar is 2.8× normal).
async function currentVolatilityMultiplier(symbol) {
  try {
    const candles = await priceService.fetchHistoricalData('15min', 25, symbol);
    if (!candles || candles.length < 21) return 1;
    const current = candles[candles.length - 1];
    const prior = candles.slice(-21, -1);
    const avg = prior.reduce((s, c) => s + (c.high - c.low), 0) / prior.length;
    if (avg <= 0) return 1;
    return (current.high - current.low) / avg;
  } catch { return 1; }
}

// ─── Build alerts for one trade ──────────────────────────────────────────────
async function alertsForTrade(trade, ctx) {
  const alerts = [];
  const symbol = trade.pair;
  const pair = getPair(symbol);
  if (!pair) return alerts;

  // Current price (last closed candle)
  const candles = ctx.candleMap[symbol];
  if (!candles || candles.length === 0) return alerts;
  const currentPrice = candles[candles.length - 1].close;

  const pnl = unrealizedPnL(trade, currentPrice);
  if (pnl == null) return alerts;

  const peak = updatePeakProfit(trade.id, pnl);
  const progress = progressToTP1(trade, currentPrice);
  const slAtBE = isSLAtBreakevenOrBetter(trade);
  const session = ctx.sessionLabel;

  // ─── ALERT 1: PROFIT_GIVEBACK (the most important one) ─────────────────
  // The exact failure mode that wiped the account today. The trade went
  // into significant profit then reversed. Two tiers:
  //  - peak > $20 AND current < 50% of peak → critical
  //  - peak > $10 AND current < peak * 0.4 → warning
  if (peak >= 20 && pnl < peak * 0.5 && !slAtBE) {
    alerts.push({
      id: `${trade.id}_giveback_critical`,
      trade_id: trade.id,
      symbol,
      type: 'PROFIT_GIVEBACK',
      severity: 'critical',
      title: `${pair.display_name} reversed — protect your gains`,
      message: `This trade was up $${peak.toFixed(2)} (peak) and is now $${pnl.toFixed(2)}. You've given back ${Math.round((1 - pnl/peak) * 100)}% of the gain. Close the trade or move SL to lock in what's left.`,
      suggested_action: 'CLOSE_OR_MOVE_SL_NOW',
      suggested_sl: parseFloat(trade.entry_price),
      current_price: currentPrice,
      current_pnl: pnl,
      peak_pnl: peak,
    });
  } else if (peak >= 10 && pnl < peak * 0.4 && !slAtBE) {
    alerts.push({
      id: `${trade.id}_giveback_warn`,
      trade_id: trade.id,
      symbol,
      type: 'PROFIT_GIVEBACK',
      severity: 'warning',
      title: `${pair.display_name} pulling back from peak`,
      message: `Was up $${peak.toFixed(2)}, now $${pnl.toFixed(2)}. Move SL to break-even so the worst case is zero.`,
      suggested_action: 'MOVE_SL_TO_BE',
      suggested_sl: parseFloat(trade.entry_price),
      current_price: currentPrice,
      current_pnl: pnl,
      peak_pnl: peak,
    });
  }

  // ─── ALERT 2: MOVE_TO_BREAKEVEN (proactive) ─────────────────────────────
  // When progress to TP1 is significant AND SL hasn't been moved yet, prompt
  // for break-even. Avoids the "give it more room" trap.
  if (progress != null && !slAtBE && pnl > 0) {
    if (progress >= 60) {
      alerts.push({
        id: `${trade.id}_be_urgent`,
        trade_id: trade.id,
        symbol,
        type: 'MOVE_TO_BREAKEVEN',
        severity: 'warning',
        title: `${pair.display_name} is ${Math.round(progress)}% to TP1 — move SL to entry`,
        message: `You've travelled most of the way to your TP. Move SL to ${parseFloat(trade.entry_price).toFixed(pair.digits)} so the worst case is zero.`,
        suggested_action: 'MOVE_SL_TO_BE',
        suggested_sl: parseFloat(trade.entry_price),
        current_price: currentPrice,
        current_pnl: pnl,
      });
    } else if (progress >= 30) {
      alerts.push({
        id: `${trade.id}_be_info`,
        trade_id: trade.id,
        symbol,
        type: 'MOVE_TO_BREAKEVEN',
        severity: 'info',
        title: `${pair.display_name} is ${Math.round(progress)}% to TP1`,
        message: `Once you cross 60% to TP1, plan to move SL to break-even.`,
        suggested_action: 'MONITOR',
        current_price: currentPrice,
        current_pnl: pnl,
      });
    }
  }

  // ─── ALERT 3: TP1_HIT ───────────────────────────────────────────────────
  if (progress != null && progress >= 100) {
    alerts.push({
      id: `${trade.id}_tp1_hit`,
      trade_id: trade.id,
      symbol,
      type: 'TP1_HIT',
      severity: 'info',
      title: `${pair.display_name} hit TP1`,
      message: `Profit secured. Consider closing half and trailing SL on the rest.`,
      suggested_action: 'CLOSE_PARTIAL_TRAIL',
      current_price: currentPrice,
      current_pnl: pnl,
    });
  }

  // ─── ALERT 4: DANGEROUS_SESSION ─────────────────────────────────────────
  // The gold + Asian session combination that wiped the account.
  if (isDangerousSession(pair, session)) {
    const sessionDesc = session.replace(/_/g, ' ').toLowerCase();
    alerts.push({
      id: `${trade.id}_session_${session}`,
      trade_id: trade.id,
      symbol,
      type: 'DANGEROUS_SESSION',
      severity: pair.symbol === 'XAU/USD' ? 'warning' : 'info',
      title: `${pair.display_name} in low-liquidity session (${sessionDesc})`,
      message: pair.symbol === 'XAU/USD'
        ? `Gold is prone to violent spikes during ${sessionDesc} when liquidity is thin. Stops can get hunted. Consider tightening your SL or closing if you're not actively watching.`
        : `${pair.display_name} liquidity is reduced in ${sessionDesc}. Wider spreads, more whipsaws possible.`,
      suggested_action: 'TIGHTEN_SL_OR_MONITOR',
      current_price: currentPrice,
      current_pnl: pnl,
    });
  }

  // ─── ALERT 5: VOLATILITY_SPIKE ──────────────────────────────────────────
  const volMult = ctx.volMap[symbol];
  if (volMult && volMult >= 2.5) {
    alerts.push({
      id: `${trade.id}_volspike`,
      trade_id: trade.id,
      symbol,
      type: 'VOLATILITY_SPIKE',
      severity: 'critical',
      title: `${pair.display_name} volatility spike — ${volMult.toFixed(1)}× normal`,
      message: `The last 15min candle's range is ${volMult.toFixed(1)} times the recent average. Something is happening. Check news, tighten SL, or close if you don't know why.`,
      suggested_action: 'TIGHTEN_SL_OR_CLOSE',
      current_price: currentPrice,
      current_pnl: pnl,
    });
  }

  // ─── ALERT 6: HIGH_NEWS_INCOMING ────────────────────────────────────────
  const upcomingHighNews = (ctx.news || []).filter(n => {
    if (n.impact !== 'HIGH') return false;
    if (!pair.news_currencies.includes(n.currency)) return false;
    const minsAway = (new Date(n.date).getTime() - Date.now()) / 60000;
    return minsAway > 0 && minsAway <= 30;
  });
  if (upcomingHighNews.length > 0) {
    const n = upcomingHighNews[0];
    const minsAway = Math.round((new Date(n.date).getTime() - Date.now()) / 60000);
    alerts.push({
      id: `${trade.id}_news_${n.id || n.title}`,
      trade_id: trade.id,
      symbol,
      type: 'HIGH_NEWS_INCOMING',
      severity: 'warning',
      title: `${n.currency} news in ${minsAway} min — affects ${pair.display_name}`,
      message: `${n.title}. Volatility spike very likely. Consider closing or moving SL to break-even before the release.`,
      suggested_action: 'PROTECT_BEFORE_NEWS',
      suggested_sl: parseFloat(trade.entry_price),
      current_price: currentPrice,
      current_pnl: pnl,
    });
  }

  return alerts;
}

// ─── Shared context builder ──────────────────────────────────────────────────
// Fetches candles + volatility + news once per unique symbol so we don't
// hammer the price API per-trade.
async function buildContext(symbols) {
  const candleMap = {};
  const volMap = {};

  await Promise.all(symbols.map(async sym => {
    try {
      const c = await priceService.fetchHistoricalData('15min', 25, sym);
      candleMap[sym] = c || [];
    } catch { candleMap[sym] = []; }
  }));

  await Promise.all(symbols.map(async sym => {
    volMap[sym] = await currentVolatilityMultiplier(sym).catch(() => 1);
  }));

  let news = [];
  try { news = await newsService.fetchNews(); } catch {}

  return { sessionLabel: currentSessionLabel(), candleMap, volMap, news };
}

async function fetchOpenTrades(userId) {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'open');
  if (error || !data) return [];
  return data;
}

// Users that currently have at least one open trade (used by the Telegram monitor).
async function listUsersWithOpenTrades() {
  const { data, error } = await supabase.from('trades').select('user_id').eq('status', 'open');
  if (error || !data) return [];
  return Array.from(new Set(data.map(r => r.user_id).filter(Boolean)));
}

// ─── Flat alerts list (for the floating panel) ───────────────────────────────
async function analyseOpenTrades(userId) {
  const openTrades = await fetchOpenTrades(userId);
  if (openTrades.length === 0) return [];

  const symbols = Array.from(new Set(openTrades.map(t => t.pair)));
  const ctx = await buildContext(symbols);

  const allAlerts = [];
  for (const trade of openTrades) {
    const tradeAlerts = await alertsForTrade(trade, ctx);
    for (const a of tradeAlerts) allAlerts.push(a);
  }
  return allAlerts;
}

// ─── Rich monitor snapshot (for the Monitor page) ────────────────────────────
// Returns every open trade enriched with its LIVE state — current price,
// unrealized P&L, peak P&L, progress to TP1, whether SL is at break-even —
// plus the alerts attached to it. This is what the user goes to in order
// to SEE that their trades are being watched, even when nothing is wrong.
async function getMonitorSnapshot(userId) {
  const openTrades = await fetchOpenTrades(userId);
  if (openTrades.length === 0) {
    return { trades: [], session: currentSessionLabel(), timestamp: new Date().toISOString() };
  }

  const symbols = Array.from(new Set(openTrades.map(t => t.pair)));
  const ctx = await buildContext(symbols);

  const trades = [];
  for (const trade of openTrades) {
    const pair = getPair(trade.pair);
    const candles = ctx.candleMap[trade.pair];
    const currentPrice = (candles && candles.length > 0)
      ? candles[candles.length - 1].close
      : null;

    const pnl = currentPrice != null ? unrealizedPnL(trade, currentPrice) : null;
    // Peak: read current stored peak, and update it with the live pnl so the
    // snapshot reflects the high-water mark.
    let peak = getPeakProfit(trade.id);
    if (pnl != null) peak = updatePeakProfit(trade.id, pnl);
    const progress = currentPrice != null ? progressToTP1(trade, currentPrice) : null;
    const slAtBE = isSLAtBreakevenOrBetter(trade);
    const alerts = await alertsForTrade(trade, ctx);

    trades.push({
      id: trade.id,
      symbol: trade.pair,
      display_name: pair ? pair.display_name : trade.pair,
      direction: trade.direction,
      entry_price: parseFloat(trade.entry_price),
      stop_loss: trade.stop_loss != null ? parseFloat(trade.stop_loss) : null,
      take_profit_1: trade.take_profit_1 != null ? parseFloat(trade.take_profit_1)
        : trade.take_profit != null ? parseFloat(trade.take_profit) : null,
      lot_size: parseFloat(trade.lot_size),
      opened_at: trade.opened_at,
      current_price: currentPrice,
      unrealized_pnl: pnl,
      peak_pnl: peak,
      progress_to_tp1: progress != null ? Math.round(progress) : null,
      sl_at_breakeven: slAtBE,
      session: ctx.sessionLabel,
      alerts,
      // Highest alert severity for this trade (for the row badge/colour)
      worst_severity: alerts.reduce((worst, a) => {
        const rank = { info: 1, warning: 2, critical: 3 };
        return rank[a.severity] > rank[worst] ? a.severity : worst;
      }, 'none'),
    });
  }

  // Sort: trades with the worst alerts first.
  const sevRank = { critical: 3, warning: 2, info: 1, none: 0 };
  trades.sort((a, b) => sevRank[b.worst_severity] - sevRank[a.worst_severity]);

  return { trades, session: currentSessionLabel(), timestamp: new Date().toISOString() };
}

module.exports = {
  analyseOpenTrades,
  listUsersWithOpenTrades,
  getMonitorSnapshot,
  resetPeak,
  unrealizedPnL,
  progressToTP1,
  isSLAtBreakevenOrBetter,
};
