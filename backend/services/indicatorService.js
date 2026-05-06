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

// ─── Core Indicators ────────────────────────────────────────────────────────

function calcRSI(closes) {
  const values = RSI.calculate({ values: closes, period: 14 });
  const val = values[values.length - 1] || 50;
  return {
    value: parseFloat(val.toFixed(2)),
    signal: val < 30 ? 'BUY' : val > 70 ? 'SELL' : 'NEUTRAL',
    description: val < 30 ? 'Oversold' : val > 70 ? 'Overbought' : 'Neutral'
  };
}

function calcMACD(closes) {
  const values = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false
  });
  const last = values[values.length - 1] || {};
  const hist = last.histogram || 0;
  return {
    value: parseFloat((last.MACD || 0).toFixed(6)),
    signal: hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'NEUTRAL',
    histogram: parseFloat(hist.toFixed(6)),
    signal_line: parseFloat((last.signal || 0).toFixed(6))
  };
}

function calcEMA(closes, period) {
  const values = EMA.calculate({ values: closes, period });
  const val = values[values.length - 1] || closes[closes.length - 1];
  const currentPrice = closes[closes.length - 1];
  return { value: parseFloat(val.toFixed(5)), signal: currentPrice > val ? 'BUY' : 'SELL' };
}

function calcBollingerBands(closes) {
  const values = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const last = values[values.length - 1] || {};
  const p = closes[closes.length - 1];
  const upper = last.upper || p, lower = last.lower || p, middle = last.middle || p;
  return {
    upper: parseFloat(upper.toFixed(5)),
    middle: parseFloat(middle.toFixed(5)),
    lower: parseFloat(lower.toFixed(5)),
    signal: p <= lower ? 'BUY' : p >= upper ? 'SELL' : 'NEUTRAL',
    width: parseFloat((upper - lower).toFixed(5))
  };
}

function calcADX(highs, lows, closes) {
  const values = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const last = values[values.length - 1] || {};
  const val = last.adx || 20;
  return { value: parseFloat(val.toFixed(2)), trending: val > 25, strong: val > 40 };
}

function calcStochastic(highs, lows, closes) {
  const values = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const last = values[values.length - 1] || {};
  const k = last.k || 50, d = last.d || 50;
  return {
    k: parseFloat(k.toFixed(2)), d: parseFloat(d.toFixed(2)),
    signal: k < 20 ? 'BUY' : k > 80 ? 'SELL' : 'NEUTRAL'
  };
}

// ─── New: ATR ────────────────────────────────────────────────────────────────

function calcATR(highs, lows, closes, period = 14) {
  const values = ATR.calculate({ high: highs, low: lows, close: closes, period });
  const val = values[values.length - 1] || 0.0010;
  return { value: parseFloat(val.toFixed(5)), pips: Math.round(val * 10000) };
}

// ─── New: Williams %R ─────────────────────────────────────────────────────────

function calcWilliamsR(highs, lows, closes) {
  const values = WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const val = values[values.length - 1] || -50;
  return {
    value: parseFloat(val.toFixed(2)),
    signal: val <= -80 ? 'BUY' : val >= -20 ? 'SELL' : 'NEUTRAL',
    description: val <= -80 ? 'Oversold' : val >= -20 ? 'Overbought' : 'Neutral'
  };
}

// ─── New: CCI ────────────────────────────────────────────────────────────────

function calcCCI(highs, lows, closes) {
  const values = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const val = values[values.length - 1] || 0;
  return {
    value: parseFloat(val.toFixed(2)),
    signal: val < -100 ? 'BUY' : val > 100 ? 'SELL' : 'NEUTRAL',
    description: val < -100 ? 'Oversold' : val > 100 ? 'Overbought' : 'Neutral'
  };
}

// ─── New: Ichimoku Cloud ─────────────────────────────────────────────────────

function calcIchimoku(highs, lows, closes) {
  const values = IchimokuCloud.calculate({
    high: highs, low: lows,
    conversionPeriod: 9, basePeriod: 26,
    spanPeriod: 52, displacement: 26
  });
  const last = values[values.length - 1] || {};
  const price = closes[closes.length - 1];
  const tenkan = last.conversion || price;
  const kijun = last.base || price;
  const spanA = last.spanA || price;
  const spanB = last.spanB || price;

  const aboveCloud = price > Math.max(spanA, spanB);
  const belowCloud = price < Math.min(spanA, spanB);
  const inCloud = !aboveCloud && !belowCloud;

  let signal = 'NEUTRAL';
  if (aboveCloud && tenkan > kijun) signal = 'BUY';
  else if (belowCloud && tenkan < kijun) signal = 'SELL';

  return {
    tenkan: parseFloat(tenkan.toFixed(5)),
    kijun: parseFloat(kijun.toFixed(5)),
    span_a: parseFloat(spanA.toFixed(5)),
    span_b: parseFloat(spanB.toFixed(5)),
    signal,
    cloud_position: aboveCloud ? 'ABOVE' : belowCloud ? 'BELOW' : 'INSIDE',
    description: aboveCloud ? 'Price above cloud — bullish' : belowCloud ? 'Price below cloud — bearish' : 'Price inside cloud — neutral'
  };
}

// ─── New: Pivot Points (daily) ────────────────────────────────────────────────

async function calcPivotPoints() {
  try {
    const dailyCandles = await priceService.fetchHistoricalData('1day', 5);
    if (!dailyCandles || dailyCandles.length < 2) return null;
    // Use the last completed day (second-to-last candle)
    const prev = dailyCandles[dailyCandles.length - 2];
    const H = prev.high, L = prev.low, C = prev.close;
    const PP = (H + L + C) / 3;
    return {
      pp:  parseFloat(PP.toFixed(5)),
      r1:  parseFloat((2 * PP - L).toFixed(5)),
      r2:  parseFloat((PP + (H - L)).toFixed(5)),
      r3:  parseFloat((H + 2 * (PP - L)).toFixed(5)),
      s1:  parseFloat((2 * PP - H).toFixed(5)),
      s2:  parseFloat((PP - (H - L)).toFixed(5)),
      s3:  parseFloat((L - 2 * (H - PP)).toFixed(5))
    };
  } catch {
    return null;
  }
}

// ─── New: Candlestick Pattern Detection ───────────────────────────────────────

function calcCandlestickPatterns(opens, highs, lows, closes) {
  const input = { open: opens, high: highs, low: lows, close: closes };
  const bullish = [];
  const bearish = [];

  const check = (fn, name, side) => {
    try {
      const result = fn(input);
      if (result && result[result.length - 1]) {
        if (side === 'bull') bullish.push(name);
        else bearish.push(name);
      }
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
  try { dojiVal = doji(input); dojiVal = dojiVal && dojiVal[dojiVal.length - 1]; } catch {}

  const signal = bullish.length > bearish.length ? 'BUY'
    : bearish.length > bullish.length ? 'SELL'
    : 'NEUTRAL';

  return { bullish, bearish, doji: !!dojiVal, signal };
}

// ─── Fibonacci & Support/Resistance (unchanged) ───────────────────────────────

function calcFibonacci(highs, lows) {
  const swingHigh = Math.max(...highs.slice(-100));
  const swingLow  = Math.min(...lows.slice(-100));
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
      '100':  parseFloat(swingHigh.toFixed(5))
    }
  };
}

function calcSupportResistance(highs, lows) {
  const resistance = [], support = [];
  const h = highs.slice(-50), l = lows.slice(-50);
  for (let i = 2; i < h.length - 2; i++) {
    if (h[i] > h[i-1] && h[i] > h[i+1] && h[i] > h[i-2] && h[i] > h[i+2]) {
      const r = Math.round(h[i] / 0.001) * 0.001;
      if (!resistance.some(x => Math.abs(x - r) < 0.0005)) resistance.push(parseFloat(r.toFixed(5)));
    }
  }
  for (let i = 2; i < l.length - 2; i++) {
    if (l[i] < l[i-1] && l[i] < l[i+1] && l[i] < l[i-2] && l[i] < l[i+2]) {
      const s = Math.round(l[i] / 0.001) * 0.001;
      if (!support.some(x => Math.abs(x - s) < 0.0005)) support.push(parseFloat(s.toFixed(5)));
    }
  }
  return {
    resistance: resistance.sort((a, b) => a - b).slice(0, 3),
    support:    support.sort((a, b) => b - a).slice(0, 3)
  };
}

function detectMarketCondition(adx, bollinger) {
  if (adx.value > 25) return 'TRENDING';
  if (adx.value < 20) return 'RANGING';
  return 'VOLATILE';
}

// ─── Multi-Timeframe Trend Bias ───────────────────────────────────────────────

async function getTimeframeBias(interval, outputsize) {
  try {
    const candles = await priceService.fetchHistoricalData(interval, outputsize);
    if (!candles || candles.length < 50) return 'NEUTRAL';
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const ema20 = EMA.calculate({ values: closes, period: 20 });
    const ema50 = EMA.calculate({ values: closes, period: 50 });
    const adxVals = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const rsiVals = RSI.calculate({ values: closes, period: 14 });

    const lastEma20 = ema20[ema20.length - 1];
    const lastEma50 = ema50[ema50.length - 1];
    const lastAdx   = (adxVals[adxVals.length - 1] || {}).adx || 20;
    const lastRsi   = rsiVals[rsiVals.length - 1] || 50;
    const lastPrice = closes[closes.length - 1];

    let bullVotes = 0, bearVotes = 0;
    if (lastPrice > lastEma20) bullVotes++; else bearVotes++;
    if (lastPrice > lastEma50) bullVotes++; else bearVotes++;
    if (lastEma20 > lastEma50) bullVotes++; else bearVotes++;
    if (lastRsi > 50) bullVotes++; else bearVotes++;

    if (lastAdx < 20) return 'NEUTRAL'; // ranging — no strong bias
    return bullVotes >= 3 ? 'BUY' : bearVotes >= 3 ? 'SELL' : 'NEUTRAL';
  } catch {
    return 'NEUTRAL';
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

async function calculateIndicators(interval = '1h') {
  const cacheKey = `indicators_v2_${interval}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const candles = await priceService.fetchHistoricalData(interval, 300);
  if (!candles || candles.length < 60) throw new Error('Not enough candle data');

  const opens  = candles.map(c => c.open);
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);

  // Run all calculations (pivot points fetches separately)
  const [pivotPoints, h4Bias, m15Bias] = await Promise.all([
    calcPivotPoints(),
    getTimeframeBias('4h', 100),
    getTimeframeBias('15min', 200)
  ]);

  const rsi              = calcRSI(closes);
  const macd             = calcMACD(closes);
  const ema20            = calcEMA(closes, 20);
  const ema50            = calcEMA(closes, 50);
  const ema200           = closes.length >= 200 ? calcEMA(closes, 200) : { value: closes[0], signal: 'NEUTRAL' };
  const bollinger        = calcBollingerBands(closes);
  const adx              = calcADX(highs, lows, closes);
  const stochastic       = calcStochastic(highs, lows, closes);
  const atr              = calcATR(highs, lows, closes);
  const williamsR        = calcWilliamsR(highs, lows, closes);
  const cci              = calcCCI(highs, lows, closes);
  const ichimoku         = calcIchimoku(highs, lows, closes);
  const candlePatterns   = calcCandlestickPatterns(opens, highs, lows, closes);
  const fibonacci        = calcFibonacci(highs, lows);
  const support_resistance = calcSupportResistance(highs, lows);
  const market_condition = detectMarketCondition(adx, bollinger);

  const mtf = {
    h4_bias:  h4Bias,
    h1_bias:  closes[closes.length - 1] > ema50.value ? 'BUY' : 'SELL',
    m15_bias: m15Bias,
    aligned:  h4Bias !== 'NEUTRAL' && h4Bias === m15Bias,
    description: h4Bias === 'NEUTRAL'
      ? 'H4 ranging — wait for direction'
      : h4Bias === m15Bias
        ? `All timeframes aligned ${h4Bias} — high confidence`
        : `H4: ${h4Bias} · M15: ${m15Bias} — mixed signals`
  };

  const indicators = {
    rsi, macd, ema20, ema50, ema200, bollinger,
    adx, stochastic, atr, williamsR, cci, ichimoku,
    candlePatterns, fibonacci, support_resistance,
    pivot_points: pivotPoints,
    market_condition, mtf,
    timestamp: new Date().toISOString()
  };

  cache.set(cacheKey, indicators, 120);
  return indicators;
}

module.exports = { calculateIndicators };
