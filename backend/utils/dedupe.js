const { PRIMARY_SYMBOL } = require('../config/pairs');

// ─── Signal de-duplication ───────────────────────────────────────────────────
// Signals are built from the last CLOSED H1 candle, so every regeneration
// within the same UTC hour produces the same setup. Without de-duplication one
// trade can be stored several times and counted as several independent samples,
// which inflates sample sizes and distorts every win-rate statistic.
//
// Rule: one signal per (symbol, direction, UTC hour). The earliest one wins.

const HOUR_MS = 3600000;

function hourBucket(ts) {
  return Math.floor(new Date(ts).getTime() / HOUR_MS);
}

function dedupeSignals(rows) {
  if (!Array.isArray(rows)) return [];
  const sorted = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const seen = new Set();
  const out = [];
  for (const r of sorted) {
    // Rows we cannot key (legacy / missing fields) are kept as-is.
    if (!r.created_at || !r.direction) { out.push(r); continue; }
    const key = `${r.symbol || PRIMARY_SYMBOL}|${r.direction}|${hourBucket(r.created_at)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

module.exports = { dedupeSignals, hourBucket, HOUR_MS };
