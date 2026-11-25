const supabase = require('../db/supabase');
const cache = require('../utils/cache');
const { listEnabledSymbols, getPair } = require('../config/pairs');
const { dedupeSignals } = require('../utils/dedupe');

// ─── Confidence calibration ──────────────────────────────────────────────────
// Takes the stored signal outcomes and bins them by confidence band, per
// symbol. The signal engine asks:
//
//   "If I emit a signal at confidence 78 on USD/JPY, what does my OWN
//    history say it earns in that band, and do I have enough samples to
//    trust the answer?"
//
// What changed from v1 (accuracy fixes):
//   1. DEDUPED. One signal per (symbol, direction, UTC hour). Regenerations of
//      the same setup no longer count as extra samples.
//   2. EXPECTANCY, not win rate. Win rate alone ignores reward-to-risk: a 55%
//      win rate loses money if wins are smaller than losses. Each outcome is
//      converted to R (1R = distance from entry to stop), net of the pair's
//      typical spread.
//   3. CONSERVATIVE BOUND. A band passes only if (mean R - 1 standard error) > 0,
//      so a lucky small sample cannot unlock a band.
//   4. MORE SAMPLES. 30 per band instead of 8.
//   5. SHADOW SIGNALS. Signals blocked by this gate are still tracked (in the
//      shadow_signals table) so a blocked band keeps collecting data and can
//      recover. Without this, a band that dipped once could never re-open.
//
// Wins are valued at TP1 (conservative: assumes the trade is closed at TP1,
// even when price later reached TP2).

const BAND_WIDTH    = 5;
const MIN_BAND      = 50;
const MAX_BAND      = 100;
const MIN_SAMPLES   = 30;     // below this, treat the band as uncalibrated
const SE_MULT       = 1;      // lower bound = mean R - SE_MULT * standard error
const CACHE_TTL_SEC = 3600;   // 1 hour
const CACHE_KEY     = 'calibration_v2';

function bandFor(confidence) {
  const c = Math.max(MIN_BAND, Math.min(MAX_BAND - 0.0001, confidence));
  return Math.floor(c / BAND_WIDTH) * BAND_WIDTH;
}

const isWin = (o) => o === 'WIN_TP1' || o === 'WIN_TP2';

// Result of one closed signal in R, net of spread. Returns null if the row
// lacks the data to compute it (old rows, missing levels).
function resultInR(row) {
  const entry = Number(row.entry);
  const sl = Number(row.stop_loss);
  const tp1 = Number(row.take_profit_1);
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return null;

  let exitPrice;
  if (row.outcome === 'LOSS') exitPrice = sl;
  else if (isWin(row.outcome)) exitPrice = tp1;
  else return null;
  if (!Number.isFinite(exitPrice)) return null;

  const dir = row.direction === 'SELL' ? -1 : 1;
  const pair = getPair(row.symbol);
  const spread = pair ? (pair.typical_spread || 0) * pair.pip_size : 0;
  return (dir * (exitPrice - entry) - spread) / risk;
}

async function fetchRows(table, required) {
  const { data, error } = await supabase
    .from(table)
    .select('symbol, direction, confidence, outcome, entry, stop_loss, take_profit_1, created_at')
    .not('outcome', 'is', null)
    .neq('outcome', 'EXPIRED');
  if (error) {
    if (required) console.error(`calibration loadHistory error (${table}):`, error.message);
    // shadow_signals is optional: it may not exist until migration 004 is run.
    return [];
  }
  return data || [];
}

async function loadHistory() {
  const [real, shadow] = await Promise.all([
    fetchRows('signals', true),
    fetchRows('shadow_signals', false),
  ]);
  return [...real, ...shadow];
}

function buildTable(rows) {
  // table[symbol][band] = { wins, total, win_rate, avg_r, lower_r, calibrated }
  const table = {};
  for (const sym of listEnabledSymbols()) table[sym] = {};

  const cells = {}; // sym -> band -> { wins, rs: [] }
  for (const row of dedupeSignals(rows)) {
    const r = resultInR(row);
    if (r === null) continue;
    const sym = row.symbol || 'EUR/USD'; // legacy rows w/o symbol → EUR/USD
    const band = bandFor(row.confidence);
    if (!cells[sym]) cells[sym] = {};
    if (!cells[sym][band]) cells[sym][band] = { wins: 0, rs: [] };
    cells[sym][band].rs.push(r);
    if (isWin(row.outcome)) cells[sym][band].wins += 1;
  }

  for (const sym of Object.keys(cells)) {
    if (!table[sym]) table[sym] = {};
    for (const band of Object.keys(cells[sym])) {
      const { wins, rs } = cells[sym][band];
      const n = rs.length;
      const mean = rs.reduce((s, x) => s + x, 0) / n;
      const variance = n > 1 ? rs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
      const se = n > 1 ? Math.sqrt(variance / n) : Infinity;
      table[sym][band] = {
        wins,
        total: n,
        win_rate: Math.round((wins / n) * 100),
        avg_r: parseFloat(mean.toFixed(3)),
        lower_r: Number.isFinite(se) ? parseFloat((mean - SE_MULT * se).toFixed(3)) : null,
        calibrated: n >= MIN_SAMPLES,
      };
    }
  }
  return table;
}

// The gate used by the signal engine for a calibrated band.
function passesGate(cal) {
  return !!cal && cal.calibrated === true && cal.lower_r != null && cal.lower_r > 0;
}

async function getCalibrationTable() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;
  const rows = await loadHistory();
  const table = buildTable(rows);
  cache.set(CACHE_KEY, table, CACHE_TTL_SEC);
  return table;
}

// Force a refresh — called by cron after evaluateOpenSignals.
async function refreshCalibration() {
  cache.del(CACHE_KEY);
  return getCalibrationTable();
}

// Main consumer-facing API used by the signal engine.
//
// Returns:
//   { calibrated: true, band, sample_size, win_rate, avg_r, lower_r }  when we have data
//   { calibrated: false, band, sample_size }                           when too few samples
async function lookup(symbol, confidence) {
  const table = await getCalibrationTable();
  const band  = bandFor(confidence);
  const cell  = (table[symbol] || {})[band];

  if (!cell || !cell.calibrated) {
    return { calibrated: false, band, sample_size: cell ? cell.total : 0 };
  }
  return {
    calibrated: true,
    band,
    sample_size: cell.total,
    win_rate: cell.win_rate,
    avg_r: cell.avg_r,
    lower_r: cell.lower_r,
  };
}

// For UI / debugging: return the whole table.
async function getFullTable() {
  return await getCalibrationTable();
}

module.exports = {
  lookup,
  refreshCalibration,
  getFullTable,
  bandFor,
  buildTable,
  resultInR,
  passesGate,
  MIN_SAMPLES,
};
