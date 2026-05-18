// ─── Per-pair configuration ──────────────────────────────────────────────────
// Everything pair-specific lives here. Indicator thresholds, SL/TP multipliers,
// session relevance, news-currency mapping — anything that should differ
// between EUR/USD and gold goes here, NOT in the engine code.
//
// pip_size:        the value of "1 pip" in price units
//                    FX majors:        0.0001
//                    Yen pairs:        0.01
//                    XAU/USD (gold):   0.1
// digits:          how many decimals to render
// typical_spread:  realistic spread in pips for the pair, used as a placeholder
//                    when the data feed doesn't publish bid/ask
// atr_floor:       a sanity floor for ATR-based math, in price units, so that
//                    a freshly-cold ATR doesn't produce absurd SL/TPs
// pip_value_per_std_lot_usd:
//                    USD value of 1 pip per 1.0 standard lot. Used by the
//                    risk calculator and trade P&L computation.
//                    EUR/USD, GBP/USD, AUD/USD: $10
//                    USD/JPY: ≈$6.67 at JPY=150 (it's actually 1000/price,
//                      so changes over time — we use a conservative estimate
//                      and document it as an estimate in the UI).
//                    XAU/USD: $10 per pip per lot with pip_size=0.1 and
//                      contract size = 100 oz.
// contract_size:   lot size in units of base currency (or oz for metals).
//                    100,000 for FX, 100 for gold.
// session_weights: per-session liquidity multipliers (used to scale confidence
//                    penalties — gold cares more about NY than yen pairs do)
// news_currencies: which currency news feeds matter for this pair
// regime_bias:     which strategy weights apply best for this pair's typical
//                    behaviour ('trend_following' | 'mean_reverting' | 'mixed')
// description:     short label for UI

const PAIRS = {
  'EUR/USD': {
    symbol: 'EUR/USD',
    display_name: 'EUR/USD',
    pip_size: 0.0001,
    digits: 5,
    typical_spread: 0.4,
    atr_floor: 0.0008,
    pip_value_per_std_lot_usd: 10,
    contract_size: 100000,
    session_weights: { LONDON_NY_OVERLAP: 1.0, LONDON: 1.0, NEW_YORK: 1.0, ASIAN: 0.5, DEAD_ZONE: 0.3 },
    news_currencies: ['EUR', 'USD'],
    regime_bias: 'mixed',
    description: 'Most liquid pair on earth. Tight spreads, mean-reverts a lot in chops.',
    enabled: true,
  },
  'GBP/USD': {
    symbol: 'GBP/USD',
    display_name: 'GBP/USD',
    pip_size: 0.0001,
    digits: 5,
    typical_spread: 0.9,
    atr_floor: 0.0012,
    pip_value_per_std_lot_usd: 10,
    contract_size: 100000,
    session_weights: { LONDON_NY_OVERLAP: 1.0, LONDON: 1.0, NEW_YORK: 0.9, ASIAN: 0.4, DEAD_ZONE: 0.25 },
    news_currencies: ['GBP', 'USD'],
    regime_bias: 'trend_following',
    description: 'Cable. More volatile than EUR/USD, prone to clean trends in London hours.',
    enabled: true,
  },
  'USD/JPY': {
    symbol: 'USD/JPY',
    display_name: 'USD/JPY',
    pip_size: 0.01,
    digits: 3,
    typical_spread: 0.6,
    atr_floor: 0.08,
    // Approximation at USD/JPY ≈ 150. Exact pip value = 1000 / current price.
    // For position sizing this is good enough; for P&L we recompute against
    // the actual close price.
    pip_value_per_std_lot_usd: 6.7,
    contract_size: 100000,
    session_weights: { ASIAN: 1.0, LONDON_NY_OVERLAP: 0.9, LONDON: 0.7, NEW_YORK: 0.9, DEAD_ZONE: 0.4 },
    news_currencies: ['JPY', 'USD'],
    regime_bias: 'trend_following',
    description: 'Yen pair. Carry-trade driver. Asian-session active. Different pip convention.',
    enabled: true,
  },
  'XAU/USD': {
    symbol: 'XAU/USD',
    display_name: 'Gold (XAU/USD)',
    pip_size: 0.1,
    digits: 2,
    typical_spread: 3.0,
    atr_floor: 1.5,
    // 100 oz × $0.10 = $10 per pip per std lot. Same as FX majors numerically,
    // but spreads are much wider so risk math is different downstream.
    pip_value_per_std_lot_usd: 10,
    contract_size: 100,
    session_weights: { LONDON_NY_OVERLAP: 1.0, NEW_YORK: 1.0, LONDON: 0.8, ASIAN: 0.5, DEAD_ZONE: 0.3 },
    news_currencies: ['USD'],
    regime_bias: 'trend_following',
    description: 'Safe-haven. Much higher vol — same indicator on gold ≠ same on EUR/USD.',
    enabled: true,
  },
};

// Primary pair: the one used for "current_signal", live-price ticker by default,
// and any single-pair legacy endpoint without ?symbol=.
const PRIMARY_SYMBOL = 'EUR/USD';

function getPair(symbol) {
  return PAIRS[symbol] || null;
}

function isSupported(symbol) {
  return !!PAIRS[symbol] && PAIRS[symbol].enabled;
}

function listEnabledSymbols() {
  return Object.keys(PAIRS).filter(s => PAIRS[s].enabled);
}

function listAllSymbols() {
  return Object.keys(PAIRS);
}

// Convert price distance into pips for a given pair.
function priceToPips(symbol, priceDelta) {
  const p = getPair(symbol);
  if (!p) return null;
  return priceDelta / p.pip_size;
}

// Convert pips into a price distance for a given pair.
function pipsToPrice(symbol, pips) {
  const p = getPair(symbol);
  if (!p) return null;
  return pips * p.pip_size;
}

// Round a price to the pair's display precision.
function roundPrice(symbol, price) {
  const p = getPair(symbol);
  if (!p || price == null) return price;
  return parseFloat(price.toFixed(p.digits));
}

module.exports = {
  PAIRS,
  PRIMARY_SYMBOL,
  getPair,
  isSupported,
  listEnabledSymbols,
  listAllSymbols,
  priceToPips,
  pipsToPrice,
  roundPrice,
};
