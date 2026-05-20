// Frontend-side mirror of backend/utils/correlations.js so the TradeForm
// can compute a warning client-side without a round trip.
//
// IMPORTANT: keep these values in sync with the backend file. If they
// drift, the warning shown to the user won't match what the engine sees.

export const CORRELATION_MATRIX: Record<string, Record<string, number>> = {
  'EUR/USD': { 'EUR/USD': 1.00, 'GBP/USD':  0.83, 'USD/JPY': -0.50, 'AUD/USD':  0.65, 'XAU/USD':  0.40 },
  'GBP/USD': { 'EUR/USD': 0.83, 'GBP/USD':  1.00, 'USD/JPY': -0.40, 'AUD/USD':  0.55, 'XAU/USD':  0.35 },
  'USD/JPY': { 'EUR/USD':-0.50, 'GBP/USD': -0.40, 'USD/JPY':  1.00, 'AUD/USD': -0.45, 'XAU/USD': -0.45 },
  'AUD/USD': { 'EUR/USD': 0.65, 'GBP/USD':  0.55, 'USD/JPY': -0.45, 'AUD/USD':  1.00, 'XAU/USD':  0.55 },
  'XAU/USD': { 'EUR/USD': 0.40, 'GBP/USD':  0.35, 'USD/JPY': -0.45, 'AUD/USD':  0.55, 'XAU/USD':  1.00 },
};

export function correlation(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return CORRELATION_MATRIX[a]?.[b] ?? 0;
}

interface OpenTrade { pair: string; direction: 'BUY' | 'SELL' }

export interface ExposureAnalysis {
  effective_multiplier: number;
  contributions: Array<{
    symbol: string;
    direction: 'BUY' | 'SELL';
    correlation: number;
    contribution: number;
  }>;
  warning_level: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

// Compute effective exposure for a new trade given existing open trades.
// Mirrors backend/utils/correlations.js#analyseExposure.
export function analyseExposure(
  newSymbol: string,
  newDirection: 'BUY' | 'SELL',
  openTrades: OpenTrade[],
): ExposureAnalysis {
  if (!Array.isArray(openTrades) || openTrades.length === 0) {
    return { effective_multiplier: 1, contributions: [], warning_level: 'none' };
  }

  let total = 1;
  const contributions: ExposureAnalysis['contributions'] = [];

  for (const t of openTrades) {
    if (!t.pair || !t.direction) continue;
    const corr = correlation(newSymbol, t.pair);
    const dirSign = newDirection === t.direction ? 1 : -1;
    const contribution = corr * dirSign;
    if (Math.abs(contribution) >= 0.15) {
      contributions.push({
        symbol: t.pair,
        direction: t.direction,
        correlation: corr,
        contribution,
      });
      total += contribution;
    }
  }

  const effective_multiplier = Math.round(total * 10) / 10;
  const excess = effective_multiplier - 1;
  let warning_level: ExposureAnalysis['warning_level'] = 'none';
  if (excess >= 1.5)       warning_level = 'critical';
  else if (excess >= 0.8)  warning_level = 'high';
  else if (excess >= 0.4)  warning_level = 'medium';
  else if (excess >= 0.15) warning_level = 'low';

  return { effective_multiplier, contributions, warning_level };
}
