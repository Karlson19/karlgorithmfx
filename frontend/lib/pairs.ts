// Frontend pair metadata. Mirrors backend/config/pairs.js (the subset the
// UI needs). Single source of truth still lives in the backend — but we
// hardcode a copy so the app renders sensibly before the first
// /api/price/pairs response lands (cold-start, offline, etc.).

export interface PairMeta {
  symbol: string;
  display_name: string;
  pip_size: number;
  digits: number;
  description: string;
  // Phase 4 additions for risk math
  pip_value_per_std_lot_usd: number;
  contract_size: number;
}

export const PAIRS: Record<string, PairMeta> = {
  'EUR/USD': {
    symbol: 'EUR/USD', display_name: 'EUR/USD',
    pip_size: 0.0001, digits: 5,
    pip_value_per_std_lot_usd: 10, contract_size: 100000,
    description: 'Most liquid pair on earth.',
  },
  'GBP/USD': {
    symbol: 'GBP/USD', display_name: 'GBP/USD',
    pip_size: 0.0001, digits: 5,
    pip_value_per_std_lot_usd: 10, contract_size: 100000,
    description: 'Cable. More volatile than EUR/USD.',
  },
  'USD/JPY': {
    symbol: 'USD/JPY', display_name: 'USD/JPY',
    pip_size: 0.01, digits: 3,
    // Estimate at JPY ≈ 150. Exact value = 1000 / current price.
    pip_value_per_std_lot_usd: 6.7, contract_size: 100000,
    description: 'Yen pair. Asian-session active.',
  },
  'XAU/USD': {
    symbol: 'XAU/USD', display_name: 'Gold (XAU/USD)',
    pip_size: 0.1, digits: 2,
    pip_value_per_std_lot_usd: 10, contract_size: 100,
    description: 'Safe-haven. High volatility.',
  },
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

// Convert a price delta into pips for the pair.
export function priceDeltaToPips(symbol: string | null | undefined, delta: number): number {
  const pair = getPair(symbol);
  return delta / pair.pip_size;
}

// Pips between two prices (always positive).
export function pipsBetween(symbol: string | null | undefined, a: number, b: number): number {
  return Math.abs(priceDeltaToPips(symbol, a - b));
}

// ─── Position sizing ─────────────────────────────────────────────────────────
// recommendedLotSize: given account balance, risk %, and SL distance in pips,
// return the lot size that puts exactly (balance × risk%) at risk.
//
// Formula: risk_usd = pips × pip_value_per_std_lot × lot_size
//          ⇒ lot_size = risk_usd / (pips × pip_value_per_std_lot)
//
// Returns null if inputs are invalid. Capped at 100 lots as a sanity floor —
// no retail account should ever risk >100 std lots on one trade and if our
// math accidentally produces that, something upstream is wrong.
export function recommendedLotSize(
  symbol: string | null | undefined,
  accountBalance: number,
  riskPercent: number,
  slPips: number,
): number | null {
  if (!accountBalance || !riskPercent || !slPips || slPips <= 0) return null;
  const pair = getPair(symbol);
  const riskUsd = accountBalance * (riskPercent / 100);
  const raw = riskUsd / (slPips * pair.pip_value_per_std_lot_usd);
  if (!isFinite(raw) || raw <= 0) return null;
  return Math.min(parseFloat(raw.toFixed(2)), 100);
}

// USD value of 1 pip for a given lot size on the pair.
export function pipValueUsd(symbol: string | null | undefined, lotSize: number): number {
  const pair = getPair(symbol);
  return pair.pip_value_per_std_lot_usd * lotSize;
}

// USD P&L between two prices for a given direction and lot size on the pair.
export function pnlUsd(
  symbol: string | null | undefined,
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  exitPrice: number,
  lotSize: number,
): number {
  const pair = getPair(symbol);
  const dir = direction === 'BUY' ? 1 : -1;
  const priceDiff = (exitPrice - entryPrice) * dir;
  const pips = priceDiff / pair.pip_size;
  return parseFloat((pips * pair.pip_value_per_std_lot_usd * lotSize).toFixed(2));
}

// ─── Risk of Ruin (Kelly-adjacent) ───────────────────────────────────────────
// Probability that a fixed-fractional bettor depletes their account given
// win rate, win/loss payout ratio, and risk per trade.
//
// Uses the standard formula (Vince, "Mathematics of Money Management"):
//   if win_rate × payout_ratio - (1 - win_rate) <= 0  → ruin is ~100%
//   else                                              → R = ((1-edge)/(1+edge))^n
//
// Where n = number of "risk units" the account holds (= 100/risk_pct for
// a 100% drawdown definition of ruin). It's an approximation that holds
// well for small risk per trade (≤2%).
//
// Returns a probability 0-1.
export function riskOfRuin(winRate: number, payoutRatio: number, riskPercent: number): number {
  const p = winRate / 100;
  const q = 1 - p;
  if (riskPercent <= 0 || riskPercent > 100) return 1;
  if (payoutRatio <= 0) return 1;
  const edge = p * payoutRatio - q;
  if (edge <= 0) return 1;
  // Edge per trade as fraction of risk unit
  const a = (1 - edge) / (1 + edge);
  // Number of risk units in the account (how many losses to wipe it out).
  // We define "ruin" as a 50% drawdown which is when most people quit
  // psychologically. Adjust the divisor below to change that threshold.
  const drawdownTrigger = 50;  // %
  const n = drawdownTrigger / riskPercent;
  const ruin = Math.pow(a, n);
  return Math.max(0, Math.min(1, ruin));
}
