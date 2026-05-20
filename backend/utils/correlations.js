// ─── Pair correlation matrix ─────────────────────────────────────────────────
// Approximate long-run correlations between the 5 supported pairs based on
// FX research / historical analysis. NOT computed dynamically because:
//   - Correlations are unstable over short windows (a 1-week computed
//     correlation can be wildly different from a 1-year one)
//   - The PURPOSE here is to warn 'you're taking the same trade twice',
//     not to do correlation arbitrage. Static, well-known relationships
//     suffice for that.
//
// Values range from -1 (perfectly inverse) to +1 (perfectly correlated).
// Symmetric — corr(A, B) === corr(B, A). Self-correlation is 1.
//
// Sources/intuition:
//   - EUR/USD ↔ GBP/USD: ~+0.83 (both USD-denominated majors)
//   - EUR/USD ↔ AUD/USD: ~+0.65 (risk-on / USD weakness shared)
//   - EUR/USD ↔ USD/JPY: ~-0.50 (USD strength splits them)
//   - EUR/USD ↔ XAU/USD: ~+0.40 (gold often rises when USD weakens)
//   - GBP/USD ↔ AUD/USD: ~+0.55
//   - GBP/USD ↔ USD/JPY: ~-0.40
//   - GBP/USD ↔ XAU/USD: ~+0.35
//   - USD/JPY ↔ AUD/USD: ~-0.45
//   - USD/JPY ↔ XAU/USD: ~-0.45
//   - AUD/USD ↔ XAU/USD: ~+0.55

const MATRIX = {
  'EUR/USD': { 'EUR/USD': 1.00, 'GBP/USD':  0.83, 'USD/JPY': -0.50, 'AUD/USD':  0.65, 'XAU/USD':  0.40 },
  'GBP/USD': { 'EUR/USD': 0.83, 'GBP/USD':  1.00, 'USD/JPY': -0.40, 'AUD/USD':  0.55, 'XAU/USD':  0.35 },
  'USD/JPY': { 'EUR/USD':-0.50, 'GBP/USD': -0.40, 'USD/JPY':  1.00, 'AUD/USD': -0.45, 'XAU/USD': -0.45 },
  'AUD/USD': { 'EUR/USD': 0.65, 'GBP/USD':  0.55, 'USD/JPY': -0.45, 'AUD/USD':  1.00, 'XAU/USD':  0.55 },
  'XAU/USD': { 'EUR/USD': 0.40, 'GBP/USD':  0.35, 'USD/JPY': -0.45, 'AUD/USD':  0.55, 'XAU/USD':  1.00 },
};

// Return correlation between two pairs as a number in [-1, 1].
// Returns 0 for unknown pair pairs (treated as independent).
function correlation(symbolA, symbolB) {
  if (!symbolA || !symbolB) return 0;
  if (symbolA === symbolB) return 1;
  const row = MATRIX[symbolA];
  if (!row) return 0;
  return row[symbolB] != null ? row[symbolB] : 0;
}

// Given an intended new trade and a list of existing open trades, compute
// the "effective exposure" — i.e., how many independent trades worth of
// risk you'd be carrying.
//
// Example: you have a BUY on GBP/USD and you're about to open a BUY on
// EUR/USD. Correlation = +0.83. Same direction → you're essentially 1.83×
// long the dollar-weakening trade.
//
// Inverse correlations matter too: BUY EUR/USD + SELL USD/JPY are MORE
// correlated than they look (both bet on dollar weakening). Same-direction
// trade on a -0.5 correlated pair == OPPOSING-direction trade on a +0.5
// pair == cancels exposure.
//
// Returns an object with the analysis so the UI can render a useful warning.
function analyseExposure({ newSymbol, newDirection, openTrades }) {
  if (!Array.isArray(openTrades) || openTrades.length === 0) {
    return { effective_multiplier: 1, contributions: [], warning_level: 'none' };
  }
  let total = 1; // the new trade itself counts as 1
  const contributions = [];

  for (const t of openTrades) {
    if (!t.pair || !t.direction) continue;
    const corr = correlation(newSymbol, t.pair);
    // Direction alignment: same-direction trades on positively-correlated
    // pairs ADD exposure. Opposite-direction trades on positively-correlated
    // pairs CANCEL exposure. Same logic with sign flipped for negative
    // correlation.
    const dirSign = (newDirection === t.direction) ? 1 : -1;
    const contribution = corr * dirSign;
    if (Math.abs(contribution) >= 0.15) {
      contributions.push({
        symbol: t.pair, direction: t.direction,
        correlation: corr, contribution,
      });
      total += contribution;
    }
  }

  // Round to one decimal for display
  const effective_multiplier = Math.round(total * 10) / 10;

  // Warning tiers — based on the absolute multiplier ABOVE 1 (additive
  // exposure beyond the single new trade).
  const excess = effective_multiplier - 1;
  let warning_level = 'none';
  if (excess >= 1.5)      warning_level = 'critical';   // doubling+
  else if (excess >= 0.8) warning_level = 'high';
  else if (excess >= 0.4) warning_level = 'medium';
  else if (excess >= 0.15) warning_level = 'low';
  // Excess can also go NEGATIVE — that's a hedged book (offsetting trades).
  // We don't warn on that; it's a deliberate choice and reduces risk.

  return {
    effective_multiplier,
    contributions,
    warning_level,
  };
}

module.exports = { correlation, analyseExposure, MATRIX };
