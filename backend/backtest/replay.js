// ─── Trade replay ────────────────────────────────────────────────────────────
// Steps through H1 candles. After each candle closes, ask the engine for a
// signal. A signal is entered at that candle's close (exactly the price the live
// engine uses) and followed forward with the same rules as live scoring:
//
//   * candle touches both stop and target -> counted as a LOSS (stop first)
//   * higher target wins when both targets are touched without the stop
//   * nothing hit within 24 hours -> closed at market (live marks it EXPIRED and
//     ignores it; the backtest counts it, which is the honest thing to do)
//
// One trade at a time per pair, because that is how a small account trades.
// R = result in units of risk (1R = entry-to-stop distance), after the spread.
// Wins are valued at TP1 (conservative: assumes you close at TP1).

const EXPIRE_BARS = 24;

function resolveTrade(sig, h1, i, expireBars = EXPIRE_BARS) {
  const last = Math.min(i + expireBars, h1.length - 1);
  for (let j = i + 1; j <= last; j++) {
    const c = h1[j];
    const buy = sig.direction === 'BUY';
    const slHit = buy ? c.low <= sig.stop_loss : c.high >= sig.stop_loss;
    const tp1Hit = buy ? c.high >= sig.take_profit_1 : c.low <= sig.take_profit_1;
    const tp2Hit = buy ? c.high >= sig.take_profit_2 : c.low <= sig.take_profit_2;
    if (slHit) return { outcome: 'LOSS', exitPrice: sig.stop_loss, exitIndex: j };
    if (tp2Hit) return { outcome: 'WIN_TP2', exitPrice: sig.take_profit_1, exitIndex: j }; // valued at TP1
    if (tp1Hit) return { outcome: 'WIN_TP1', exitPrice: sig.take_profit_1, exitIndex: j };
  }
  if (last - i >= expireBars) return { outcome: 'TIMEOUT', exitPrice: h1[last].close, exitIndex: last };
  return null; // history ended before the trade resolved
}

function resultInR(sig, exitPrice, spreadPrice) {
  const risk = Math.abs(sig.entry - sig.stop_loss);
  if (!(risk > 0)) return null;
  const dir = sig.direction === 'BUY' ? 1 : -1;
  return (dir * (exitPrice - sig.entry) - spreadPrice) / risk;
}

async function runReplay({ symbol, h1, harness, pair, warmup = 300, endIndex = null, expireBars = EXPIRE_BARS, onProgress = null }) {
  const spreadPrice = (pair.typical_spread || 0) * pair.pip_size;
  const trades = [];
  let busyUntil = -1;
  let emitted = 0;
  const stop = endIndex == null ? h1.length - 1 : Math.min(endIndex, h1.length - 1);

  harness.load(symbol, h1);
  for (let i = warmup; i < stop; i++) {
    if (onProgress && i % 250 === 0) onProgress(i, stop);
    if (i <= busyUntil) continue; // already in a trade
    harness.at(i);
    let sig = null;
    try { sig = await harness.generateSignal(symbol); } catch { sig = null; }
    if (!sig || sig.direction === 'NEUTRAL' || sig.stop_loss == null || sig.take_profit_1 == null) continue;
    emitted++;
    const res = resolveTrade(sig, h1, i, expireBars);
    if (!res) break;
    const r = resultInR(sig, res.exitPrice, spreadPrice);
    if (r === null) continue;
    trades.push({
      symbol, time: h1[i].time + 3600, direction: sig.direction, confidence: sig.confidence,
      session: sig.session || 'UNKNOWN',
      strategy: (sig.fired_strategy && sig.fired_strategy.name) || 'Indicators only',
      regime: sig.market_condition || 'UNKNOWN',
      outcome: res.outcome, r, bars: res.exitIndex - i,
    });
    busyUntil = res.exitIndex;
  }
  return { trades, emitted };
}

module.exports = { runReplay, resolveTrade, resultInR, EXPIRE_BARS };
