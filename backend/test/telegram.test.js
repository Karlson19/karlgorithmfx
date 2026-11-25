const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase, stubModule, freshRequire } = require('./helpers');

const TOKEN = '123456:SECRET-TOKEN-VALUE';
const posts = [];
let failNext = false;
stubModule('axios', {
  post: async (url, body) => {
    if (failNext) {
      const err = new Error('boom');
      err.config = { url }; // real axios errors carry the URL, which contains the token
      err.response = { status: 401, data: { description: 'Unauthorized' } };
      throw err;
    }
    posts.push({ url, body });
    return { data: { ok: true } };
  },
});
const fake = makeFakeSupabase();
stubModule('../db/supabase', fake);
let candles = [];
stubModule('../services/priceService', { fetchHistoricalData: async () => candles });

const tg = freshRequire('../services/telegramService');
const setEnv = (on, extra = {}) => {
  for (const k of ['TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_MIN_CONFIDENCE', 'TELEGRAM_OUTCOMES', 'TELEGRAM_STARTUP_MESSAGE']) delete process.env[k];
  if (on) { process.env.TELEGRAM_TOKEN = TOKEN; process.env.TELEGRAM_CHAT_ID = '1465501848'; }
  Object.assign(process.env, extra);
  posts.length = 0; failNext = false;
};

const signal = (o = {}) => ({
  symbol: 'XAU/USD', display_name: 'Gold', direction: 'SELL', entry: 3525.21, stop_loss: 3539.86,
  take_profit_1: 3483.99, take_profit_2: 3442.77, confidence: 67, risk_reward: '1:2.8', timeframe: 'H1',
  session: 'ASIAN', strategy: 'Trending + Ichimoku', calibration: { calibrated: false, sample_size: 5 }, ...o,
});

test('does nothing without token and chat id', async () => {
  setEnv(false);
  assert.equal(await tg.notifySignal(signal()), false);
  assert.equal(await tg.sendMessage('x'), false);
  assert.equal(posts.length, 0);
});

test('sends a readable signal message to the right chat', async () => {
  setEnv(true);
  assert.equal(await tg.notifySignal(signal()), true);
  const { url, body } = posts[0];
  assert.ok(url.startsWith('https://api.telegram.org/bot') && url.endsWith('/sendMessage'));
  assert.equal(body.chat_id, '1465501848');
  for (const piece of ['🔴 SELL Gold (XAU/USD)', 'Entry 3525.21', 'SL 3539.86', 'TP1 3483.99', 'TP2 3442.77',
                       'R:R 1:2.8', 'Confidence 67%', 'ASIAN', 'not calibrated yet (5 closed', 'Check the live price']) {
    assert.ok(body.text.includes(piece), `missing: ${piece}`);
  }
});

test('calibrated band shows win rate and R', () => {
  const t = tg.formatSignal(signal({ direction: 'BUY', calibration: { calibrated: true, win_rate: 48, avg_r: 0.31, sample_size: 42 } }));
  assert.ok(t.startsWith('🟢 BUY'));
  assert.ok(t.includes('48% wins, +0.31R avg after spread (42 signals)'));
});

test('minimum confidence filter', async () => {
  setEnv(true, { TELEGRAM_MIN_CONFIDENCE: '70' });
  assert.equal(await tg.notifySignal(signal({ confidence: 67 })), false);
  assert.equal(posts.length, 0);
  assert.equal(await tg.notifySignal(signal({ confidence: 70 })), true);
});

test('a Telegram failure never throws and never leaks the token', async () => {
  setEnv(true); failNext = true;
  const logged = [];
  const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  try { assert.equal(await tg.notifySignal(signal()), false); } finally { console.error = orig; }
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes(TOKEN) && !logged[0].includes('SECRET'));
  assert.ok(logged[0].includes('401'));
});

test('outcome messages: R after spread, TP2, loss; ignores EXPIRED; can be switched off', async () => {
  setEnv(true);
  const sig = { symbol: 'EUR/USD', direction: 'BUY', entry: 1.1, stop_loss: 1.0985, take_profit_1: 1.1023, take_profit_2: 1.1045 };
  assert.ok(tg.formatOutcome(sig, 'WIN_TP1').includes('reached TP1 (+1.5'));
  assert.ok(tg.formatOutcome(sig, 'WIN_TP2').includes('reached TP2'));
  assert.ok(tg.formatOutcome(sig, 'LOSS').includes('stopped out (-1.0'));
  assert.equal(await tg.notifyOutcome(sig, 'EXPIRED'), false);
  assert.equal(posts.length, 0);
  setEnv(true, { TELEGRAM_OUTCOMES: 'false' });
  assert.equal(await tg.notifyOutcome(sig, 'LOSS'), false);
});

test('startup test message only when explicitly switched on', async () => {
  setEnv(true);
  assert.equal(await tg.notifyStartup(), false);
  setEnv(true, { TELEGRAM_STARTUP_MESSAGE: 'true' });
  assert.equal(await tg.notifyStartup(), true);
  assert.equal(posts.length, 1);
});

test('cron alerts the result of a real signal but never a shadow signal', async () => {
  setEnv(true);
  fake.tables.signals.length = 0; fake.tables.shadow_signals.length = 0;
  const history = freshRequire('../services/signalHistoryService');
  const created = new Date(Date.now() - 3 * 3600000);
  const base = { symbol: 'XAU/USD', direction: 'BUY', entry: 2000, stop_loss: 1990, take_profit_1: 2015,
                 take_profit_2: 2030, confidence: 72, outcome: null, created_at: created.toISOString() };
  fake.tables.signals.push({ id: 'real', ...base });
  fake.tables.shadow_signals.push({ id: 'shadow', ...base });
  const t = Math.floor(created.getTime() / 1000) + 900;
  candles = [{ time: t, open: 2000, high: 2016, low: 1999, close: 2014 }]; // hits TP1
  await history.evaluateOpenSignals();
  await new Promise(r => setImmediate(r));
  assert.equal(fake.tables.signals[0].outcome, 'WIN_TP1');
  assert.equal(fake.tables.shadow_signals[0].outcome, 'WIN_TP1');
  assert.equal(posts.length, 1, 'exactly one alert: the real signal');
  assert.ok(posts[0].body.text.includes('reached TP1'));
});
