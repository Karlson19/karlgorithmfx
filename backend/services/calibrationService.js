const supabase = require('../db/supabase');
const cache = require('../utils/cache');
const { listEnabledSymbols } = require('../config/pairs');

// ─── Confidence calibration ──────────────────────────────────────────────────
// Takes the stored signal outcomes and bins them by confidence band, per
// symbol. Returns a function the signal engine can call to ask:
//
//   "If I emit a signal at confidence 78 on USD/JPY, what does my OWN
//    history say the win rate is for that band? And do I have enough
//    samples to trust the answer?"
//
// Bands are 5% wide (60-65, 65-70, ...). A band needs MIN_SAMPLES of
// closed signals to be considered calibrated. Below that, callers should
// fall back to a default minimum confidence (the heuristic floor).
//
// The output is cached for an hour — recomputing per signal would hammer
// the DB pointlessly.

const BAND_WIDTH    = 5;
const MIN_BAND      = 50;
const MAX_BAND      = 100;
const MIN_SAMPLES   = 8;     // below this, treat the band as uncalibrated
const CACHE_TTL_SEC = 3600;  // 1 hour
const CACHE_KEY     = 'calibration_v1';

function bandFor(confidence) {
  const c = Math.max(MIN_BAND, Math.min(MAX_BAND - 0.0001, confidence));
  return Math.floor(c / BAND_WIDTH) * BAND_WIDTH;
}

async function loadHistory() {
  const { data, error } = await supabase
    .from('signals')
    .select('symbol, confidence, outcome')
    .not('outcome', 'is', null)
    .neq('outcome', 'EXPIRED');
  if (error) {
    console.error('calibration loadHistory error:', error.message);
    return [];
  }
  return data || [];
}

function buildTable(rows) {
  // table[symbol][band] = { wins, total, win_rate, samples }
  const table = {};
  for (const sym of listEnabledSymbols()) {
    table[sym] = {};
  }

  for (const row of rows) {
    const sym = row.symbol || 'EUR/USD'; // legacy rows w/o symbol → EUR/USD
    const band = bandFor(row.confidence);
    if (!table[sym]) table[sym] = {};
    if (!table[sym][band]) table[sym][band] = { wins: 0, total: 0 };
    table[sym][band].total += 1;
    if (row.outcome === 'WIN_TP1' || row.outcome === 'WIN_TP2') {
      table[sym][band].wins += 1;
    }
  }

  for (const sym of Object.keys(table)) {
    for (const band of Object.keys(table[sym])) {
      const cell = table[sym][band];
      cell.win_rate = cell.total > 0 ? Math.round((cell.wins / cell.total) * 100) : 0;
      cell.calibrated = cell.total >= MIN_SAMPLES;
    }
  }

  return table;
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
//   { calibrated: true,  win_rate, sample_size, band }   when we have data
//   { calibrated: false, band, sample_size }              when too few samples
async function lookup(symbol, confidence) {
  const table = await getCalibrationTable();
  const band  = bandFor(confidence);
  const cell  = (table[symbol] || {})[band];

  if (!cell || !cell.calibrated) {
    return {
      calibrated: false,
      band,
      sample_size: cell ? cell.total : 0,
    };
  }
  return {
    calibrated: true,
    band,
    sample_size: cell.total,
    win_rate: cell.win_rate,
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
  MIN_SAMPLES,
};
