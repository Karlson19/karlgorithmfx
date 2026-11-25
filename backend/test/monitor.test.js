const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase, stubModule, freshRequire } = require('./helpers');

const posts = [];
stubModule('axios', { post: async (url, body) => { posts.push(body); return { data: { ok: true } }; } });
stubModule('../db/supabase', makeFakeSupabase());

let users = [];
let alertsByUser = {};
let analyseCalls = 0;
stubModule('../services/tradeMonitorService', {
  listUsersWithOpenTrades: async () => users,
  analyseOpenTrades: async (u) => { analyseCalls++; return alertsByUser[u] || []; },
});

const { positionSizing, sizingLines } = require('../utils/positionSizing');
const tg = freshRequire('../services/telegramService');
const cache = require('../utils/cache');
const monitor = freshRequire('../services/telegramMonitor');

const setEnv = (on, extra = {}) => {
  for (const k of ['TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_USER_ID', 'ACCOUNT_BALANCE_USD', 'RISK_PER_TRADE_PCT', 'ACCOUNT_TYPE']) delete process.env[k];
  if (on) { process.env.TELEGRAM_TOKEN = '1:tok'; process.env.TELEGRAM_CHAT_ID = '42'; }
  Object.assign(process.env, extra);
  posts.length = 0; analyseCalls = 0;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- position sizing (numbers checked by hand)
test('EUR/USD 15-pip stop on a $20 STANDARD account is too big (min lot risks $1.50 = 7.5%)', () => {
  const s = positionSizing({ symbol: 'EUR/USD', entry: 1.1, stop_loss: 1.0985 }, { balance: 20, riskPct: 2, accountType: 'standard' });
  assert.equal(s.stopPips, 15);
  assert.ok(near(s.minLotRiskUsd, 1.5) && near(s.minLotRiskPct, 7.5));
  assert.equal(s.tooBig, true);
  assert.equal(s.lots, 0);
});

test('same trade on a CENT account fits: 0.26 cent lots, risk about $0.39', () => {
  const s = positionSizing({ symbol: 'EUR/USD', entry: 1.1, stop_loss: 1.0985 }, { balance: 20, riskPct: 2, accountType: 'cent' });
  assert.equal(s.tooBig, false);
  assert.equal(s.lots, 0.26);
  assert.ok(near(s.lotsRiskUsd, 0.39) && s.lotsRiskUsd <= 0.4);
  assert.ok(near(s.minLotRiskUsd, 0.015));
});

test('your Gold signal (stop 14.65 away) is far too big for $20 on a standard account', () => {
  const s = positionSizing({ symbol: 'XAU/USD', entry: 3525.21, stop_loss: 3539.86 }, { balance: 20, riskPct: 2, accountType: 'standard' });
  assert.ok(near(s.stopPips, 146.5) && near(s.minLotRiskUsd, 14.65, 1e-3));
  assert.ok(s.minLotRiskPct > 70);
  assert.equal(s.tooBig, true);
});

test('size never exceeds the risk limit and rounds down', () => {
  for (const bal of [20, 50, 137, 1000]) for (const pct of [1, 2, 5]) for (const type of ['standard', 'cent']) {
    const s = positionSizing({ symbol: 'AUD/USD', entry: 0.65, stop_loss: 0.6488 }, { balance: bal, riskPct: pct, accountType: type });
    if (!s.tooBig) assert.ok(s.lotsRiskUsd <= (bal * pct) / 100 + 1e-9, `${bal}/${pct}/${type}`);
  }
});

test('sizing line only appears when a balance is configured', () => {
  const sig = { symbol: 'EUR/USD', entry: 1.1, stop_loss: 1.0985 };
  assert.equal(sizingLines(sig, {}), null);
  assert.ok(sizingLines(sig, { ACCOUNT_BALANCE_USD: '20' }).startsWith('⛔ Too big for your $20.00'));
  assert.ok(sizingLines(sig, { ACCOUNT_BALANCE_USD: '20', ACCOUNT_TYPE: 'cent' }).startsWith('Size: 0.26 cent lots'));
});

test('signal message includes the sizing warning and the log-it reminder', async () => {
  setEnv(true, { ACCOUNT_BALANCE_USD: '20' });
  await tg.notifySignal({ symbol: 'EUR/USD', direction: 'BUY', entry: 1.1, stop_loss: 1.0985, take_profit_1: 1.1023,
    take_profit_2: 1.1045, confidence: 70, calibration: { calibrated: false, sample_size: 0 } });
  assert.ok(posts[0].text.includes('⛔ Too big for your $20.00'));
  assert.ok(posts[0].text.includes('log the trade in the app'));
});

// ---- trade alerts
const alert = (o) => ({ id: 't1_giveback_critical', trade_id: 't1', type: 'PROFIT_GIVEBACK', severity: 'critical',
  title: 'Gold reversed - protect your gains', message: 'Gave back 60% of peak.', suggested_action: 'CLOSE_OR_MOVE_SL_NOW', ...o });

test('alert formatting and which alerts are worth a message', () => {
  const t = tg.formatTradeAlert(alert());
  assert.ok(t.startsWith('🚨 Gold reversed') && t.includes('Do this: Close now, or move your stop'));
  assert.equal(tg.isActionable(alert({ severity: 'info', type: 'MOVE_TO_BREAKEVEN' })), false);
  assert.equal(tg.isActionable(alert({ severity: 'info', type: 'TP1_HIT' })), true);
  assert.equal(tg.isActionable(alert({ severity: 'warning' })), true);
});

test('monitor sends an alert once, then stays quiet (dedupe)', async () => {
  setEnv(true); cache.del('tg_alert:u1:t1_giveback_critical');
  users = ['u1']; alertsByUser = { u1: [alert(), alert({ id: 't1_be_info', severity: 'info', type: 'MOVE_TO_BREAKEVEN' })] };
  assert.equal(await monitor.runOnce(), 1);       // info alert skipped
  assert.equal(await monitor.runOnce(), 0);       // same alert, deduped
  assert.equal(posts.length, 1);
});

test('monitor does nothing without Telegram config or without open trades', async () => {
  setEnv(false); users = ['u1'];
  assert.equal(await monitor.runOnce(), 0); assert.equal(analyseCalls, 0);
  setEnv(true); users = [];
  assert.equal(await monitor.runOnce(), 0); assert.equal(analyseCalls, 0); // no price-API work when nothing is open
});

test('TELEGRAM_USER_ID limits alerts to that user', async () => {
  setEnv(true, { TELEGRAM_USER_ID: 'me' }); cache.del('tg_alert:me:a1'); cache.del('tg_alert:other:a2');
  users = ['other', 'me'];
  alertsByUser = { me: [alert({ id: 'a1' })], other: [alert({ id: 'a2' })] };
  assert.equal(await monitor.runOnce(), 1);
  assert.equal(analyseCalls, 1);
});

test('overlapping runs are skipped', async () => {
  setEnv(true); cache.del('tg_alert:u9:slow');
  users = ['u9']; alertsByUser = { u9: [alert({ id: 'slow' })] };
  const [a, b] = await Promise.all([monitor.runOnce(), monitor.runOnce()]);
  assert.equal(a + b, 1);
});
