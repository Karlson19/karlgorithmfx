const axios = require('axios');
const { resultInR } = require('./calibrationService');
const { sizingLines } = require('../utils/positionSizing');

// ─── Telegram alerts ─────────────────────────────────────────────────────────
// Sends new signals and their outcomes to your own Telegram chat.
//
// Configure in your host's environment settings (never in code or GitHub):
//   TELEGRAM_TOKEN              bot token from @BotFather
//   TELEGRAM_CHAT_ID            your chat id (from @userinfobot)
// Optional:
//   TELEGRAM_MIN_CONFIDENCE     only alert signals at or above this confidence (default 0)
//   TELEGRAM_OUTCOMES           set to "false" to skip win/loss messages
//   TELEGRAM_STARTUP_MESSAGE    set to "true" once to get a test message on boot
//   TELEGRAM_USER_ID            only send close/hold alerts for this app user's trades (default: all)
//   ACCOUNT_BALANCE_USD         your balance; adds a position-size line (or a TOO BIG warning) to signals
//   RISK_PER_TRADE_PCT          max % of balance to risk per trade (default 2)
//   ACCOUNT_TYPE                "standard" (default) or "cent"
//
// With no token/chat id set, every function here silently does nothing.
// Alerts are best-effort: a Telegram failure never affects signal generation.

const API = 'https://api.telegram.org';

function enabled() {
  return !!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function sendMessage(text) {
  if (!enabled()) return false;
  try {
    await axios.post(
      `${API}/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true },
      { timeout: 10000 }
    );
    return true;
  } catch (err) {
    // Never log err.config / err.request: the URL contains the bot token.
    const status = err.response ? err.response.status : 'network';
    const why = (err.response && err.response.data && err.response.data.description) || err.code || 'error';
    console.error(`[telegram] send failed (${status}): ${why}`);
    return false;
  }
}

const num = (v) => (v == null ? '-' : v);

function formatSignal(s) {
  const icon = s.direction === 'BUY' ? '🟢' : '🔴';
  const name = s.display_name ? `${s.display_name} (${s.symbol})` : s.symbol;
  const cal = s.calibration || {};
  const calLine = cal.calibrated
    ? `History in this band: ${cal.win_rate}% wins, ${cal.avg_r > 0 ? '+' : ''}${cal.avg_r}R avg after spread (${cal.sample_size} signals)`
    : `This confidence band is not calibrated yet (${cal.sample_size || 0} closed signals)`;
  return [
    `${icon} ${s.direction} ${name}`,
    `Entry ${num(s.entry)}  |  SL ${num(s.stop_loss)}`,
    `TP1 ${num(s.take_profit_1)}  |  TP2 ${num(s.take_profit_2)}`,
    `R:R ${num(s.risk_reward)}  |  Confidence ${num(s.confidence)}%  |  ${s.timeframe || 'H1'}${s.session ? '  |  ' + s.session : ''}`,
    s.strategy ? `Strategy: ${s.strategy}` : null,
    calLine,
    sizingLines(s),
    '',
    'Check the live price and spread on Exness first. The entry is the last closed H1 candle and can be stale. Skip it if price has already moved toward the target.',
    'If you take it, log the trade in the app so you get close/hold alerts here.',
  ].filter((l) => l !== null).join('\n');
}

function formatOutcome(sig, outcome) {
  const r = resultInR({ ...sig, outcome });
  const rText = r == null ? '' : ` (${r > 0 ? '+' : ''}${r.toFixed(2)}R after spread)`;
  const name = sig.symbol || '';
  if (outcome === 'LOSS') return `❌ ${name} ${sig.direction} was stopped out${rText}`;
  if (outcome === 'WIN_TP2') return `✅ ${name} ${sig.direction} reached TP2${rText}`;
  return `✅ ${name} ${sig.direction} reached TP1${rText}`;
}

// Called once per NEWLY saved signal (duplicates never get here).
async function notifySignal(signal) {
  if (!enabled()) return false;
  const min = Number(process.env.TELEGRAM_MIN_CONFIDENCE || 0);
  if (Number(signal.confidence) < min) return false;
  return sendMessage(formatSignal(signal));
}

// Called when a real (non-shadow) signal is settled.
async function notifyOutcome(sig, outcome) {
  if (!enabled() || process.env.TELEGRAM_OUTCOMES === 'false') return false;
  if (!['WIN_TP1', 'WIN_TP2', 'LOSS'].includes(outcome)) return false;
  return sendMessage(formatOutcome(sig, outcome));
}

async function notifyStartup() {
  if (process.env.TELEGRAM_STARTUP_MESSAGE !== 'true') return false;
  return sendMessage('KarlgorithmFX backend started. Telegram alerts are working. Remove TELEGRAM_STARTUP_MESSAGE to stop this message.');
}

// ─── Open-trade alerts (when to close / move the stop) ───────────────────────
const ACTION_TEXT = {
  CLOSE_OR_MOVE_SL_NOW: 'Close now, or move your stop to lock in profit.',
  MOVE_SL_TO_BE: 'Move your stop to your entry price (break-even).',
  CLOSE_PARTIAL_TRAIL: 'TP1 reached: close part of the trade and trail the rest, or close it all.',
  TIGHTEN_SL_OR_CLOSE: 'Tighten your stop, or close.',
  TIGHTEN_SL_OR_MONITOR: 'Tighten your stop and watch it closely.',
  PROTECT_BEFORE_NEWS: 'Protect the trade before the news: tighten the stop or close.',
};

// Only alerts worth interrupting you for: critical, warning, and TP1 reached.
function isActionable(a) {
  return a.severity === 'critical' || a.severity === 'warning' || a.type === 'TP1_HIT';
}

function formatTradeAlert(a) {
  const icon = a.severity === 'critical' ? '🚨' : a.severity === 'warning' ? '⚠️' : '✅';
  const todo = ACTION_TEXT[a.suggested_action] || a.suggested_action;
  return [`${icon} ${a.title}`, a.message, todo ? `Do this: ${todo}` : null].filter(Boolean).join('\n');
}

async function notifyTradeAlert(a) {
  if (!enabled() || !isActionable(a)) return false;
  return sendMessage(formatTradeAlert(a));
}

module.exports = {
  enabled, sendMessage, notifySignal, notifyOutcome, notifyStartup, notifyTradeAlert,
  isActionable, formatSignal, formatOutcome, formatTradeAlert,
};
