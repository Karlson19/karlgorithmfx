const indicatorService = require('./indicatorService');
const priceService = require('./priceService');
const cache = require('../utils/cache');
const { saveSignal } = require('./signalHistoryService');

// ─── Indicator Voting Engine ──────────────────────────────────────────────────

function voteIndicators(ind, price) {
  const votes = [];

  // Momentum oscillators
  if (ind.rsi.signal !== 'NEUTRAL')       votes.push({ dir: ind.rsi.signal,       weight: 1, name: 'RSI' });
  if (ind.williamsR.signal !== 'NEUTRAL') votes.push({ dir: ind.williamsR.signal, weight: 1, name: 'Williams %R' });
  if (ind.cci.signal !== 'NEUTRAL')       votes.push({ dir: ind.cci.signal,       weight: 1, name: 'CCI' });
  if (ind.stochastic.signal !== 'NEUTRAL') votes.push({ dir: ind.stochastic.signal, weight: 1, name: 'Stochastic' });

  // Trend indicators
  votes.push({ dir: ind.ema20.signal,  weight: 1, name: 'EMA20' });
  votes.push({ dir: ind.ema50.signal,  weight: 1, name: 'EMA50' });
  if (ind.ema200.signal !== 'NEUTRAL') votes.push({ dir: ind.ema200.signal, weight: 1.5, name: 'EMA200' });
  if (ind.macd.signal !== 'NEUTRAL')   votes.push({ dir: ind.macd.signal,  weight: 1, name: 'MACD' });

  // Ichimoku (strong weight — complete system)
  if (ind.ichimoku.signal !== 'NEUTRAL') {
    votes.push({ dir: ind.ichimoku.signal, weight: 2, name: 'Ichimoku' });
    // Extra weight if price clearly above/below cloud
    if (ind.ichimoku.cloud_position !== 'INSIDE') {
      votes.push({ dir: ind.ichimoku.signal, weight: 1, name: 'Ichimoku Cloud' });
    }
  }

  // Bollinger Bands
  if (ind.bollinger.signal !== 'NEUTRAL') votes.push({ dir: ind.bollinger.signal, weight: 1, name: 'Bollinger' });

  // ADX directional bias (only if trending)
  if (ind.adx.trending) {
    const trendDir = price > ind.ema50.value ? 'BUY' : 'SELL';
    votes.push({ dir: trendDir, weight: ind.adx.strong ? 2 : 1, name: 'ADX Trend' });
  }

  // Candlestick patterns (strong confirmation signal)
  if (ind.candlePatterns.signal !== 'NEUTRAL') {
    const patternWeight = ind.candlePatterns.bullish.length + ind.candlePatterns.bearish.length;
    votes.push({ dir: ind.candlePatterns.signal, weight: Math.min(patternWeight, 3), name: 'Candle Patterns' });
  }

  // Support/Resistance proximity
  const { support, resistance } = ind.support_resistance;
  if (support.length > 0 && Math.abs(price - support[0]) < 0.0020)    votes.push({ dir: 'BUY',  weight: 1.5, name: 'Near Support' });
  if (resistance.length > 0 && Math.abs(price - resistance[0]) < 0.0020) votes.push({ dir: 'SELL', weight: 1.5, name: 'Near Resistance' });

  // Pivot Points proximity
  if (ind.pivot_points) {
    const pp = ind.pivot_points;
    const levels = [
      { val: pp.s1, dir: 'BUY', name: 'S1 Pivot' },
      { val: pp.s2, dir: 'BUY', name: 'S2 Pivot' },
      { val: pp.r1, dir: 'SELL', name: 'R1 Pivot' },
      { val: pp.r2, dir: 'SELL', name: 'R2 Pivot' },
    ];
    for (const lvl of levels) {
      if (Math.abs(price - lvl.val) < 0.0015) {
        votes.push({ dir: lvl.dir, weight: 1.5, name: lvl.name });
      }
    }
    // Above/below pivot point itself
    if (price > pp.pp) votes.push({ dir: 'BUY',  weight: 1, name: 'Above Daily PP' });
    else               votes.push({ dir: 'SELL', weight: 1, name: 'Below Daily PP' });
  }

  // Tally weighted votes
  const buyWeight  = votes.filter(v => v.dir === 'BUY').reduce((s, v) => s + v.weight, 0);
  const sellWeight = votes.filter(v => v.dir === 'SELL').reduce((s, v) => s + v.weight, 0);
  const totalWeight = buyWeight + sellWeight;

  const direction = buyWeight >= sellWeight ? 'BUY' : 'SELL';
  const agreedWeight = direction === 'BUY' ? buyWeight : sellWeight;
  const confidence = totalWeight > 0 ? Math.round((agreedWeight / totalWeight) * 100) : 50;
  const agreedNames = votes.filter(v => v.dir === direction).map(v => v.name);

  return {
    direction,
    confidence,
    agreeing: votes.filter(v => v.dir === direction).length,
    total: votes.length,
    agreeing_indicators: agreedNames
  };
}

// ─── Multi-Timeframe Confidence Adjustment ────────────────────────────────────

function applyMTFAdjustment(confidence, direction, mtf) {
  let adjusted = confidence;

  if (mtf.h4_bias === direction && mtf.m15_bias === direction) {
    adjusted += 15; // All three timeframes aligned
  } else if (mtf.h4_bias === direction) {
    adjusted += 8;  // H4 agrees with H1 signal
  } else if (mtf.h4_bias !== 'NEUTRAL' && mtf.h4_bias !== direction) {
    adjusted -= 20; // H4 directly contradicts signal — major penalty
  } else if (mtf.m15_bias === direction) {
    adjusted += 5;  // Only M15 confirms
  }

  return Math.min(Math.max(adjusted, 0), 99);
}

// ─── ATR-Based SL/TP ─────────────────────────────────────────────────────────

function calcATRLevels(direction, price, atr, marketCondition) {
  // Volatility-adjusted multipliers
  const slMultiplier = marketCondition === 'VOLATILE' ? 2.0 : marketCondition === 'TRENDING' ? 1.5 : 1.8;
  const tp1Multiplier = slMultiplier * 1.5;
  const tp2Multiplier = slMultiplier * 3.0;

  const slDist  = atr.value * slMultiplier;
  const tp1Dist = atr.value * tp1Multiplier;
  const tp2Dist = atr.value * tp2Multiplier;

  if (direction === 'BUY') {
    return {
      stop_loss:     parseFloat((price - slDist).toFixed(5)),
      take_profit_1: parseFloat((price + tp1Dist).toFixed(5)),
      take_profit_2: parseFloat((price + tp2Dist).toFixed(5))
    };
  }
  return {
    stop_loss:     parseFloat((price + slDist).toFixed(5)),
    take_profit_1: parseFloat((price - tp1Dist).toFixed(5)),
    take_profit_2: parseFloat((price - tp2Dist).toFixed(5))
  };
}

// ─── Strategy Name ────────────────────────────────────────────────────────────

function buildStrategyName(ind, direction) {
  const parts = [];

  if (ind.ichimoku.signal === direction) parts.push('Ichimoku');
  if (ind.mtf.aligned) parts.push('MTF Confluence');
  if (ind.candlePatterns.signal === direction && (ind.candlePatterns.bullish.length + ind.candlePatterns.bearish.length) > 0) {
    const patterns = direction === 'BUY' ? ind.candlePatterns.bullish : ind.candlePatterns.bearish;
    if (patterns.length > 0) parts.push(patterns[0]);
  }
  if (ind.ema20.signal === direction && ind.ema50.signal === direction) parts.push('EMA Cross');
  if (ind.macd.signal === direction) parts.push('MACD');
  if (ind.adx.trending) parts.push('ADX Trend');
  if (ind.rsi.signal === direction) parts.push('RSI');
  if (ind.market_condition === 'RANGING') parts.push('S/R Bounce');

  return parts.slice(0, 4).join(' + ') || 'Multi-Indicator';
}

// ─── Main: Generate Signal ────────────────────────────────────────────────────

async function generateSignal() {
  const cached = cache.get('current_signal');
  if (cached) return cached;

  try {
    const [indicators, priceData] = await Promise.all([
      indicatorService.calculateIndicators('1h'),
      priceService.fetchLivePrice()
    ]);

    if (!priceData) throw new Error('No price data');
    const price = priceData.price;

    const { direction, confidence: rawConf, agreeing, total, agreeing_indicators } = voteIndicators(indicators, price);
    const confidence = applyMTFAdjustment(rawConf, direction, indicators.mtf);

    if (confidence < 55) {
      const signal = {
        direction: 'NEUTRAL', entry: price,
        stop_loss: null, take_profit_1: null, take_profit_2: null,
        confidence, strategy: 'No clear signal — wait for alignment',
        market_condition: indicators.market_condition,
        timeframe: 'H1', risk_reward: null,
        mtf: indicators.mtf,
        timestamp: new Date().toISOString(),
        indicators_agreeing: agreeing, total_indicators: total,
        agreeing_indicators
      };
      cache.set('current_signal', signal, 900);
      return signal;
    }

    const { stop_loss, take_profit_1, take_profit_2 } = calcATRLevels(direction, price, indicators.atr, indicators.market_condition);
    const slPips  = Math.abs(price - stop_loss) * 10000;
    const tp1Pips = Math.abs(price - take_profit_1) * 10000;
    const rr = slPips > 0 ? `1:${(tp1Pips / slPips).toFixed(1)}` : '1:1.5';

    const signal = {
      direction,
      entry: parseFloat(price.toFixed(5)),
      stop_loss, take_profit_1, take_profit_2,
      confidence,
      strategy: buildStrategyName(indicators, direction),
      market_condition: indicators.market_condition,
      timeframe: 'H1',
      risk_reward: rr,
      atr_pips: indicators.atr.pips,
      mtf: indicators.mtf,
      timestamp: new Date().toISOString(),
      indicators_agreeing: agreeing,
      total_indicators: total,
      agreeing_indicators
    };

    cache.set('current_signal', signal, 900);
    // Persist to Supabase for performance tracking (fire-and-forget)
    saveSignal(signal).catch(err => console.error('saveSignal error:', err.message));
    return signal;
  } catch (err) {
    console.error('Signal generation error:', err.message);
    throw err;
  }
}

module.exports = { generateSignal };
