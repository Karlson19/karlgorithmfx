// ─── Backtest statistics and report ──────────────────────────────────────────
// The point of the report is to stop us fooling ourselves. A slice of trades
// is only called PROMISING when it clears all of these:
//   * at least 30 trades
//   * average R minus one standard error is above zero (not just luck)
//   * still positive on the most recent 40% of its trades (out-of-sample)
// LOSING means average R plus one standard error is below zero.
// Everything else is UNPROVEN, which is the honest answer for most slices.

const isWin = (t) => t.outcome === 'WIN_TP1' || t.outcome === 'WIN_TP2';
const byTime = (a, b) => a.time - b.time;

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0, wins: 0, winRate: null, avgR: null, se: null, totalR: 0, pf: null, maxDD: 0 };
  const rs = [...trades].sort(byTime).map((t) => t.r);
  const total = rs.reduce((s, x) => s + x, 0);
  const mean = total / n;
  const variance = n > 1 ? rs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const gw = rs.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const gl = -rs.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  let cum = 0, peak = 0, dd = 0;
  for (const x of rs) { cum += x; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return {
    n, wins: trades.filter(isWin).length, winRate: trades.filter(isWin).length / n,
    avgR: mean, se: n > 1 ? Math.sqrt(variance / n) : null, totalR: total,
    pf: gl > 0 ? gw / gl : null, maxDD: dd,
  };
}

function verdict(trades) {
  const all = summarize(trades);
  if (all.n < 30) return 'UNPROVEN (under 30 trades)';
  const sorted = [...trades].sort(byTime);
  const oos = summarize(sorted.slice(Math.floor(sorted.length * 0.6)));
  if (all.avgR - all.se > 0 && oos.n >= 10 && oos.avgR > 0) return 'PROMISING';
  if (all.avgR + all.se < 0) return 'LOSING';
  return 'UNPROVEN';
}

function groupBy(trades, keyFn) {
  const m = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}

const bandOf = (c) => { const lo = Math.floor(c / 5) * 5; return `${lo}-${lo + 4}`; };

const sgn = (x) => (x > 0 ? '+' : '');
function line(name, trades) {
  const s = summarize(trades);
  if (!s.n) return `${name}: no trades`;
  const se = s.se == null ? '' : ` (±${s.se.toFixed(2)})`;
  return `${name}: ${s.n} trades, win ${(s.winRate * 100).toFixed(0)}%, avg ${sgn(s.avgR)}${s.avgR.toFixed(2)}R${se}, ` +
    `total ${sgn(s.totalR)}${s.totalR.toFixed(1)}R, worst drawdown ${s.maxDD.toFixed(1)}R. ${verdict(trades)}`;
}

function buildReport({ perSymbol, months }) {
  const symbols = Object.keys(perSymbol);
  const all = symbols.flatMap((s) => perSymbol[s].trades);
  const dates = symbols.filter((s) => perSymbol[s].from).map((s) => [perSymbol[s].from, perSymbol[s].to]);
  const from = dates.length ? new Date(Math.min(...dates.map((d) => d[0])) * 1000).toISOString().slice(0, 10) : '?';
  const to = dates.length ? new Date(Math.max(...dates.map((d) => d[1])) * 1000).toISOString().slice(0, 10) : '?';

  const out = [];
  out.push(`BACKTEST of your live signal engine (${from} to ${to}, about ${months} months of H1 candles)`);
  out.push('Spread included. One trade at a time per pair. Wins valued at TP1. A candle touching stop and target counts as a loss.');
  out.push('');
  out.push('BY PAIR');
  for (const s of symbols) {
    const p = perSymbol[s];
    out.push(line(s, p.trades) + ` [${p.emitted} signals fired]`);
  }
  out.push(line('ALL PAIRS', all));

  const section = (title, keyFn, minTrades) => {
    const groups = [...groupBy(all, keyFn).entries()].filter(([, v]) => v.length >= minTrades)
      .sort((a, b) => (summarize(b[1]).avgR) - (summarize(a[1]).avgR));
    if (!groups.length) return;
    out.push('');
    out.push(title);
    for (const [k, v] of groups) out.push(line(k, v));
  };
  section('BY SESSION (all pairs)', (t) => t.session, 10);
  section('BY STRATEGY (all pairs, 10+ trades)', (t) => t.strategy, 10);
  section('BY CONFIDENCE BAND (all pairs)', (t) => bandOf(t.confidence), 10);
  section('BY PAIR AND SESSION (10+ trades)', (t) => `${t.symbol} ${t.session}`, 10);

  const slices = [];
  const add = (label, keyFn) => { for (const [k, v] of groupBy(all, keyFn)) slices.push([`${label}: ${k}`, v]); };
  add('pair', (t) => t.symbol); add('session', (t) => t.session); add('strategy', (t) => t.strategy);
  add('band', (t) => bandOf(t.confidence)); add('pair+session', (t) => `${t.symbol} ${t.session}`);
  const promising = slices.filter(([, v]) => verdict(v) === 'PROMISING').map(([k]) => k);
  const losing = slices.filter(([, v]) => verdict(v) === 'LOSING').map(([k]) => k);
  out.push('');
  out.push(promising.length ? `PROMISING (30+ trades, edge beyond luck, still positive on recent data):\n- ${promising.join('\n- ')}`
    : 'PROMISING: none. No slice has yet shown an edge that survives spread and a luck check.');
  if (losing.length) out.push(`\nLOSING (30+ trades, clearly negative after spread):\n- ${losing.join('\n- ')}`);

  out.push('');
  out.push('LIMITS: no historical news (live blocks trades around news, so live should be slightly safer); the 15-minute bias is off (small confidence boost missing); H4 and daily candles are built from H1; trades are followed on H1 candles with stop-first on ties. Past results do not promise future profit.');

  const json = {
    generated_at: new Date().toISOString(), months,
    pairs: Object.fromEntries(symbols.map((s) => [s, { ...summarize(perSymbol[s].trades), signals_fired: perSymbol[s].emitted }])),
    promising, losing,
    trades: all,
  };
  return { text: out.join('\n'), json };
}

// Telegram messages are limited to 4096 characters; split on line breaks.
function chunk(text, size = 3800) {
  const parts = [];
  let cur = '';
  for (const l of text.split('\n')) {
    if ((cur + '\n' + l).length > size) { parts.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l;
  }
  if (cur) parts.push(cur);
  return parts;
}

module.exports = { summarize, verdict, groupBy, bandOf, line, buildReport, chunk, isWin };
