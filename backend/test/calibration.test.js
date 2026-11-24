const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase, stubModule } = require('./helpers');

const fake = makeFakeSupabase();
stubModule('../db/supabase', fake);
const { dedupeSignals } = require('../utils/dedupe');
const cal = require('../services/calibrationService');
const { getPair } = require('../config/pairs');

const T0 = Date.parse('2026-11-02T00:00:00Z');
const hr = (i) => new Date(T0 + i * 3600000).toISOString();

// EUR/USD BUY, risk 15 pips. `tpPips` sets how far TP1 is.
function row({ i, outcome, tpPips = 22.5, conf = 70, dir = 'BUY', symbol = 'EUR/USD', minute = 0 }) {
  const entry = 1.1, pip = 0.0001;
  const s = dir === 'BUY' ? -1 : 1, t = dir === 'BUY' ? 1 : -1;
  return {
    symbol, direction: dir, confidence: conf, outcome,
    entry, stop_loss: +(entry + s * 15 * pip).toFixed(5),
    take_profit_1: +(entry + t * tpPips * pip).toFixed(5),
    created_at: new Date(T0 + i * 3600000 + minute * 60000).toISOString(),
  };
}

test('dedupe: same symbol/direction/hour collapses to the earliest', () => {
  const rows = [
    row({ i: 5, outcome: 'LOSS', minute: 30 }),
    row({ i: 5, outcome: 'WIN_TP1', minute: 0 }),   // earliest in that hour
    row({ i: 5, outcome: 'LOSS', minute: 45 }),
    row({ i: 6, outcome: 'LOSS' }),                  // next hour: kept
    row({ i: 5, outcome: 'LOSS', dir: 'SELL' }),     // other direction: kept
    row({ i: 5, outcome: 'LOSS', symbol: 'GBP/USD' }), // other pair: kept
    { outcome: 'LOSS', confidence: 70 },             // legacy, unkeyable: kept
  ];
  const out = dedupeSignals(rows);
  assert.equal(out.length, 5);
  const hour5Buy = out.find(r => r.symbol === 'EUR/USD' && r.direction === 'BUY' && r.created_at === hr(5));
  assert.equal(hour5Buy.outcome, 'WIN_TP1');
});

test('resultInR: values wins at TP1 and losses at -1R, net of spread', () => {
  const pair = getPair('EUR/USD');
  const spreadR = (pair.typical_spread * pair.pip_size) / (15 * 0.0001);
  assert.ok(Math.abs(cal.resultInR(row({ i: 0, outcome: 'WIN_TP1' })) - (1.5 - spreadR)) < 1e-6);
  assert.ok(Math.abs(cal.resultInR(row({ i: 0, outcome: 'WIN_TP2' })) - (1.5 - spreadR)) < 1e-6); // TP2 still valued at TP1
  assert.ok(Math.abs(cal.resultInR(row({ i: 0, outcome: 'LOSS' })) - (-1 - spreadR)) < 1e-6);
  // SELL mirrors BUY
  assert.ok(Math.abs(cal.resultInR(row({ i: 0, outcome: 'WIN_TP1', dir: 'SELL' })) - (1.5 - spreadR)) < 1e-6);
  assert.equal(cal.resultInR(row({ i: 0, outcome: 'EXPIRED' })), null);
  assert.equal(cal.resultInR({ outcome: 'WIN_TP1', entry: 1.1 }), null); // missing levels
});

function bandCell(rows) {
  const table = cal.buildTable(rows);
  return table['EUR/USD'][70];
}
const series = (n, winEvery, opts) =>
  Array.from({ length: n }, (_, i) => row({ i, outcome: (i % winEvery === 0) ? 'WIN_TP1' : 'LOSS', ...opts }));

test('a profitable band (positive conservative edge) passes the gate', () => {
  // 20 wins / 10 losses at 1.5R: clearly profitable
  const rows = Array.from({ length: 30 }, (_, i) => row({ i, outcome: i % 3 === 0 ? 'LOSS' : 'WIN_TP1' }));
  const c = bandCell(rows);
  assert.equal(c.total, 30);
  assert.equal(c.calibrated, true);
  assert.ok(c.lower_r > 0);
  assert.equal(cal.passesGate({ ...c }), true);
});

test('high win rate with tiny wins does NOT pass (win rate alone misleads)', () => {
  // 60% win rate but TP1 only 5 pips away vs a 15 pip stop
  const rows = Array.from({ length: 40 }, (_, i) =>
    row({ i, outcome: (i % 5 < 3) ? 'WIN_TP1' : 'LOSS', tpPips: 5 }));
  const c = bandCell(rows);
  assert.equal(c.win_rate, 60);
  assert.ok(c.avg_r < 0);
  assert.equal(cal.passesGate(c), false);
});

test('a lucky small sample is not calibrated', () => {
  const c = bandCell(series(29, 1, {})); // 29 straight wins, still below MIN_SAMPLES
  assert.equal(c.calibrated, false);
  assert.equal(cal.passesGate(c), false);
});

test('duplicates cannot inflate the sample size', () => {
  // 40 rows, all the same hour/direction = one real trade
  const rows = Array.from({ length: 40 }, (_, i) => row({ i: 3, outcome: 'WIN_TP1', minute: i }));
  const c = bandCell(rows);
  assert.equal(c.total, 1);
  assert.equal(c.calibrated, false);
});

test('passesGate edge cases', () => {
  assert.equal(cal.passesGate(null), false);
  assert.equal(cal.passesGate({ calibrated: true, lower_r: null }), false);
  assert.equal(cal.passesGate({ calibrated: true, lower_r: 0 }), false);
  assert.equal(cal.passesGate({ calibrated: true, lower_r: 0.01 }), true);
});

test('shadow_signals rows count toward calibration', async () => {
  fake.tables.signals.length = 0; fake.tables.shadow_signals.length = 0;
  for (let i = 0; i < 20; i++) fake.tables.signals.push({ ...row({ i, outcome: 'WIN_TP1' }), id: `r${i}` });
  for (let i = 20; i < 35; i++) fake.tables.shadow_signals.push({ ...row({ i, outcome: 'WIN_TP1' }), id: `s${i}` });
  const table = await cal.refreshCalibration();
  assert.equal(table['EUR/USD'][70].total, 35);
  const look = await cal.lookup('EUR/USD', 72);
  assert.equal(look.calibrated, true);
  assert.equal(look.sample_size, 35);
  assert.ok('avg_r' in look && 'lower_r' in look && 'win_rate' in look);
});
