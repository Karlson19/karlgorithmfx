const { RSI } = require('technicalindicators');

// ─── Divergence Detection ────────────────────────────────────────────────────
// Detects classical bullish / bearish divergence between price and RSI
// over a recent window. This is one of the more reliable patterns in
// technical analysis — it tends to precede reversals at exhaustion points.
//
//   - BULLISH divergence: price prints a LOWER LOW while RSI prints a
//     HIGHER LOW → momentum exhaustion on the way down → potential reversal up
//   - BEARISH divergence: price prints a HIGHER HIGH while RSI prints a
//     LOWER HIGH → momentum exhaustion on the way up → potential reversal down
//
// Algorithm:
//   1. Identify two recent pivots in price (swing lows for bullish,
//      swing highs for bearish)
//   2. Look up the RSI values at those same indices
//   3. Compare: if RSI direction is opposite of price direction → divergence
//
// We only consider pivots in the last `lookback` candles (default 30) to
// keep it relevant. Hidden divergence (continuation pattern) is NOT detected
// here — that's a different setup the user can add later if they want.

const PIVOT_WIDTH = 2; // candles on each side that must be higher/lower

function findPivotLows(values, width = PIVOT_WIDTH) {
  const pivots = [];
  for (let i = width; i < values.length - width; i++) {
    let isPivot = true;
    for (let j = 1; j <= width; j++) {
      if (values[i - j] <= values[i] || values[i + j] <= values[i]) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) pivots.push({ index: i, value: values[i] });
  }
  return pivots;
}

function findPivotHighs(values, width = PIVOT_WIDTH) {
  const pivots = [];
  for (let i = width; i < values.length - width; i++) {
    let isPivot = true;
    for (let j = 1; j <= width; j++) {
      if (values[i - j] >= values[i] || values[i + j] >= values[i]) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) pivots.push({ index: i, value: values[i] });
  }
  return pivots;
}

// Main entry: detect divergence in a candle series.
// Returns:
//   { type: 'bullish' | 'bearish' | null, strength: 0..1, price_change_pct, rsi_change }
// 'strength' reflects how clean the divergence is (bigger price-vs-RSI
// directional difference = stronger).
function detectDivergence(candles, lookback = 30) {
  if (!Array.isArray(candles) || candles.length < lookback + 20) {
    return { type: null, strength: 0 };
  }

  // Compute RSI from closes (need ~14 prior bars to warm up).
  const closes = candles.map(c => c.close);
  const rsiSeries = RSI.calculate({ values: closes, period: 14 });
  // RSI is shorter than closes by (period - 1). Pad with nulls so indexes align.
  const rsiOffset = closes.length - rsiSeries.length;
  const alignedRsi = new Array(rsiOffset).fill(null).concat(rsiSeries);

  // Restrict to the last `lookback` candles.
  const startIdx = Math.max(0, closes.length - lookback);
  const lows  = candles.slice(startIdx).map(c => c.low);
  const highs = candles.slice(startIdx).map(c => c.high);

  // Find pivots WITHIN the lookback window, then re-index back to full series.
  const pivotLowsRel  = findPivotLows(lows);
  const pivotHighsRel = findPivotHighs(highs);

  // Need at least two pivots of each kind to compare.
  if (pivotLowsRel.length >= 2) {
    const last = pivotLowsRel[pivotLowsRel.length - 1];
    const prev = pivotLowsRel[pivotLowsRel.length - 2];
    const lastAbs = last.index + startIdx;
    const prevAbs = prev.index + startIdx;
    const lastRsi = alignedRsi[lastAbs];
    const prevRsi = alignedRsi[prevAbs];

    if (lastRsi != null && prevRsi != null) {
      const priceLower = last.value < prev.value;
      const rsiHigher  = lastRsi > prevRsi;
      if (priceLower && rsiHigher) {
        const priceMag = Math.abs((prev.value - last.value) / prev.value);
        const rsiMag   = Math.abs((lastRsi - prevRsi) / Math.max(prevRsi, 1));
        return {
          type: 'bullish',
          strength: Math.min(1, priceMag * 50 + rsiMag * 2),
          price_change_pct: parseFloat((-priceMag * 100).toFixed(2)),
          rsi_change: parseFloat((lastRsi - prevRsi).toFixed(1)),
          last_low: last.value,
          prev_low: prev.value,
        };
      }
    }
  }

  if (pivotHighsRel.length >= 2) {
    const last = pivotHighsRel[pivotHighsRel.length - 1];
    const prev = pivotHighsRel[pivotHighsRel.length - 2];
    const lastAbs = last.index + startIdx;
    const prevAbs = prev.index + startIdx;
    const lastRsi = alignedRsi[lastAbs];
    const prevRsi = alignedRsi[prevAbs];

    if (lastRsi != null && prevRsi != null) {
      const priceHigher = last.value > prev.value;
      const rsiLower    = lastRsi < prevRsi;
      if (priceHigher && rsiLower) {
        const priceMag = Math.abs((last.value - prev.value) / prev.value);
        const rsiMag   = Math.abs((prevRsi - lastRsi) / Math.max(prevRsi, 1));
        return {
          type: 'bearish',
          strength: Math.min(1, priceMag * 50 + rsiMag * 2),
          price_change_pct: parseFloat((priceMag * 100).toFixed(2)),
          rsi_change: parseFloat((lastRsi - prevRsi).toFixed(1)),
          last_high: last.value,
          prev_high: prev.value,
        };
      }
    }
  }

  return { type: null, strength: 0 };
}

module.exports = { detectDivergence };
