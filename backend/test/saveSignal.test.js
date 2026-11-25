const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase, stubModule, freshRequire } = require('./helpers');

const fake = makeFakeSupabase();
stubModule('../db/supabase', fake);
let candles = [];
stubModule('../services/priceService', { fetchHistoricalData: async () => candles });

let history = freshRequire('../services/signalHistoryService');
const sig = (over = {}) => ({
  symbol: 'XAU/USD', direction: 'BUY', entry: 2000, stop_loss: 1990, take_profit_1: 2015,
  take_profit_2: 2030, confidence: 72, strategy: 'x', fired_strategy: { name: 'S' },
  market_condition: 'TRENDING', timeframe: 'H1', risk_reward: '1:1.5',
  indicators_agreeing: 5, total_indicators: 12, ...over,
});
const reset = () => { fake.tables.signals.length = 0; fake.tables.shadow_signals.length = 0; history = freshRequire('../services/signalHistoryService'); };

test('same setup saved twice in one hour is stored once', async () => {
  reset();
  assert.ok(await history.saveSignal(sig()));
  assert.equal(await history.saveSignal(sig()), null);
  assert.equal(fake.tables.signals.length, 1);
});

test('concurrent calls (cron + API route) store exactly one row', async () => {
  reset();
  await Promise.all(Array.from({ length: 6 }, () => history.saveSignal(sig())));
  assert.equal(fake.tables.signals.length, 1);
});

test('different direction or pair is stored separately', async () => {
  reset();
  await history.saveSignal(sig());
  await history.saveSignal(sig({ direction: 'SELL' }));
  await history.saveSignal(sig({ symbol: 'EUR/USD' }));
  assert.equal(fake.tables.signals.length, 3);
});

test('dedupe survives a server restart (database check)', async () => {
  reset();
  await history.saveSignal(sig());
  history = freshRequire('../services/signalHistoryService'); // memory guard wiped
  assert.equal(await history.saveSignal(sig()), null);
  assert.equal(fake.tables.signals.length, 1);
});

test('NEUTRAL is never saved', async () => {
  reset();
  assert.equal(await history.saveSignal(sig({ direction: 'NEUTRAL' })), null);
  assert.equal(fake.tables.signals.length, 0);
});

test('shadow signals go to their own table and do not block real ones', async () => {
  reset();
  assert.ok(await history.saveSignal(sig(), { shadow: true }));
  assert.equal(fake.tables.shadow_signals.length, 1);
  assert.equal(fake.tables.signals.length, 0);
  assert.ok(await history.saveSignal(sig()));       // real signal, same hour, still saved
  assert.equal(fake.tables.signals.length, 1);
  assert.equal(await history.saveSignal(sig(), { shadow: true }), null); // shadow deduped too
});

test('missing shadow_signals table fails softly and can retry', async () => {
  reset();
  const saved = fake.tables.shadow_signals;
  delete fake.tables.shadow_signals;
  assert.equal(await history.saveSignal(sig(), { shadow: true }), null); // no throw
  fake.tables.shadow_signals = saved;                                    // migration "run"
  assert.ok(await history.saveSignal(sig(), { shadow: true }));          // retry works
});

test('evaluateOpenSignals settles shadow signals (this is what lets a band recover)', async () => {
  reset();
  const created = new Date(Date.now() - 3 * 3600000);
  fake.tables.shadow_signals.push({ id: 'sh1', symbol: 'XAU/USD', direction: 'BUY', entry: 2000,
    stop_loss: 1990, take_profit_1: 2015, take_profit_2: 2030, confidence: 72, outcome: null,
    created_at: created.toISOString() });
  fake.tables.signals.push({ id: 'rl1', symbol: 'XAU/USD', direction: 'SELL', entry: 2000,
    stop_loss: 2010, take_profit_1: 1985, take_profit_2: 1970, confidence: 72, outcome: null,
    created_at: created.toISOString() });
  const t = Math.floor(created.getTime() / 1000) + 900;
  candles = [{ time: t, open: 2000, high: 2016, low: 1999, close: 2014 }]; // TP1 of the BUY, SL of the SELL
  await history.evaluateOpenSignals();
  assert.equal(fake.tables.shadow_signals[0].outcome, 'WIN_TP1');
  assert.equal(fake.tables.signals[0].outcome, 'LOSS');
});

test('stats ignore duplicate rows', async () => {
  reset();
  const base = Date.now() - 5 * 3600000;
  for (let m = 0; m < 4; m++) // one setup stored 4 times in the same hour
    fake.tables.signals.push({ id: `d${m}`, symbol: 'XAU/USD', direction: 'BUY', confidence: 70,
      outcome: 'WIN_TP1', created_at: new Date(base + m * 60000).toISOString() });
  fake.tables.signals.push({ id: 'o1', symbol: 'XAU/USD', direction: 'BUY', confidence: 70,
    outcome: 'LOSS', created_at: new Date(base + 2 * 3600000).toISOString() });
  const stats = await history.getSignalStats();
  assert.equal(stats.total, 2);
  assert.equal(stats.win_rate, 50);
});
