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
const { getPair, PRIMARY_SYMBOL } = require('../config/pairs');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function lastOrNull(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = arr[arr.length - 1];
  return v === undefined || v === null ? null : v;
}

// All numeric outputs round to the pair's display precision so we don't
// emit yen-pair values to 5 decimals or gold to 5 decimals.
function fixPrice(symbol, n) {
  if (n == null || !isFinite(n)) return null;
  const p = getPair(symbol);
  return parseFloat(n.toFixed(p ? p.digits : 5));
}

// ─── Core Indicators (all symbol-aware via fixPrice) ─────────────────────────

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
    signal: hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'NEUTRAL',
    histogram: parseFloat(hist.toFixed(6)),
    signal_line: parseFloat((last.signal || 0).toFixed(6)),
  };
}

function calcEMA(symbol, closes, period) {
  const v = lastOrNull(EMA.calculate({ values: closes, period }));
  if (v === null) return { available: false, value: null, signal: 'NEUTRAL' };
  const lastClose = closes[closes.length - 1];
  return {
    available: true,
    value: fixPrice(symbol, v),
    signal: lastClose > v ? 'BUY' : lastClose < v ? 'SELL' : 'NEUTRAL',
  };
}

function calcBollingerBands(symbol, closes) {
  const last = lastOrNull(BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 }));
  const lastClose = closes[closes.length - 1];
  if (!last) {
    return { available: false, upper: null, middle: null, lower: null, signal: 'NEUTRAL', width: null, width_pct: null };
  }
  const width = last.upper - last.lower;
  return {
    available: true,
    upper:  fixPrice(symbol, last.upper),
    middle: fixPrice(symbol, last.middle),
    lower:  fixPrice(symbol, last.lower),
    signal: lastClose <= last.lower ? 'BUY' : lastClose >= last.upper ? 'SELL' : 'NEUTRAL',
    width:     fixPrice(symbol, width),
    width_pct: last.middle > 0 ? parseFloat(((width / last.middle) * 100).toFixed(4)) : 0,
  };
}

function calcADX(highs, lows, closes) {
  const last = lastOrNull(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }));
  if (!last || typeof last.adx !== 'number') {
    return { available: false, value: null, trending: false, strong: false };
  }
  const v = last.adx;
  return { available: true, value: parseFloat(v.toFixed(2)), trending: v > 25, strong: v > 40 };
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

function calcATR(symbol, highs, lows, closes, period = 14) {
  const v = lastOrNull(ATR.calculate({ high: highs, low: lows, close: closes, period }));
  if (v === null) return { available: false, value: null, pips: null };
  const pair = getPair(symbol);
  const pipSize = pair ? pair.pip_size : 0.0001;
  // Clamp to the pair-specific floor — a freshly-cold ATR can otherwise
  // produce SL distances of a few cents on gold.
  const floor = pair ? pair.atr_floor : 0.0008;
  const value = Math.max(v, floor);
  return {
    available: true,
    value: fixPrice(symbol, value),
    pips:  Math.round(value / pipSize),
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

function calcIchimoku(symbol, highs, lows, closes) {
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

  let signal = 'NEUTRAL';
  if (aboveCloud && tenkan > kijun) signal = 'BUY';
  else if (belowCloud && tenkan < kijun) signal = 'SELL';

  return {
    available: true,
    tenkan: fixPrice(symbol, tenkan),
    kijun:  fixPrice(symbol, kijun),
    span_a: fixPrice(symbol, spanA),
    span_b: fixPrice(symbol, spanB),
    signal,
    cloud_position: aboveCloud ? 'ABOVE' : belowCloud ? 'BELOW' : 'INSIDE',
    description: aboveCloud
      ? 'Price above cloud — bullish'
      : belowCloud
        ? 'Price below cloud — bearish'
        : 'Price inside cloud — neutral',
  };
}

// ─── Pivot Points (NY-close convention) ──────────────────────────────────────
// Most retail traders use the NY-close (17:00 ET) as the daily boundary
// for pivots, not UTC midnight. We synthesise an "NY day" by aggregating
// H1 candles spanning the prior NY close → current NY close window.
//
// 17:00 ET = 22:00 UTC (standard time) or 21:00 UTC (daylight savings).
// We use a fixed 22:00 UTC boundary as a sane approximation — the
// difference of one hour during DST shifts is tiny and pivots are
// approximate-by-nature levels anyway.
async function calcPivotPoints(symbol) {
  try {
    // Fetch enough H1 candles to cover at least the previous "NY day"
    // (24 H1 candles back from now, plus padding for closed-candle drop).
    const h1Candles = await priceService.fetchHistoricalData('1h', 50, symbol);
    if (!h1Candles || h1Candles.length < 24) return null;

    // Find the most recent NY-close boundary (22:00 UTC).
    // Walk backwards through candles, group them into NY-days, pick the
    // most recently completed one.
    const NY_CLOSE_UTC_HOUR = 22;
    const nowSec = Math.floor(Date.now() / 1000);
    const todayDate = new Date(nowSec * 1000);
    todayDate.setUTCHours(NY_CLOSE_UTC_HOUR, 0, 0, 0);
    let lastNyClose = Math.floor(todayDate.getTime() / 1000);
    if (lastNyClose > nowSec) lastNyClose -= 86400; // today's NY close hasn't happened yet
    const prevNyClose = lastNyClose - 86400;

    // Gather candles where prevNyClose <= candle.time < lastNyClose
    const dayCandles = h1Candles.filter(c => c.time >= prevNyClose && c.time < lastNyClose);
    if (dayCandles.length < 6) {
      // Fall back to UTC-daily if we don't have enough H1 history (e.g.,
      // cold start). Better an approximation than nothing.
      const dailyCandles = await priceService.fetchHistoricalData('1day', 5, symbol);
      if (!dailyCandles || dailyCandles.length < 1) return null;
      const prev = dailyCandles[dailyCandles.length - 1];
      const H = prev.high, L = prev.low, C = prev.close;
      const PP = (H + L + C) / 3;
      return {
        pp: fixPrice(symbol, PP),
        r1: fixPrice(symbol, 2 * PP - L),
        r2: fixPrice(symbol, PP + (H - L)),
        r3: fixPrice(symbol, H + 2 * (PP - L)),
        s1: fixPrice(symbol, 2 * PP - H),
        s2: fixPrice(symbol, PP - (H - L)),
        s3: fixPrice(symbol, L - 2 * (H - PP)),
        basis: 'utc_daily_fallback',
      };
    }

    const H = Math.max(...dayCandles.map(c => c.high));
    const L = Math.min(...dayCandles.map(c => c.low));
    const C = dayCandles[dayCandles.length - 1].close;
    const PP = (H + L + C) / 3;
    return {
      pp: fixPrice(symbol, PP),
      r1: fixPrice(symbol, 2 * PP - L),
      r2: fixPrice(symbol, PP + (H - L)),
      r3: fixPrice(symbol, H + 2 * (PP - L)),
      s1: fixPrice(symbol, 2 * PP - H),
      s2: fixPrice(symbol, PP - (H - L)),
      s3: fixPrice(symbol, L - 2 * (H - PP)),
      basis: 'ny_close_22utc',
    };
  } catch {
    return null;
  }
}

// ─── Candlestick Patterns ────────────────────────────────────────────────────
function calcCandlestickPatterns(opens, highs, lows, closes) {
  const input = { open: opens, high: highs, low: lows, close: closes };
  const bullish = [], bearish = [];

  const check = (fn, name, side) => {
    try {
      const result = fn(input);
      const hit = Array.isArray(result) ? result[result.length - 1] : !!result;
      if (hit) (side === 'bull' ? bullish : bearish).push(name);
    } catch {}
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
  try { const r = doji(input); dojiVal = Array.isArray(r) ? !!r[r.length - 1] : !!r; } catch {}

  const signal = bullish.length > bearish.length ? 'BUY'
    : bearish.length > bullish.length ? 'SELL' : 'NEUTRAL';
  return { bullish, bearish, doji: !!dojiVal, signal };
}

// ─── Fibonacci & S/R (per-pair) ──────────────────────────────────────────────
function calcFibonacci(symbol, highs, lows) {
  const lookback = Math.min(200, highs.length);
  const swingHigh = Math.max(...highs.slice(-lookback));
  const swingLow  = Math.min(...lows.slice(-lookback));
  const diff = swingHigh - swingLow;
  return {
    swing_high: fixPrice(symbol, swingHigh),
    swing_low:  fixPrice(symbol, swingLow),
    levels: {
      '0':    fixPrice(symbol, swingLow),
      '23.6': fixPrice(symbol, swingLow + diff * 0.236),
      '38.2': fixPrice(symbol, swingLow + diff * 0.382),
      '50':   fixPrice(symbol, swingLow + diff * 0.500),
      '61.8': fixPrice(symbol, swingLow + diff * 0.618),
      '100':  fixPrice(symbol, swingHigh),
    },
  };
}

function calcSupportResistance(symbol, highs, lows, atrValue) {
  const pair = getPair(symbol);
  const pipSize = pair ? pair.pip_size : 0.0001;
  const window = 100;
  const h = highs.slice(-window);
  const l = lows.slice(-window);

  // Cluster radius: ½ ATR, but not larger than 8 pips of the pair.
  const maxClusterPrice = 8 * pipSize;
  const clusterRadius = atrValue && atrValue > 0
    ? Math.min(atrValue * 0.5, maxClusterPrice)
    : 5 * pipSize;

  const resistance = [], support = [];
  for (let i = 2; i < h.length - 2; i++) {
    if (h[i] > h[i-1] && h[i] > h[i+1] && h[i] > h[i-2] && h[i] > h[i+2]) {
      const v = h[i];
      if (!resistance.some(x => Math.abs(x - v) < clusterRadius)) {
        resistance.push(fixPrice(symbol, v));
      }
    }
    if (l[i] < l[i-1] && l[i] < l[i+1] && l[i] < l[i-2] && l[i] < l[i+2]) {
      const v = l[i];
      if (!support.some(x => Math.abs(x - v) < clusterRadius)) {
        support.push(fixPrice(symbol, v));
      }
    }
  }
  return {
    resistance: resistance.sort((a, b) => a - b).slice(0, 3),
    support:    support.sort((a, b) => b - a).slice(0, 3),
  };
}

// ─── Regime detection ────────────────────────────────────────────────────────
function detectMarketCondition(adx, bollinger) {
  const adxVal = adx && adx.available ? adx.value : null;
  const widthPct = bollinger && bollinger.available ? bollinger.width_pct : null;

  if (adxVal !== null && adxVal > 25) return 'TRENDING';
  if (widthPct !== null && widthPct > 0.40) return 'VOLATILE';
  if (adxVal !== null && adxVal < 20) return 'RANGING';
  return 'RANGING';
}

// ─── Multi-Timeframe Trend Bias (per-pair) ───────────────────────────────────
async function getTimeframeBias(interval, outputsize, symbol) {
  try {
    const candles = await priceService.fetchHistoricalData(interval, outputsize, symbol);
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
    if (adxVal === null || adxVal < 20) return 'NEUTRAL';

    let bull = 0, bear = 0;
    if (lastClose > ema20) bull++; else bear++;
    if (lastClose > ema50) bull++; else bear++;
    if (ema20 > ema50)     bull++; else bear++;
    if (rsi !== null) {
      if (rsi > 55) bull++;
      else if (rsi < 45) bear++;
    }

    if (bull >= 3 && bull > bear) return 'BUY';
    if (bear >= 3 && bear > bull) return 'SELL';
    return 'NEUTRAL';
  } catch {
    return 'NEUTRAL';
  }
}

// ─── Main Export (per-pair) ──────────────────────────────────────────────────
async function calculateIndicators(interval = '1h', symbol = PRIMARY_SYMBOL) {
  const sym = priceService.resolveSymbol(symbol);
  const cacheKey = `indicators_v4_${sym}_${interval}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const candles = await priceService.fetchHistoricalData(interval, 300, sym);
  if (!candles || candles.length < 60) throw new Error(`Not enough candle data for ${sym}`);

  const opens  = candles.map(c => c.open);
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const lastClose = closes[closes.length - 1];

  const [pivotPoints, h4Bias, m15Bias] = await Promise.all([
    calcPivotPoints(sym),
    getTimeframeBias('4h', 100, sym),
    getTimeframeBias('15min', 200, sym),
  ]);

  const rsi        = calcRSI(closes);
  const macd       = calcMACD(closes);
  const ema20      = calcEMA(sym, closes, 20);
  const ema50      = calcEMA(sym, closes, 50);
  const ema200     = closes.length >= 200
    ? calcEMA(sym, closes, 200)
    : { available: false, value: null, signal: 'NEUTRAL' };
  const bollinger  = calcBollingerBands(sym, closes);
  const adx        = calcADX(highs, lows, closes);
  const stochastic = calcStochastic(highs, lows, closes);
  const atr        = calcATR(sym, highs, lows, closes);
  const williamsR  = calcWilliamsR(highs, lows, closes);
  const cci        = calcCCI(highs, lows, closes);
  const ichimoku   = calcIchimoku(sym, highs, lows, closes);
  const candlePatterns   = calcCandlestickPatterns(opens, highs, lows, closes);
  const fibonacci        = calcFibonacci(sym, highs, lows);
  const support_resistance = calcSupportResistance(sym, highs, lows, atr.value);
  const market_condition = detectMarketCondition(adx, bollinger);

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
    symbol: sym,
    rsi, macd, ema20, ema50, ema200, bollinger,
    adx, stochastic, atr, williamsR, cci, ichimoku,
    candlePatterns, fibonacci, support_resistance,
    pivot_points: pivotPoints,
    market_condition, mtf,
    reference_price: lastClose,
    candle_time: candles[candles.length - 1].time,
    timestamp: new Date().toISOString(),
  };

  const ttl = Math.min(priceService.secondsUntilCandleClose(interval), 300);
  cache.set(cacheKey, indicators, ttl);
  return indicators;
}

module.exports = { calculateIndicators };
