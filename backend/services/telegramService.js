const axios = require('axios');
const { resultInR } = require('./calibrationService');

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
    '',
    'Check the live price and spread on Exness first. The entry is the last closed H1 candle and can be stale. Skip it if price has already moved toward the target. Risk 1% max.',
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

module.exports = { enabled, sendMessage, notifySignal, notifyOutcome, notifyStartup, formatSignal, formatOutcome };
