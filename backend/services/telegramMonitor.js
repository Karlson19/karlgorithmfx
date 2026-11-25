const cache = require('../utils/cache');
const telegram = require('./telegramService');
const tradeMonitor = require('./tradeMonitorService');

// ─── Telegram trade monitor ──────────────────────────────────────────────────
// Every minute: if any trade is open in the journal, run the existing trade
// monitor and send close/hold advice to Telegram. With no open trades it costs
// one small database query and no price-API calls.
//
// Each alert is sent once, then repeated at most every 90 minutes while the
// condition lasts (same rule as the web-push cron).
//
// Reality check on "real-time": prices come from your data feed (live quotes
// are cached ~30 s) and the monitor can only watch trades that are logged in
// the app's journal.

const DEDUPE_TTL = 90 * 60; // seconds
let running = false;

async function runOnce() {
  if (!telegram.enabled() || running) return 0;
  running = true;
  try {
    let userIds = await tradeMonitor.listUsersWithOpenTrades();
    if (process.env.TELEGRAM_USER_ID) userIds = userIds.filter(id => id === process.env.TELEGRAM_USER_ID);

    let sent = 0;
    for (const userId of userIds) {
      let alerts = [];
      try { alerts = await tradeMonitor.analyseOpenTrades(userId); } catch { continue; }
      for (const a of alerts.filter(telegram.isActionable)) {
        const key = `tg_alert:${userId}:${a.id}`;
        if (cache.get(key)) continue;
        if (await telegram.notifyTradeAlert(a)) {
          cache.set(key, true, DEDUPE_TTL);
          sent++;
        }
      }
    }
    return sent;
  } finally {
    running = false;
  }
}

module.exports = { runOnce };
