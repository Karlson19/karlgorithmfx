const indicatorService = require('./indicatorService');
const priceService = require('./priceService');
const cache = require('../utils/cache');
const { saveSignal } = require('./signalHistoryService');

// ─── Indicator Voting Engine ──────────────────────────────────────────────────
// Design principles (post-rewrite):
//   1. Indicators ABSTAIN when their reading is too close to the midline
//      to carry information. We don't manufacture a vote from noise.
//   2. ADX gates trend votes — when ADX is weak, trend-followers carry
//      little weight. Below an absolute floor we abstain.
//   3. Tie-break is NEUTRAL, not BUY. Bias-by-default is how accounts die.
//   4. All proximity thresholds are ATR-scaled so they self-adjust to
//      volatility regimes instead of being hardcoded for one market.
//   5. The "agreeing of 12" UI display still works: the 12 core indicators
//      always count their alignment, an abstention counts as non-agreeing.

const CORE_INDICATORS = [
  'RSI', 'Williams %R', 'CCI', 'Stochastic',
  'EMA20', 'EMA50', 'EMA200', 'MACD',
  'Ichimoku', 'Bollinger', 'ADX Trend', 'Candle Patterns',
];

// One-pip helper for EUR/USD style 5-decimal pairs.
const PIP = 0.0001;

function voteIndicators(ind, price) {
  const votes = [];
  const atrVal = ind.atr && ind.atr.available ? ind.atr.value : 0.0010;
  // Proximity tolerance scaled to volatility. ½ ATR is roughly the noise
  // band where a level isn't really "near" anymore.
  const nearTol = Math.max(atrVal * 0.5, 5 * PIP);

  // ── RSI: needs a real reading away from midline ──────────────────────────
  if (ind.rsi.available) {
    const v = ind.rsi.value;
    if (v < 35 || v > 65) {
      votes.push({
        dir: v < 50 ? 'BUY' : 'SELL',
        weight: (v < 25 || v > 75) ? 2 : 1,
        name: 'RSI',
      });
    } // 35-65 → abstain
  }

  // ── Williams %R ──────────────────────────────────────────────────────────
  if (ind.williamsR.available) {
    const v = ind.williamsR.value;
    if (v <= -65 || v >= -35) {
      votes.push({
        dir: v < -50 ? 'BUY' : 'SELL',
        weight: (v <= -80 || v >= -20) ? 2 : 1,
        name: 'Williams %R',
      });
    }
  }

  // ── CCI: zero-line is noise; require ±50 to vote ─────────────────────────
  if (ind.cci.available) {
    const v = ind.cci.value;
    if (Math.abs(v) >= 50) {
      votes.push({
        dir: v < 0 ? 'BUY' : 'SELL',
        weight: Math.abs(v) >= 100 ? 2 : 1,
        name: 'CCI',
      });
    }
  }

  // ── Stochastic K ─────────────────────────────────────────────────────────
  if (ind.stochastic.available) {
    const k = ind.stochastic.k;
    if (k < 35 || k > 65) {
      votes.push({
        dir: k < 50 ? 'BUY' : 'SELL',
        weight: (k < 20 || k > 80) ? 2 : 1,
        name: 'Stochastic',
      });
    }
  }

  // ── EMA20 / EMA50: trend votes, gated by ADX strength ────────────────────
  // If ADX is below the trend floor, trend-followers contribute almost
  // nothing — they tend to whipsaw in chops.
  const adxAvail = ind.adx && ind.adx.available;
  const adxV = adxAvail ? ind.adx.value : null;
  const trendGate = adxV === null ? 0.5 : adxV < 18 ? 0.25 : adxV < 25 ? 0.75 : 1;

  if (ind.ema20.available) {
    votes.push({ dir: ind.ema20.signal, weight: 1 * trendGate, name: 'EMA20' });
  }
  if (ind.ema50.available) {
    votes.push({ dir: ind.ema50.signal, weight: 1 * trendGate, name: 'EMA50' });
  }

  // ── EMA200: long-term trend; only votes if we actually have it ───────────
  if (ind.ema200.available && ind.ema200.signal !== 'NEUTRAL') {
    votes.push({
      dir: ind.ema200.signal,
      weight: 1.5 * trendGate,
      name: 'EMA200',
    });
  }

  // ── MACD: histogram magnitude scales weight, ATR-scaled threshold ───────
  if (ind.macd.available) {
    const h = ind.macd.histogram;
    if (h !== 0) {
      // "Strong" histogram = magnitude > ~3% of one ATR. Adapts across pairs.
      const strongThresh = atrVal * 0.03;
      votes.push({
        dir: h > 0 ? 'BUY' : 'SELL',
        weight: Math.abs(h) > strongThresh ? 1.5 : 1,
        name: 'MACD',
      });
    }
  }

  // ── Ichimoku ─────────────────────────────────────────────────────────────
  if (ind.ichimoku.available) {
    if (ind.ichimoku.signal !== 'NEUTRAL') {
      // Strong reading: cleanly above/below cloud with tenkan/kijun aligned.
      votes.push({
        dir: ind.ichimoku.signal,
        weight: 3,
        name: 'Ichimoku',
      });
    } else if (ind.ichimoku.cloud_position !== 'INSIDE'
               && ind.ichimoku.cloud_position !== 'UNKNOWN') {
      // Clear of the cloud but tenkan/kijun disagree — small lean.
      const lean = ind.ichimoku.cloud_position === 'ABOVE' ? 'BUY' : 'SELL';
      votes.push({ dir: lean, weight: 1, name: 'Ichimoku' });
    }
    // Inside cloud → abstain. Cloud interior is ichimoku's explicit "no signal".
  }

  // ── Bollinger ────────────────────────────────────────────────────────────
  // Only vote when price is actually at/through a band. The middle line
  // is not a directional signal — touching it is just "average".
  if (ind.bollinger.available && ind.bollinger.signal !== 'NEUTRAL') {
    votes.push({
      dir: ind.bollinger.signal,
      weight: 2,
      name: 'Bollinger',
    });
  }

  // ── ADX Trend ────────────────────────────────────────────────────────────
  // ADX itself is non-directional. Only emit a vote when ADX confirms a
  // trend (>=25) — and we still derive direction from EMA50 alignment.
  // No ADX or weak ADX → abstain rather than fake a direction.
  if (adxAvail && adxV >= 25 && ind.ema50.available) {
    votes.push({
      dir: price > ind.ema50.value ? 'BUY' : 'SELL',
      weight: ind.adx.strong ? 2 : 1.5,
      name: 'ADX Trend',
    });
  }

  // ── Candle Patterns ──────────────────────────────────────────────────────
  if (ind.candlePatterns.signal !== 'NEUTRAL') {
    const patternCount = ind.candlePatterns.bullish.length + ind.candlePatterns.bearish.length;
    votes.push({
      dir: ind.candlePatterns.signal,
      weight: Math.min(patternCount, 3),
      name: 'Candle Patterns',
    });
  }
  // No pattern → abstain. We used to push a half-weight EMA20 echo here,
  // which is double-counting EMA20 under a different name.

  // ── Bonus context (S/R, Pivots) — ATR-scaled proximity ───────────────────
  const sr = ind.support_resistance || { support: [], resistance: [] };
  if (sr.support.length > 0 && Math.abs(price - sr.support[0]) < nearTol) {
    votes.push({ dir: 'BUY',  weight: 1.5, name: 'Near Support' });
  }
  if (sr.resistance.length > 0 && Math.abs(price - sr.resistance[0]) < nearTol) {
    votes.push({ dir: 'SELL', weight: 1.5, name: 'Near Resistance' });
  }

  if (ind.pivot_points) {
    const pp = ind.pivot_points;
    const pivotTol = Math.max(atrVal * 0.4, 4 * PIP);
    for (const lvl of [
      { val: pp.s1, dir: 'BUY',  name: 'S1 Pivot' },
      { val: pp.s2, dir: 'BUY',  name: 'S2 Pivot' },
      { val: pp.r1, dir: 'SELL', name: 'R1 Pivot' },
      { val: pp.r2, dir: 'SELL', name: 'R2 Pivot' },
    ]) {
      if (Math.abs(price - lvl.val) < pivotTol) {
        votes.push({ dir: lvl.dir, weight: 1.5, name: lvl.name });
      }
    }
    // Daily PP location vote — modest weight, only if not basically AT it.
    if (Math.abs(price - pp.pp) > pivotTol * 0.5) {
      votes.push({ dir: price > pp.pp ? 'BUY' : 'SELL', weight: 1, name: 'Daily PP' });
    }
  }

  // ── Weighted tally ────────────────────────────────────────────────────────
  const buyWeight  = votes.filter(v => v.dir === 'BUY').reduce((s, v) => s + v.weight, 0);
  const sellWeight = votes.filter(v => v.dir === 'SELL').reduce((s, v) => s + v.weight, 0);
  const totalWeight = buyWeight + sellWeight;

  // NEUTRAL tie-break: if margin < 10% of total weight (or no weight at all),
  // we don't trade. This is the single biggest behaviour change vs the old
  // engine, which always picked BUY on ties.
  const margin = Math.abs(buyWeight - sellWeight);
  const marginRatio = totalWeight > 0 ? margin / totalWeight : 0;

  let direction;
  if (totalWeight === 0 || marginRatio < 0.10) {
    direction = 'NEUTRAL';
  } else {
    direction = buyWeight > sellWeight ? 'BUY' : 'SELL';
  }

  const agreedWeight = direction === 'BUY' ? buyWeight
    : direction === 'SELL' ? sellWeight
    : 0;
  const confidence = totalWeight > 0
    ? Math.round((agreedWeight / totalWeight) * 100)
    : 50;

  // Fixed 12-indicator display (always "X of 12"). Abstentions count as
  // non-agreeing — that's the honest answer.
  const coreVotes = votes.filter(v => CORE_INDICATORS.includes(v.name));
  const agreeingCore = direction === 'NEUTRAL'
    ? []
    : coreVotes.filter(v => v.dir === direction);
  const agreedNames = direction === 'NEUTRAL'
    ? []
    : votes.filter(v => v.dir === direction).map(v => v.name);

  return {
    direction,
    confidence,
    agreeing: agreeingCore.length,
    total:    CORE_INDICATORS.length,
    agreeing_indicators: agreedNames,
    abstentions: CORE_INDICATORS.filter(n => !coreVotes.some(v => v.name === n)),
    margin_ratio: parseFloat(marginRatio.toFixed(3)),
  };
}

// ─── Multi-Timeframe Confidence Adjustment ────────────────────────────────────
function applyMTFAdjustment(confidence, direction, mtf) {
  if (direction === 'NEUTRAL') return confidence;
  let adjusted = confidence;

  if (mtf.h4_bias === direction && mtf.m15_bias === direction) {
    adjusted += 12; // All three aligned — strong tailwind
  } else if (mtf.h4_bias === direction) {
    adjusted += 6;  // H4 agrees
  } else if (mtf.h4_bias !== 'NEUTRAL' && mtf.h4_bias !== direction) {
    adjusted -= 25; // H4 contradicts — major penalty (worse than before)
  } else if (mtf.m15_bias === direction) {
    adjusted += 3;  // Only M15 confirms — small bump
  }

  return Math.min(Math.max(adjusted, 0), 99);
}

// ─── Session filter ──────────────────────────────────────────────────────────
// EUR/USD trades best during London (07-16 UTC) and NY (12-21 UTC). Asian
// session and the post-NY dead zone (21-23 UTC) are flat and chop-prone.
// We don't BLOCK signals outside active hours — we just discount confidence,
// because liquidity-driven false breaks are the dominant failure mode there.
function getSessionContext() {
  const utcHour = new Date().getUTCHours();
  const inLondon = utcHour >= 7  && utcHour < 16;
  const inNY     = utcHour >= 12 && utcHour < 21;
  const inOverlap = utcHour >= 12 && utcHour < 16; // peak liquidity
  const inAsian  = utcHour >= 23 || utcHour < 7;
  const inDead   = utcHour >= 21 && utcHour < 23;

  let label, penalty;
  if (inOverlap)        { label = 'LONDON_NY_OVERLAP'; penalty = 0; }
  else if (inLondon)    { label = 'LONDON';            penalty = 0; }
  else if (inNY)        { label = 'NEW_YORK';          penalty = 0; }
  else if (inDead)      { label = 'DEAD_ZONE';         penalty = 18; }
  else if (inAsian)     { label = 'ASIAN';             penalty = 12; }
  else                  { label = 'OFF_HOURS';         penalty = 8;  }

  return { label, penalty, utc_hour: utcHour };
}

// ─── ATR-Based SL/TP, snapped to nearby S/R ───────────────────────────────────
function calcATRLevels(direction, price, atr, marketCondition, sr) {
  const atrVal = atr && atr.available ? atr.value : 0.0010;

  // Volatility-adjusted multipliers
  const slMult = marketCondition === 'VOLATILE' ? 2.0
    : marketCondition === 'TRENDING' ? 1.5
    : 1.8;
  const tp1Mult = slMult * 1.5;
  const tp2Mult = slMult * 3.0;

  let slDist  = atrVal * slMult;
  let tp1Dist = atrVal * tp1Mult;
  const tp2Dist = atrVal * tp2Mult;

  // S/R-aware snapping: if a known support/resistance level sits inside our
  // ATR target, the market is likely to react there before reaching the
  // pure-math target. Pull TP1 just shy of the obstacle and push SL a hair
  // beyond the level it should hold above/below.
  const buffer = Math.max(atrVal * 0.15, 2 * PIP);

  if (direction === 'BUY') {
    // TP1: nearest resistance above price, if it sits inside ATR-TP1.
    const resAbove = (sr && sr.resistance ? sr.resistance : [])
      .filter(r => r > price && (r - price) < tp1Dist)
      .sort((a, b) => a - b)[0];
    if (resAbove) tp1Dist = Math.max(resAbove - price - buffer, atrVal * 0.6);

    // SL: nearest support below price, if it sits inside ATR-SL.
    const supBelow = (sr && sr.support ? sr.support : [])
      .filter(s => s < price && (price - s) < slDist)
      .sort((a, b) => b - a)[0];
    if (supBelow) slDist = Math.max(price - supBelow + buffer, atrVal * 0.8);

    return {
      stop_loss:     parseFloat((price - slDist).toFixed(5)),
      take_profit_1: parseFloat((price + tp1Dist).toFixed(5)),
      take_profit_2: parseFloat((price + tp2Dist).toFixed(5)),
    };
  }

  // SELL
  const supBelowTP = (sr && sr.support ? sr.support : [])
    .filter(s => s < price && (price - s) < tp1Dist)
    .sort((a, b) => b - a)[0];
  if (supBelowTP) tp1Dist = Math.max(price - supBelowTP - buffer, atrVal * 0.6);

  const resAboveSL = (sr && sr.resistance ? sr.resistance : [])
    .filter(r => r > price && (r - price) < slDist)
    .sort((a, b) => a - b)[0];
  if (resAboveSL) slDist = Math.max(resAboveSL - price + buffer, atrVal * 0.8);

  return {
    stop_loss:     parseFloat((price + slDist).toFixed(5)),
    take_profit_1: parseFloat((price - tp1Dist).toFixed(5)),
    take_profit_2: parseFloat((price - tp2Dist).toFixed(5)),
  };
}

// ─── Strategy Name ────────────────────────────────────────────────────────────
function buildStrategyName(ind, direction) {
  const parts = [];
  if (ind.ichimoku.available && ind.ichimoku.signal === direction) parts.push('Ichimoku');
  if (ind.mtf.aligned) parts.push('MTF Confluence');
  if (ind.candlePatterns.signal === direction) {
    const patterns = direction === 'BUY' ? ind.candlePatterns.bullish : ind.candlePatterns.bearish;
    if (patterns.length > 0) parts.push(patterns[0]);
  }
  if (ind.ema20.available && ind.ema50.available
      && ind.ema20.signal === direction && ind.ema50.signal === direction) {
    parts.push('EMA Cross');
  }
  if (ind.macd.available && ind.macd.signal === direction) parts.push('MACD');
  if (ind.adx.available && ind.adx.trending) parts.push('ADX Trend');
  if (ind.rsi.available && ind.rsi.signal === direction) parts.push('RSI');
  if (ind.market_condition === 'RANGING') parts.push('S/R Bounce');
  return parts.slice(0, 4).join(' + ') || 'Multi-Indicator';
}

// ─── Main: Generate Signal ────────────────────────────────────────────────────
async function generateSignal() {
  const cached = cache.get('current_signal');
  if (cached) return cached;

  try {
    const indicators = await indicatorService.calculateIndicators('1h');

    // Canonical price is the last closed H1 close — the SAME value the
    // indicators were computed on. No more "live tick disagrees with EMA"
    // flip-flops mid-candle.
    const price = indicators.reference_price;
    if (!price) throw new Error('No reference price');

    const session = getSessionContext();

    const voteResult = voteIndicators(indicators, price);
    const { direction, agreeing, total, agreeing_indicators } = voteResult;
    let { confidence } = voteResult;

    // MTF adjustment
    confidence = applyMTFAdjustment(confidence, direction, indicators.mtf);
    // Session penalty (cuts out low-liquidity hour signals in the most
    // honest way: by lowering confidence so they fall below the floor).
    confidence = Math.max(0, Math.min(99, confidence - session.penalty));

    // Confidence floor: 65 instead of 55. With abstention + neutral
    // tie-break, scores below 65 are essentially "no edge".
    const FLOOR = 65;

    if (direction === 'NEUTRAL' || confidence < FLOOR) {
      const signal = {
        direction: 'NEUTRAL',
        entry: parseFloat(price.toFixed(5)),
        stop_loss: null, take_profit_1: null, take_profit_2: null,
        confidence,
        strategy: direction === 'NEUTRAL'
          ? 'Mixed signals — no decisive direction'
          : 'Confidence below floor — wait for alignment',
        market_condition: indicators.market_condition,
        timeframe: 'H1',
        risk_reward: null,
        mtf: indicators.mtf,
        session: session.label,
        timestamp: new Date().toISOString(),
        indicators_agreeing: agreeing,
        total_indicators: total,
        agreeing_indicators,
        abstentions: voteResult.abstentions,
      };
      cache.set('current_signal', signal,
        Math.min(priceService.secondsUntilCandleClose('1h'), 300));
      return signal;
    }

    const { stop_loss, take_profit_1, take_profit_2 } = calcATRLevels(
      direction, price, indicators.atr, indicators.market_condition,
      indicators.support_resistance,
    );
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
      atr_pips: indicators.atr.available ? indicators.atr.pips : null,
      mtf: indicators.mtf,
      session: session.label,
      timestamp: new Date().toISOString(),
      indicators_agreeing: agreeing,
      total_indicators: total,
      agreeing_indicators,
      abstentions: voteResult.abstentions,
      margin_ratio: voteResult.margin_ratio,
    };

    cache.set('current_signal', signal,
      Math.min(priceService.secondsUntilCandleClose('1h'), 300));

    saveSignal(signal).catch(err => console.error('saveSignal error:', err.message));
    return signal;
  } catch (err) {
    console.error('Signal generation error:', err.message);
    throw err;
  }
}

module.exports = { generateSignal };
