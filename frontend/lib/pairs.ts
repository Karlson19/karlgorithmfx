// Frontend pair metadata. Mirrors backend/config/pairs.js (a subset — only
// the fields the UI cares about). The single source of truth still lives
// in the backend; the backend's GET /api/price/pairs returns this list so
// the UI never lies about what's actually supported.
//
// We hardcode a copy here so the app renders sensibly before the first
// /api/price/pairs response lands (cold-start, offline, etc.).

export interface PairMeta {
  symbol: string;
  display_name: string;
  pip_size: number;
  digits: number;
  description: string;
}

export const PAIRS: Record<string, PairMeta> = {
  'EUR/USD': { symbol: 'EUR/USD', display_name: 'EUR/USD',         pip_size: 0.0001, digits: 5, description: 'Most liquid pair on earth.' },
  'GBP/USD': { symbol: 'GBP/USD', display_name: 'GBP/USD',         pip_size: 0.0001, digits: 5, description: 'Cable. More volatile than EUR/USD.' },
  'USD/JPY': { symbol: 'USD/JPY', display_name: 'USD/JPY',         pip_size: 0.01,   digits: 3, description: 'Yen pair. Asian-session active.' },
  'XAU/USD': { symbol: 'XAU/USD', display_name: 'Gold (XAU/USD)',  pip_size: 0.1,    digits: 2, description: 'Safe-haven. High volatility.' },
};

export const PRIMARY_SYMBOL = 'EUR/USD';

export const ENABLED_SYMBOLS = Object.keys(PAIRS);

export function getPair(symbol: string | null | undefined): PairMeta {
  if (!symbol) return PAIRS[PRIMARY_SYMBOL];
  return PAIRS[symbol] || PAIRS[PRIMARY_SYMBOL];
}

// Format a price using the pair's correct precision.
export function formatPairPrice(symbol: string | null | undefined, price: number | null | undefined): string {
  if (price == null || !isFinite(price)) return '—';
  const pair = getPair(symbol);
  return price.toFixed(pair.digits);
}

// Convert a price delta into pips for the pair (display, not signal math).
export function priceDeltaToPips(symbol: string | null | undefined, delta: number): number {
  const pair = getPair(symbol);
  return delta / pair.pip_size;
}
