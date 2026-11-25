const test = require('node:test');
const assert = require('node:assert/strict');

const RealDate = Date;
const harness = require('../backtest/harness').install(); // stubs first, then the real engine loads
const priceService = require('../services/priceService');
const { aggregate, closedBuckets, H1 } = require('../backtest/data');
const { runReplay, resolveTrade, resultInR } = require('../backtest/replay');
const stats = require('../backtest/stats');
const { getPair } = require('../config/pairs');

// ---- synthetic candles: deterministic random walk, weekends skipped
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeCandles(n, seed = 1, start = 1.1, vol = 0.0006) {
  const r = rng(seed), out = [];
  let t = RealDate.parse('2026-01-05T00:00:00Z') / 1000, px = start, drift = 0;
  while (out.length < n) {
    const d = new RealDate(t * 1000), wd = d.getUTCDay(), h = d.getUTCHours();
    const closed = wd === 6 || (wd === 5 && h >= 22) || (wd === 0 && h < 22);
    if (!closed) {
      if (out.length % 60 === 0) drift = (r() - 0.5) * 0.0004;
      const o = px, c = px + drift + (r() - 0.5) * vol * 2;
      out.push({ time: t, open: o, high: Math.max(o, c) + r() * vol * 0.6, low: Math.min(o, c) - r() * vol * 0.6, close: c, volume: 100 });
      px = c;
    }
    t += H1;
  }
  return out;
}
const candle = (time, o, h, l, c) => ({ time, open: o, high: h, low: l, close: c, volume: 1 });

// ---- aggregation / no-lookahead data access
test('H4 and daily candles are built correctly and only released once closed', () => {
  const t0 = RealDate.parse('2026-03-02T00:00:00Z') / 1000; // Monday 00:00
  const h1 = Array.from({ length: 30 }, (_, i) => candle(t0 + i * H1, 100 + i, 101 + i, 99 + i, 100.5 + i));
  const h4 = aggregate(h1, 4 * H1);
  assert.equal(h4[0].open, 100); assert.equal(h4[0].high, 104); assert.equal(h4[0].low, 99); assert.equal(h4[0].close, 103.5);
  assert.equal(closedBuckets(h4, 4 * H1, t0 + 3 * H1, 10).length, 0);         // first H4 not closed at 03:00
  assert.equal(closedBuckets(h4, 4 * H1, t0 + 4 * H1, 10).length, 1);         // closed exactly at 04:00
  assert.equal(closedBuckets(h4, 4 * H1, t0 + 13 * H1, 2).length, 2);         // count limit
  const d1 = aggregate(h1, 24 * H1);
  assert.equal(closedBuckets(d1, 24 * H1, t0 + 23 * H1, 5).length, 0);
  assert.equal(closedBuckets(d1, 24 * H1, t0 + 24 * H1, 5).length, 1);
});

test('virtual clock: the engine sees the moment the candle closed, and real dates still work', () => {
  const h1 = makeCandles(400);
  harness.load('EUR/USD', h1); harness.at(350);
  const closeMs = (h1[350].time + H1 + 5) * 1000;
  assert.equal(Date.now(), closeMs);
  assert.equal(new Date().getTime(), closeMs);
  assert.equal(new Date('2026-01-01T00:00:00Z').getUTCFullYear(), 2026); // explicit dates unaffected
  assert.equal(new Date(2020, 5, 1).getFullYear(), 2020);
});

test('the engine can only ever see candles that had closed (no look-ahead)', async () => {
  const h1 = makeCandles(420);
  const violations = [];
  const spy = async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const hr = new Date().getUTCHours();
    const h = await priceService.fetchHistoricalData('1h', 300);
    const h4 = await priceService.fetchHistoricalData('4h', 100);
    const d = await priceService.fetchHistoricalData('1day', 5);
    const m15 = await priceService.fetchHistoricalData('15min', 200);
    if (h[h.length - 1].time + H1 > nowSec) violations.push('H1 not closed');
    if (new RealDate((h[h.length - 1].time + H1) * 1000).getUTCHours() !== hr) violations.push('clock hour mismatch');
    if (h4.length && h4[h4.length - 1].time + 4 * H1 > nowSec) violations.push('H4 not closed');
    if (d.length && d[d.length - 1].time + 24 * H1 > nowSec) violations.push('D1 not closed');
    if (m15.length !== 0) violations.push('M15 should be unavailable');
    return null;
  };
  await runReplay({ symbol: 'EUR/USD', h1, harness: { ...harness, generateSignal: spy }, pair: getPair('EUR/USD'), endIndex: 360 });
  assert.deepEqual(violations, []);
});

test('REAL engine: a decision never changes when the future candles change', async () => {
  const h1 = makeCandles(620, 3);
  for (const i of [330, 400, 470, 540]) {
    harness.load('EUR/USD', h1); harness.at(i);
    const a = await harness.generateSignal('EUR/USD');
    const future = makeCandles(620, 99, 1.4, 0.003); // wildly different future
    const h1b = h1.slice(0, i + 1).concat(future.slice(i + 1).map((c, k) => ({ ...c, time: h1[i].time + (k + 1) * H1 })));
    harness.load('EUR/USD', h1b); harness.at(i);
    const b = await harness.generateSignal('EUR/USD');
    const key = (s) => JSON.stringify([s.direction, s.entry, s.stop_loss, s.take_profit_1, s.take_profit_2, s.confidence, s.session, s.market_condition]);
    assert.equal(key(a), key(b), `decision changed at bar ${i}`);
  }
});

test('REAL engine replay runs end to end and never touches the database', async () => {
  const h1 = makeCandles(700, 5);
  const { trades, emitted } = await runReplay({ symbol: 'EUR/USD', h1, harness, pair: getPair('EUR/USD'), endIndex: 640 });
  assert.ok(emitted >= trades.length);
  for (const t of trades) {
    assert.ok(['BUY', 'SELL'].includes(t.direction));
    assert.ok(Number.isFinite(t.r) && t.bars >= 1 && t.session && t.strategy);
  }
  assert.equal(harness.dbCalls(), 0);
});

// ---- trade rules (same as live scoring)
const sigBuy = { direction: 'BUY', entry: 100, stop_loss: 98, take_profit_1: 103, take_profit_2: 106 };
const sigSell = { direction: 'SELL', entry: 100, stop_loss: 102, take_profit_1: 97, take_profit_2: 94 };
const series = (...hl) => hl.map(([h, l], i) => candle(1000 + i * H1, 100, h, l, 100));

test('stop hit first -> LOSS; target hit -> WIN valued at TP1', () => {
  assert.equal(resolveTrade(sigBuy, series([100, 100], [101, 97.5]), 0).outcome, 'LOSS');
  const w = resolveTrade(sigBuy, series([100, 100], [103.5, 99.5]), 0);
  assert.equal(w.outcome, 'WIN_TP1'); assert.equal(w.exitPrice, 103);
  assert.equal(resolveTrade(sigSell, series([100, 100], [100.5, 96.5]), 0).outcome, 'WIN_TP1');
  assert.equal(resolveTrade(sigSell, series([100, 100], [102.5, 99]), 0).outcome, 'LOSS');
});

test('candle touching both stop and target counts as a LOSS', () => {
  assert.equal(resolveTrade(sigBuy, series([100, 100], [104, 97]), 0).outcome, 'LOSS');
  assert.equal(resolveTrade(sigSell, series([100, 100], [103, 96]), 0).outcome, 'LOSS');
});

test('TP2 in one candle is still valued at TP1; timeout closes at market; unfinished history is dropped', () => {
  const tp2 = resolveTrade(sigBuy, series([100, 100], [107, 99.5]), 0);
  assert.equal(tp2.outcome, 'WIN_TP2'); assert.equal(tp2.exitPrice, 103);
  const flat = Array.from({ length: 30 }, (_, i) => candle(1000 + i * H1, 100, 100.5, 99.5, 100.2));
  const to = resolveTrade(sigBuy, flat, 0, 24);
  assert.equal(to.outcome, 'TIMEOUT'); assert.equal(to.exitIndex, 24); assert.equal(to.exitPrice, 100.2);
  assert.equal(resolveTrade(sigBuy, flat.slice(0, 10), 0, 24), null);
});

test('R is measured in risk units after the spread', () => {
  assert.ok(Math.abs(resultInR(sigBuy, 103, 0) - 1.5) < 1e-9);
  assert.ok(Math.abs(resultInR(sigBuy, 98, 0) + 1) < 1e-9);
  assert.ok(Math.abs(resultInR(sigBuy, 103, 0.2) - 1.4) < 1e-9);     // spread of 0.2 on a risk of 2
  assert.ok(Math.abs(resultInR(sigSell, 97, 0) - 1.5) < 1e-9);
  assert.ok(Math.abs(resultInR(sigBuy, 100.5, 0) - 0.25) < 1e-9);    // timeout in profit
});

test('replay: one trade at a time, entry at the close, results follow the rules', async () => {
  const h1 = makeCandles(420, 8);
  const entryOf = (i) => h1[i].close;
  const emitAt = new Map([[310, 'BUY'], [311, 'BUY'], [330, 'SELL']]); // 311 happens while 310 may still be open
  const decide = async () => {
    const i = Math.round((Date.now() - 5000) / 1000 / 1 - h1[0].time) ; void i;
    const idx = h1.findIndex((c) => (c.time + H1) * 1000 + 5000 === Date.now());
    const dir = emitAt.get(idx);
    if (!dir) return { direction: 'NEUTRAL' };
    const e = entryOf(idx), buy = dir === 'BUY';
    return { direction: dir, entry: e, stop_loss: buy ? e - 0.0010 : e + 0.0010, take_profit_1: buy ? e + 0.0015 : e - 0.0015,
      take_profit_2: buy ? e + 0.0030 : e - 0.0030, confidence: 70, session: 'LONDON', fired_strategy: { name: 'Test' }, market_condition: 'TRENDING' };
  };
  const { trades, emitted } = await runReplay({ symbol: 'EUR/USD', h1, harness: { ...harness, generateSignal: decide }, pair: getPair('EUR/USD'), endIndex: 400 });
  assert.ok(trades.length >= 1);
  assert.equal(emitted, trades.length);
  const t310 = trades.find((t) => t.time === h1[310].time + H1);
  assert.ok(t310, 'trade from bar 310 recorded with the close time of its candle');
  const sixths = trades.map((t) => t.bars);
  assert.ok(sixths.every((b) => b >= 1 && b <= 24));
  // bar 311 is skipped when 310 is still open (one trade at a time)
  if (t310.bars >= 1) assert.equal(trades.some((t) => t.time === h1[311].time + H1), false);
});

// ---- statistics
const mk = (r, extra = {}) => ({ symbol: 'EUR/USD', time: extra.time || 0, direction: 'BUY', confidence: 70, session: 'LONDON',
  strategy: 'S', outcome: r > 0 ? 'WIN_TP1' : 'LOSS', r, ...extra });

test('summarize: win rate, average R, total, profit factor, drawdown', () => {
  const t = [mk(1.5, { time: 1 }), mk(-1, { time: 2 }), mk(-1, { time: 3 }), mk(1.5, { time: 4 })];
  const s = stats.summarize(t);
  assert.equal(s.n, 4); assert.equal(s.winRate, 0.5);
  assert.ok(Math.abs(s.avgR - 0.25) < 1e-9 && Math.abs(s.totalR - 1) < 1e-9);
  assert.ok(Math.abs(s.pf - 1.5) < 1e-9);
  assert.ok(Math.abs(s.maxDD - 2) < 1e-9);
});

test('verdicts: few trades unproven; steady edge promising; clear loser losing; early luck not promising', () => {
  const steady = Array.from({ length: 60 }, (_, i) => mk(i % 5 < 3 ? 1.5 : -1, { time: i }));    // 60% wins at 1.5R: clearly positive
  assert.equal(stats.verdict(steady), 'PROMISING');
  const few = Array.from({ length: 12 }, (_, i) => mk(1.5, { time: i }));
  assert.match(stats.verdict(few), /UNPROVEN/);
  const loser = Array.from({ length: 60 }, (_, i) => mk(i % 5 === 0 ? 1.5 : -1, { time: i }));   // 20% wins
  assert.equal(stats.verdict(loser), 'LOSING');
  const lucky = [...Array.from({ length: 36 }, (_, i) => mk(i % 4 === 0 ? -1 : 1.5, { time: i })),   // great early
                 ...Array.from({ length: 24 }, (_, i) => mk(i % 2 === 0 ? -1 : 0.5, { time: 100 + i }))]; // poor recently
  assert.notEqual(stats.verdict(lucky), 'PROMISING');
});

test('report lists pairs, sessions and a verdict, and splits for Telegram', () => {
  const trades = Array.from({ length: 40 }, (_, i) => mk(i % 2 ? 1.5 : -1, { time: i, session: i % 4 < 2 ? 'ASIAN' : 'LONDON' }));
  const { text, json } = stats.buildReport({ perSymbol: { 'EUR/USD': { trades, emitted: 55, from: 1.7e9, to: 1.71e9 } }, months: 9 });
  for (const s of ['BACKTEST of your live signal engine', 'BY PAIR', 'EUR/USD: 40 trades', '55 signals fired', 'BY SESSION', 'LIMITS']) assert.ok(text.includes(s), s);
  assert.equal(json.trades.length, 40);
  const parts = stats.chunk('x'.repeat(100) + '\n' + 'y'.repeat(100), 150);
  assert.equal(parts.length, 2);
});

// ---- the two checks that matter most: no phantom edge in noise, and real edge is detected
function makeWalk(n, seed, trending) {
  const r = rng(seed), out = [];
  let t = RealDate.parse('2026-01-05T00:00:00Z') / 1000, px = 1.1, drift = 0;
  while (out.length < n) {
    const d = new RealDate(t * 1000), wd = d.getUTCDay(), h = d.getUTCHours();
    const closed = wd === 6 || (wd === 5 && h >= 22) || (wd === 0 && h < 22);
    if (!closed) {
      if (out.length % 80 === 0) drift = trending ? (r() - 0.5) * 0.0006 * 0.8 : 0;
      const o = px, c = px + drift + (r() - 0.5) * 0.0012;
      out.push({ time: t, open: o, high: Math.max(o, c) + r() * 0.00036, low: Math.min(o, c) - r() * 0.00036, close: c, volume: 100 });
      px = c;
    }
    t += H1;
  }
  return out;
}

async function pooled(trending, seeds) {
  const all = [];
  for (const seed of seeds) {
    const { trades } = await runReplay({ symbol: 'EUR/USD', h1: makeWalk(2200, seed, trending), harness, pair: getPair('EUR/USD') });
    all.push(...trades);
  }
  return all;
}

test('NULL TEST: on pure random data the backtest finds no edge (it must not flatter the engine)', async () => {
  const trades = await pooled(false, [1, 2, 3]);
  const s = stats.summarize(trades);
  assert.ok(s.n > 300, `enough trades (${s.n})`);
  assert.ok(s.avgR < 0.12 && s.avgR > -0.25, `avg R on noise should sit near zero minus spread, got ${s.avgR}`);
  assert.notEqual(stats.verdict(trades), 'PROMISING');
});

test('POWER TEST: when the data really trends, the backtest sees the edge', async () => {
  const trades = await pooled(true, [1, 2, 3]);
  const s = stats.summarize(trades);
  assert.ok(s.avgR > 0.25, `trend-following should profit on trending data, got ${s.avgR}`);
  assert.equal(stats.verdict(trades), 'PROMISING');
});
