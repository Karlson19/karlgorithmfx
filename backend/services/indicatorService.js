const {
  RSI, MACD, EMA, BollingerBands, ADX, Stochastic, ATR, IchimokuCloud, WilliamsR, CCI,
  bullishengulfingpattern, bearishengulfingpattern,
  bullishhammerstick, bearishhammerstick,
  hangingman, shootingstar, doji,
  morningstar, eveningstar,
  threewhitesoldiers, threeblackcrows,
  tweezerbottom, tweezertop,
  piercingline, darkcloudcover
} = require('technicalindicators');

const priceService = require('./priceService');
const cache = require('../utils/cache');

// ─── Helper: safe last value ─────────────────────────────────────────────────
// If an indicator fails to compute (insufficient data, library error), we
// flag it `available: false`. The voting layer will abstain rather than
// fabricate a direction from a fake value.
function lastOrNull(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = arr[arr.length - 1];
  return v === undefined || v === null ? null : v;
}

// ─── Core Indicators ────────────────────────────────────────────────────────

function calcRSI(closes) {
  const v = lastOrNull(RSI.calculate({ values: closes, period: 14 }));
  if (v === null) return { available: false, value: null, signal: 'NEUTRAL', description: 'No data' };
  return {
    available: true,
    value: parseFloat(v.toFixed(2)),
    signal: v < 30 ? 'BUY' : v > 70 ? 'SELL' : 'NEUTRAL',
    description: v < 30 ? 'Oversold' : v > 70 ? 'Overbought' : 'Neutral',
  };
}

function calcMACD(closes) {
  const last = lastOrNull(MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  }));
  if (!last || typeof last.histogram !== 'number') {
    return { available: false, value: 0, signal: 'NEUTRAL', histogram: 0, signal_line: 0 };
  }
  const hist = last.histogram;
  return {
    available: true,
    value: parseFloat((last.MACD || 0).toFixed(6)),
    // Strict sign: exactly zero is neutral. signalService uses the same
    // convention so the two layers agree.
    signal: hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'NEUTRAL',
    histogram: parseFloat(hist.toFixed(6)),
    signal_line: parseFloat((last.signal || 0).toFixed(6)),
  };
}

function calcEMA(closes, period) {
  const v = lastOrNull(EMA.calculate({ values: closes, period }));
  if (v === null) {
    return { available: false, value: null, signal: 'NEUTRAL' };
  }
  const lastClose = closes[closes.length - 1];
  return {
    available: true,
    value: parseFloat(v.toFixed(5)),
    // Compare against the LAST CLOSED candle, not a live tick.
    signal: lastClose > v ? 'BUY' : lastClose < v ? 'SELL' : 'NEUTRAL',
  };
}

function calcBollingerBands(closes) {
  const last = lastOrNull(BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 }));
  const lastClose = closes[closes.length - 1];
  if (!last) {
    return { available: false, upper: null, middle: null, lower: null, signal: 'NEUTRAL', width: null, width_pct: null };
  }
  const width = last.upper - last.lower;
  return {
    available: true,
    upper:  parseFloat(last.upper.toFixed(5)),
    middle: parseFloat(last.middle.toFixed(5)),
    lower:  parseFloat(last.lower.toFixed(5)),
    signal: lastClose <= last.lower ? 'BUY' : lastClose >= last.upper ? 'SELL' : 'NEUTRAL',
    width:     parseFloat(width.toFixed(5)),
    // Width as % of middle — used for regime detection.
    width_pct: last.middle > 0 ? parseFloat(((width / last.middle) * 100).toFixed(4)) : 0,
  };
}

function calcADX(highs, lows, closes) {
  const last = lastOrNull(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }));
  if (!last || typeof last.adx !== 'number') {
    return { available: false, value: null, trending: false, strong: false };
  }
  const v = last.adx;
  return {
    available: true,
    value: parseFloat(v.toFixed(2)),
    trending: v > 25,
    strong:   v > 40,
  };
}

function calcStochastic(highs, lows, closes) {
  const last = lastOrNull(Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 }));
  if (!last) return { available: false, k: null, d: null, signal: 'NEUTRAL' };
  return {
    available: true,
    k: parseFloat(last.k.toFixed(2)),
    d: parseFloat(last.d.toFixed(2)),
    signal: last.k < 20 ? 'BUY' : last.k > 80 ? 'SELL' : 'NEUTRAL',
  };
}

function calcATR(highs, lows, closes, period = 14) {
  const v = lastOrNull(ATR.calculate({ high: highs, low: lows, close: closes, period }));
  if (v === null) {
    return { available: false, value: null, pips: null };
  }
  return {
    available: true,
    value: parseFloat(v.toFixed(5)),
    pips:  Math.round(v * 10000),
  };
}

function calcWilliamsR(highs, lows, closes) {
  const v = lastOrNull(WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 }));
  if (v === null) return { available: false, value: null, signal: 'NEUTRAL', description: 'No data' };
  return {
    available: true,
    value: parseFloat(v.toFixed(2)),
    signal: v <= -80 ? 'BUY' : v >= -20 ? 'SELL' : 'NEUTRAL',
    description: v <= -80 ? 'Oversold' : v >= -20 ? 'Overbought' : 'Neutral',
  };
}

function calcCCI(highs, lows, closes) {
  const v = lastOrNull(CCI.calculate({ high: highs, low: lows, close: closes, period: 20 }));
  if (v === null) return { available: false, value: null, signal: 'NEUTRAL', description: 'No data' };
  return {
    available: true,
    value: parseFloat(v.toFixed(2)),
    signal: v < -100 ? 'BUY' : v > 100 ? 'SELL' : 'NEUTRAL',
    description: v < -100 ? 'Oversold' : v > 100 ? 'Overbought' : 'Neutral',
  };
}

function calcIchimoku(highs, lows, closes) {
  const last = lastOrNull(IchimokuCloud.calculate({
    high: highs, low: lows,
    conversionPeriod: 9, basePeriod: 26,
    spanPeriod: 52, displacement: 26,
  }));
  if (!last) {
    return {
      available: false, tenkan: null, kijun: null, span_a: null, span_b: null,
      signal: 'NEUTRAL', cloud_position: 'UNKNOWN', description: 'No data',
    };
  }
  const lastClose = closes[closes.length - 1];
  const tenkan = last.conversion;
  const kijun  = last.base;
  const spanA  = last.spanA;
  const spanB  = last.spanB;

  const aboveCloud = lastClose > Math.max(spanA, spanB);
  const belowCloud = lastClose < Math.min(spanA, spanB);
  const inCloud = !aboveCloud && !belowCloud;

  let signal = 'NEUTRAL';
  if (aboveCloud && tenkan > kijun) signal = 'BUY';
  else if (belowCloud && tenkan < kijun) signal = 'SELL';

  return {
    available: true,
    tenkan: parseFloat(tenkan.toFixed(5)),
    kijun:  parseFloat(kijun.toFixed(5)),
    span_a: parseFloat(spanA.toFixed(5)),
    span_b: parseFloat(spanB.toFixed(5)),
    signal,
    cloud_position: aboveCloud ? 'ABOVE' : belowCloud ? 'BELOW' : 'INSIDE',
    description: aboveCloud
      ? 'Price above cloud — bullish'
      : belowCloud
        ? 'Price below cloud — bearish'
        : 'Price inside cloud — neutral',
  };
}

// ─── Pivot Points (yesterday's closed daily H/L/C) ────────────────────────────
async function calcPivotPoints() {
  try {
    // Fetch enough days that we always have at least one CLOSED day after
    // priceService strips the forming bar.
    const dailyCandles = await priceService.fetchHistoricalData('1day', 5);
    if (!dailyCandles || dailyCandles.length < 1) return null;

    // priceService now drops the forming candle, so the LAST entry IS
    // the most recently closed day.
    const prev = dailyCandles[dailyCandles.length - 1];
    const H = prev.high, L = prev.low, C = prev.close;
    const PP = (H + L + C) / 3;
    return {
      pp: parseFloat(PP.toFixed(5)),
      r1: parseFloat((2 * PP - L).toFixed(5)),
      r2: parseFloat((PP + (H - L)).toFixed(5)),
      r3: parseFloat((H + 2 * (PP - L)).toFixed(5)),
      s1: parseFloat((2 * PP - H).toFixed(5)),
      s2: parseFloat((PP - (H - L)).toFixed(5)),
      s3: parseFloat((L - 2 * (H - PP)).toFixed(5)),
      // Caveat: provider treats UTC midnight as the day boundary, which is
      // not the NY-close convention most retail traders use. Treat these
      // levels as approximate, not gospel.
      basis: 'utc_daily',
    };
  } catch {
    return null;
  }
}

// ─── Candlestick Pattern Detection ───────────────────────────────────────────
function calcCandlestickPatterns(opens, highs, lows, closes) {
  const input = { open: opens, high: highs, low: lows, close: closes };
  const bullish = [];
  const bearish = [];

  const check = (fn, name, side) => {
    try {
      const result = fn(input);
      const hit = Array.isArray(result) ? result[result.length - 1] : !!result;
      if (hit) (side === 'bull' ? bullish : bearish).push(name);
    } catch { /* library may throw on small windows */ }
  };

  check(bullishengulfingpattern, 'Bullish Engulfing', 'bull');
  check(bearishengulfingpattern, 'Bearish Engulfing', 'bear');
  check(bullishhammerstick,      'Hammer', 'bull');
  check(bearishhammerstick,      'Inverted Hammer', 'bear');
  check(morningstar,             'Morning Star', 'bull');
  check(eveningstar,             'Evening Star', 'bear');
  check(threewhitesoldiers,      'Three White Soldiers', 'bull');
  check(threeblackcrows,         'Three Black Crows', 'bear');
  check(tweezerbottom,           'Tweezer Bottom', 'bull');
  check(tweezertop,              'Tweezer Top', 'bear');
  check(piercingline,            'Piercing Line', 'bull');
  check(darkcloudcover,          'Dark Cloud Cover', 'bear');
  check(hangingman,              'Hanging Man', 'bear');
  check(shootingstar,            'Shooting Star', 'bear');

  let dojiVal = false;
  try {
    const r = doji(input);
    dojiVal = Array.isArray(r) ? !!r[r.length - 1] : !!r;
  } catch {}

  const signal = bullish.length > bearish.length ? 'BUY'
    : bearish.length > bullish.length ? 'SELL'
    : 'NEUTRAL';

  return { bullish, bearish, doji: !!dojiVal, signal };
}

// ─── Fibonacci & Support/Resistance ──────────────────────────────────────────
function calcFibonacci(highs, lows) {
  // Use a longer lookback (200 H1 bars ~= 8 days) so the swing is meaningful.
  const lookback = Math.min(200, highs.length);
  const swingHigh = Math.max(...highs.slice(-lookback));
  const swingLow  = Math.min(...lows.slice(-lookback));
  const diff = swingHigh - swingLow;
  return {
    swing_high: parseFloat(swingHigh.toFixed(5)),
    swing_low:  parseFloat(swingLow.toFixed(5)),
    levels: {
      '0':    parseFloat(swingLow.toFixed(5)),
      '23.6': parseFloat((swingLow + diff * 0.236).toFixed(5)),
      '38.2': parseFloat((swingLow + diff * 0.382).toFixed(5)),
      '50':   parseFloat((swingLow + diff * 0.500).toFixed(5)),
      '61.8': parseFloat((swingLow + diff * 0.618).toFixed(5)),
      '100':  parseFloat(swingHigh.toFixed(5)),
    },
  };
}

// Tighter S/R: scan a wider window with a real fractal definition, cluster
// using ATR-scaled buckets instead of fixed 10-pip rounding.
function calcSupportResistance(highs, lows, atrValue) {
  const window = 100;
  const h = highs.slice(-window);
  const l = lows.slice(-window);
  // Cluster radius: tighter of (½ ATR) or 8 pips. Falls back to 5 pips if
  // ATR is unavailable so behaviour is well-defined on a cold start.
  const clusterRadius = atrValue && atrValue > 0
    ? Math.min(atrValue * 0.5, 0.0008)
    : 0.0005;

  const resistance = [];
  const support = [];
  for (let i = 2; i < h.length - 2; i++) {
    if (h[i] > h[i-1] && h[i] > h[i+1] && h[i] > h[i-2] && h[i] > h[i+2]) {
      const v = h[i];
      if (!resistance.some(x => Math.abs(x - v) < clusterRadius)) {
        resistance.push(parseFloat(v.toFixed(5)));
      }
    }
    if (l[i] < l[i-1] && l[i] < l[i+1] && l[i] < l[i-2] && l[i] < l[i+2]) {
      const v = l[i];
      if (!support.some(x => Math.abs(x - v) < clusterRadius)) {
        support.push(parseFloat(v.toFixed(5)));
      }
    }
  }
  return {
    // Resistance: nearest first (ascending) so [0] is the closest one above.
    resistance: resistance.sort((a, b) => a - b).slice(0, 3),
    // Support: nearest first (descending) so [0] is the closest one below.
    support:    support.sort((a, b) => b - a).slice(0, 3),
  };
}

// ─── Regime detection (now actually uses Bollinger) ───────────────────────────
// Three regimes:
//   TRENDING — directional momentum dominates (ADX > 25)
//   VOLATILE — wide bands, no clear direction (Bollinger width spike)
//   RANGING  — quiet, mean-reverting (low ADX, narrow bands)
function detectMarketCondition(adx, bollinger) {
  const adxVal = adx && adx.available ? adx.value : null;
  const widthPct = bollinger && bollinger.available ? bollinger.width_pct : null;

  if (adxVal !== null && adxVal > 25) return 'TRENDING';
  // Bollinger width > ~0.4% of price on EUR/USD H1 = unusual expansion.
  if (widthPct !== null && widthPct > 0.40) return 'VOLATILE';
  if (adxVal !== null && adxVal < 20) return 'RANGING';
  // Default to RANGING when uncertain — it's the safest assumption for
  // SL/TP sizing (smaller multipliers).
  return 'RANGING';
}

// ─── Multi-Timeframe Trend Bias ───────────────────────────────────────────────
async function getTimeframeBias(interval, outputsize) {
  try {
    const candles = await priceService.fetchHistoricalData(interval, outputsize);
    if (!candles || candles.length < 50) return 'NEUTRAL';

    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const ema20 = lastOrNull(EMA.calculate({ values: closes, period: 20 }));
    const ema50 = lastOrNull(EMA.calculate({ values: closes, period: 50 }));
    const adxLast = lastOrNull(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }));
    const rsi = lastOrNull(RSI.calculate({ values: closes, period: 14 }));

    if (ema20 === null || ema50 === null) return 'NEUTRAL';

    const lastClose = closes[closes.length - 1];
    const adxVal = adxLast && typeof adxLast.adx === 'number' ? adxLast.adx : null;

    // Below a meaningful trend strength threshold, declare neutrality
    // instead of inventing a direction.
    if (adxVal === null || adxVal < 20) return 'NEUTRAL';

    let bull = 0, bear = 0;
    if (lastClose > ema20) bull++; else bear++;
    if (lastClose > ema50) bull++; else bear++;
    if (ema20 > ema50)     bull++; else bear++;
    if (rsi !== null) {
      if (rsi > 55) bull++;
      else if (rsi < 45) bear++;
      // RSI between 45-55 is too close to midline — abstain.
    }

    if (bull >= 3 && bull > bear) return 'BUY';
    if (bear >= 3 && bear > bull) return 'SELL';
    return 'NEUTRAL';
  } catch {
    return 'NEUTRAL';
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────
async function calculateIndicators(interval = '1h') {
  const cacheKey = `indicators_v3_${interval}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const candles = await priceService.fetchHistoricalData(interval, 300);
  if (!candles || candles.length < 60) throw new Error('Not enough candle data');

  const opens  = candles.map(c => c.open);
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const lastClose = closes[closes.length - 1];

  const [pivotPoints, h4Bias, m15Bias] = await Promise.all([
    calcPivotPoints(),
    getTimeframeBias('4h', 100),
    getTimeframeBias('15min', 200),
  ]);

  const rsi        = calcRSI(closes);
  const macd       = calcMACD(closes);
  const ema20      = calcEMA(closes, 20);
  const ema50      = calcEMA(closes, 50);
  const ema200     = closes.length >= 200
    ? calcEMA(closes, 200)
    : { available: false, value: null, signal: 'NEUTRAL' };
  const bollinger  = calcBollingerBands(closes);
  const adx        = calcADX(highs, lows, closes);
  const stochastic = calcStochastic(highs, lows, closes);
  const atr        = calcATR(highs, lows, closes);
  const williamsR  = calcWilliamsR(highs, lows, closes);
  const cci        = calcCCI(highs, lows, closes);
  const ichimoku   = calcIchimoku(highs, lows, closes);
  const candlePatterns   = calcCandlestickPatterns(opens, highs, lows, closes);
  const fibonacci        = calcFibonacci(highs, lows);
  const support_resistance = calcSupportResistance(highs, lows, atr.value);
  const market_condition = detectMarketCondition(adx, bollinger);

  // H1 bias — ABSTAIN if EMA50 is unavailable rather than fabricate.
  const h1Bias = ema50.available
    ? (lastClose > ema50.value ? 'BUY' : lastClose < ema50.value ? 'SELL' : 'NEUTRAL')
    : 'NEUTRAL';

  const mtf = {
    h4_bias:  h4Bias,
    h1_bias:  h1Bias,
    m15_bias: m15Bias,
    aligned:  h4Bias !== 'NEUTRAL' && h4Bias === m15Bias,
    description: h4Bias === 'NEUTRAL'
      ? 'H4 ranging — wait for direction'
      : h4Bias === m15Bias
        ? `All timeframes aligned ${h4Bias} — high confidence`
        : `H4: ${h4Bias} · M15: ${m15Bias} — mixed signals`,
  };

  const indicators = {
    rsi, macd, ema20, ema50, ema200, bollinger,
    adx, stochastic, atr, williamsR, cci, ichimoku,
    candlePatterns, fibonacci, support_resistance,
    pivot_points: pivotPoints,
    market_condition, mtf,
    // Reference price for all downstream comparisons. This is the canonical
    // closed-candle close — it MUST match the price the voting layer uses.
    reference_price: lastClose,
    candle_time: candles[candles.length - 1].time,
    timestamp: new Date().toISOString(),
  };

  // TTL never outlives the candle. Once a new H1 closes, recompute.
  const ttl = Math.min(priceService.secondsUntilCandleClose(interval), 300);
  cache.set(cacheKey, indicators, ttl);
  return indicators;
}

module.exports = { calculateIndicators };
