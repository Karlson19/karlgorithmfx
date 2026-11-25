// Run:  node backtest/run.js
// Needs TWELVE_DATA_API_KEYS (or TWELVE_DATA_API_KEY). Optional:
//   BACKTEST_PAIRS=XAU/USD,EUR/USD   (default: every enabled pair)
//   BACKTEST_BARS=5000               (H1 candles per pair, max 5000, about 9 months)
//   TELEGRAM_TOKEN + TELEGRAM_CHAT_ID  -> the report is sent to your bot
// It never touches your database and never sends signals.
// Heavy: expect several minutes per pair on a normal computer, much longer on a
// small free host. Run it on your own computer if you can.

const fs = require('fs');
const path = require('path');

const harness = require('./harness').install(); // must come first: stubs the outside world
const { listEnabledSymbols, getPair } = require('../config/pairs');
const { fetchH1, parseKeys } = require('./data');
const { runReplay } = require('./replay');
const { buildReport, chunk } = require('./stats');
const telegram = require('../services/telegramService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const keys = parseKeys();
  if (!keys.length) throw new Error('Set TWELVE_DATA_API_KEYS (or TWELVE_DATA_API_KEY)');
  const symbols = (process.env.BACKTEST_PAIRS ? process.env.BACKTEST_PAIRS.split(',').map((s) => s.trim()) : listEnabledSymbols());
  const bars = Math.min(Number(process.env.BACKTEST_BARS || 5000), 5000);
  const perSymbol = {};
  let k = 0;

  await telegram.sendMessage(`Backtest started on ${symbols.join(', ')}. This can take a while. The report will arrive here.`);
  for (const sym of symbols) {
    const pair = getPair(sym);
    if (!pair) { console.log(`skip ${sym}: unknown pair`); continue; }
    try {
      console.log(`[${sym}] downloading up to ${bars} H1 candles...`);
      const h1 = await fetchH1(sym, bars, keys[k++ % keys.length]);
      console.log(`[${sym}] ${h1.length} candles. Replaying the engine...`);
      const { trades, emitted } = await runReplay({
        symbol: sym, h1, harness, pair,
        onProgress: (i, n) => console.log(`[${sym}] ${i}/${n}`),
      });
      perSymbol[sym] = { trades, emitted, from: h1[0].time, to: h1[h1.length - 1].time };
      console.log(`[${sym}] ${trades.length} trades from ${emitted} signals`);
    } catch (err) {
      let msg = String(err.message || err);
      for (const key of keys) msg = msg.split(key).join('***'); // never print an API key
      console.error(`[${sym}] failed: ${msg}`);
    }
    await sleep(9000); // stay under the data provider's per-minute limit
  }
  if (harness.dbCalls() > 0) console.error(`WARNING: ${harness.dbCalls()} database calls were blocked during the replay.`);

  const months = Math.round(bars / 24 / 5 / 4.3 * 10) / 10;
  const { text, json } = buildReport({ perSymbol, months });
  console.log('\n' + text);
  const dir = path.join(__dirname, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `results-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(json));
  console.log(`\nFull results: ${file}`);
  for (const part of chunk(text)) await telegram.sendMessage(part);
  await telegram.sendMessage('Backtest finished. If you started it with RUN_BACKTEST=true, remove that setting now so it does not run again on every restart.');
}

main().then(() => process.exit(0)).catch((err) => { console.error('Backtest failed:', err.message); process.exit(1); });
