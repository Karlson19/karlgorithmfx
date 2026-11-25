const indicatorService = require('./indicatorService');
const priceService = require('./priceService');
const newsService = require('./newsService');
const calibration = require('./calibrationService');
const strategies = require('./strategiesService');
const cache = require('../utils/cache');
const { saveSignal } = require('./signalHistoryService');
const telegram = require('./telegramService');
const { getPair, PRIMARY_SYMBOL } = require('../config/pairs');

// ─── Engine principles (post Phase 2 rewrite) ────────────────────────────────
// 1. Indicators ABSTAIN on midline readings. Noise doesn't get a vote.
// 2. ADX gates trend votes. Weak ADX → trend-followers near-silent.
// 3. Tie-break is NEUTRAL. Bias-by-default is how accounts die.
// 4. Thresholds are PAIR-AWARE — pip-scaled so gold and yen pairs behave
//    sensibly under the same logic.
// 5. Regime-aware ENSEMBLE:
//      TRENDING → reward trend-followers, downweight oscillators
//      RANGING  → reward oscillators + S/R, downweight trend-followers
//      VOLATILE → downweight both; require stronger consensus
// 6. News blackout: HIGH-impact event for either currency of the pair
//    within ±N minutes → NEUTRAL.
// 7. Confidence is calibrated against the pair's own history, measured as
//    expectancy in R net of spread (not raw win rate). Below MIN_SAMPLES of
//    de-duplicated signals in a band, the heuristic floor applies. With
//    samples, the band must show a positive conservative edge to emit.
//    Signals the gate blocks are still tracked as shadow signals so a blocked
//    band can recover (see calibrationService).

const CORE_INDICATORS = [
  'RSI', 'Williams %R', 'CCI', 'Stochastic',
  'EMA20', 'EMA50', 'EMA200', 'MACD',
  'Ichimoku', 'Bollinger', 'ADX Trend', 'Candle Patterns',
];

// Heuristic confidence floor — applies when calibration doesn't yet have
// enough samples for the band.
const HEURISTIC_FLOOR = 65;

// News blackout window in minutes around HIGH-impact events.
const NEWS_BLACKOUT_MIN = 30;

// ─── Regime multipliers ──────────────────────────────────────────────────────
// For each named vote source, the weight gets multiplied by this factor for
// the current market regime. 1.0 = neutral, >1 = reward, <1 = penalize.
const REGIME_WEIGHTS = {
  TRENDING: {
    'EMA20': 1.3, 'EMA50': 1.3, 'EMA200': 1.3, 'MACD': 1.3, 'ADX Trend': 1.3, 'Ichimoku': 1.3,
    'RSI': 0.6, 'Williams %R': 0.6, 'CCI': 0.6, 'Stochastic': 0.6, 'Bollinger': 0.7,
    'Near Support': 0.7, 'Near Resistance': 0.7,
  },
  RANGING: {
    'EMA20': 0.5, 'EMA50': 0.5, 'EMA200': 0.6, 'MACD': 0.7, 'ADX Trend': 0.3, 'Ichimoku': 0.7,
    'RSI': 1.3, 'Williams %R': 1.3, 'CCI': 1.3, 'Stochastic': 1.3, 'Bollinger': 1.3,
    'Near Support': 1.4, 'Near Resistance': 1.4,
  },
  VOLATILE: {
    // Down-weight everything — require unusually strong consensus.
    'EMA20': 0.7, 'EMA50': 0.7, 'EMA200': 0.7, 'MACD': 0.7, 'ADX Trend': 0.8, 'Ichimoku': 0.8,
    'RSI': 0.7, 'Williams %R': 0.7, 'CCI': 0.7, 'Stochastic': 0.7, 'Bollinger': 1.0,
    'Near Support': 0.7, 'Near Resistance': 0.7,
  },
};

function regimeWeight(regime, name) {
  const table = REGIME_WEIGHTS[regime];
  if (!table) return 1;
  return table[name] != null ? table[name] : 1;
}

// ─── Voting engine ───────────────────────────────────────────────────────────
function voteIndicators(ind, price, pair, regime) {
  const votes = [];
  const pipSize = pair.pip_size;
  const atrVal = ind.atr && ind.atr.available ? ind.atr.value : pair.atr_floor;
  const nearTol = Math.max(atrVal * 0.5, 5 * pipSize);

  const push = (vote) => {
    vote.weight = vote.weight * regimeWeight(regime, vote.name);
    votes.push(vote);
  };

  // RSI
  if (ind.rsi.available) {
    const v = ind.rsi.value;
    if (v < 35 || v > 65) {
      push({ dir: v < 50 ? 'BUY' : 'SELL', weight: (v < 25 || v > 75) ? 2 : 1, name: 'RSI' });
    }
  }
  // Williams %R
  if (ind.williamsR.available) {
    const v = ind.williamsR.value;
    if (v <= -65 || v >= -35) {
      push({ dir: v < -50 ? 'BUY' : 'SELL', weight: (v <= -80 || v >= -20) ? 2 : 1, name: 'Williams %R' });
    }
  }
  // CCI
  if (ind.cci.available) {
    const v = ind.cci.value;
    if (Math.abs(v) >= 50) {
      push({ dir: v < 0 ? 'BUY' : 'SELL', weight: Math.abs(v) >= 100 ? 2 : 1, name: 'CCI' });
    }
  }
  // Stochastic
  if (ind.stochastic.available) {
    const k = ind.stochastic.k;
    if (k < 35 || k > 65) {
      push({ dir: k < 50 ? 'BUY' : 'SELL', weight: (k < 20 || k > 80) ? 2 : 1, name: 'Stochastic' });
    }
  }
  // EMA trend votes — gated by ADX
  const adxAvail = ind.adx && ind.adx.available;
  const adxV = adxAvail ? ind.adx.value : null;
  const trendGate = adxV === null ? 0.5 : adxV < 18 ? 0.25 : adxV < 25 ? 0.75 : 1;
  if (ind.ema20.available) push({ dir: ind.ema20.signal, weight: 1 * trendGate, name: 'EMA20' });
  if (ind.ema50.available) push({ dir: ind.ema50.signal, weight: 1 * trendGate, name: 'EMA50' });
  if (ind.ema200.available && ind.ema200.signal !== 'NEUTRAL') {
    push({ dir: ind.ema200.signal, weight: 1.5 * trendGate, name: 'EMA200' });
  }
  // MACD — ATR-scaled "strong" threshold
  if (ind.macd.available && ind.macd.histogram !== 0) {
    const strongThresh = atrVal * 0.03;
    push({
      dir: ind.macd.histogram > 0 ? 'BUY' : 'SELL',
      weight: Math.abs(ind.macd.histogram) > strongThresh ? 1.5 : 1,
      name: 'MACD',
    });
  }
  // Ichimoku
  if (ind.ichimoku.available) {
    if (ind.ichimoku.signal !== 'NEUTRAL') {
      push({ dir: ind.ichimoku.signal, weight: 3, name: 'Ichimoku' });
    } else if (ind.ichimoku.cloud_position !== 'INSIDE' && ind.ichimoku.cloud_position !== 'UNKNOWN') {
      const lean = ind.ichimoku.cloud_position === 'ABOVE' ? 'BUY' : 'SELL';
      push({ dir: lean, weight: 1, name: 'Ichimoku' });
    }
  }
  // Bollinger
  if (ind.bollinger.available && ind.bollinger.signal !== 'NEUTRAL') {
    push({ dir: ind.bollinger.signal, weight: 2, name: 'Bollinger' });
  }
  // ADX Trend
  if (adxAvail && adxV >= 25 && ind.ema50.available) {
    push({
      dir: price > ind.ema50.value ? 'BUY' : 'SELL',
      weight: ind.adx.strong ? 2 : 1.5,
      name: 'ADX Trend',
    });
  }
  // Candle patterns
  if (ind.candlePatterns.signal !== 'NEUTRAL') {
    const cnt = ind.candlePatterns.bullish.length + ind.candlePatterns.bearish.length;
    push({ dir: ind.candlePatterns.signal, weight: Math.min(cnt, 3), name: 'Candle Patterns' });
  }
  // S/R proximity
  const sr = ind.support_resistance || { support: [], resistance: [] };
  if (sr.support.length > 0 && Math.abs(price - sr.support[0]) < nearTol) {
    push({ dir: 'BUY',  weight: 1.5, name: 'Near Support' });
  }
  if (sr.resistance.length > 0 && Math.abs(price - sr.resistance[0]) < nearTol) {
    push({ dir: 'SELL', weight: 1.5, name: 'Near Resistance' });
  }
  // Pivots
  if (ind.pivot_points) {
    const pp = ind.pivot_points;
    const pivotTol = Math.max(atrVal * 0.4, 4 * pipSize);
    for (const lvl of [
      { val: pp.s1, dir: 'BUY',  name: 'S1 Pivot' },
      { val: pp.s2, dir: 'BUY',  name: 'S2 Pivot' },
      { val: pp.r1, dir: 'SELL', name: 'R1 Pivot' },
      { val: pp.r2, dir: 'SELL', name: 'R2 Pivot' },
    ]) {
      if (Math.abs(price - lvl.val) < pivotTol) {
        push({ dir: lvl.dir, weight: 1.5, name: lvl.name });
      }
    }
    if (Math.abs(price - pp.pp) > pivotTol * 0.5) {
      push({ dir: price > pp.pp ? 'BUY' : 'SELL', weight: 1, name: 'Daily PP' });
    }
  }

  // ── Weighted tally ────────────────────────────────────────────────────────
  const buyWeight  = votes.filter(v => v.dir === 'BUY').reduce((s, v) => s + v.weight, 0);
  const sellWeight = votes.filter(v => v.dir === 'SELL').reduce((s, v) => s + v.weight, 0);
  const totalWeight = buyWeight + sellWeight;

  const margin = Math.abs(buyWeight - sellWeight);
  const marginRatio = totalWeight > 0 ? margin / totalWeight : 0;

  let direction;
  if (totalWeight === 0 || marginRatio < 0.10) {
    direction = 'NEUTRAL';
  } else {
    direction = buyWeight > sellWeight ? 'BUY' : 'SELL';
  }

  const agreedWeight = direction === 'BUY' ? buyWeight
    : direction === 'SELL' ? sellWeight : 0;
  const confidence = totalWeight > 0
    ? Math.round((agreedWeight / totalWeight) * 100) : 50;

  const coreVotes = votes.filter(v => CORE_INDICATORS.includes(v.name));
  const agreeingCore = direction === 'NEUTRAL' ? []
    : coreVotes.filter(v => v.dir === direction);
  const agreedNames = direction === 'NEUTRAL' ? []
    : votes.filter(v => v.dir === direction).map(v => v.name);

  return {
    direction,
    confidence,
    agreeing: agreeingCore.length,
    total: CORE_INDICATORS.length,
    agreeing_indicators: agreedNames,
    abstentions: CORE_INDICATORS.filter(n => !coreVotes.some(v => v.name === n)),
    margin_ratio: parseFloat(marginRatio.toFixed(3)),
  };
}

// ─── MTF adjustment ──────────────────────────────────────────────────────────
function applyMTFAdjustment(confidence, direction, mtf) {
  if (direction === 'NEUTRAL') return confidence;
  let adjusted = confidence;
  if (mtf.h4_bias === direction && mtf.m15_bias === direction) adjusted += 12;
  else if (mtf.h4_bias === direction) adjusted += 6;
  else if (mtf.h4_bias !== 'NEUTRAL' && mtf.h4_bias !== direction) adjusted -= 25;
  else if (mtf.m15_bias === direction) adjusted += 3;
  return Math.min(Math.max(adjusted, 0), 99);
}

// ─── Session context (UTC) ──────────────────────────────────────────────────
function getSessionContext() {
  const utcHour = new Date().getUTCHours();
  const inLondon  = utcHour >= 7  && utcHour < 16;
  const inNY      = utcHour >= 12 && utcHour < 21;
  const inOverlap = utcHour >= 12 && utcHour < 16;
  const inAsian   = utcHour >= 23 || utcHour < 7;
  const inDead    = utcHour >= 21 && utcHour < 23;

  let label;
  if (inOverlap)     label = 'LONDON_NY_OVERLAP';
  else if (inLondon) label = 'LONDON';
  else if (inNY)     label = 'NEW_YORK';
  else if (inDead)   label = 'DEAD_ZONE';
  else if (inAsian)  label = 'ASIAN';
  else               label = 'OFF_HOURS';

  return { label, utc_hour: utcHour };
}

// Session penalty is now PAIR-AWARE — yen pairs care about Asian hours,
// gold cares about NY. Falls back to a moderate 10-point penalty for any
// session a pair hasn't explicitly weighted.
function sessionPenaltyForPair(pair, sessionLabel) {
  const weight = pair.session_weights[sessionLabel];
  if (weight == null) return 10;
  // weight 1.0 → 0 penalty; weight 0.5 → 12 penalty; weight 0.3 → 18 penalty
  return Math.round((1 - weight) * 25);
}

// ─── News blackout ───────────────────────────────────────────────────────────
function isInNewsBlackout(news, pair, minutesWindow = NEWS_BLACKOUT_MIN) {
  if (!Array.isArray(news) || news.length === 0) return null;
  const now = Date.now();
  const relevant = news.filter(n =>
    n.impact === 'HIGH' && pair.news_currencies.includes(n.currency)
  );
  for (const n of relevant) {
    const diffMin = Math.abs(new Date(n.date).getTime() - now) / 60000;
    if (diffMin <= minutesWindow) {
      return { title: n.title, currency: n.currency, minutes: Math.round(diffMin) };
    }
  }
  return null;
}

// ─── SL/TP (pip-aware, S/R snapped) ──────────────────────────────────────────
function calcATRLevels(direction, price, atr, marketCondition, sr, pair) {
  const atrVal = atr && atr.available ? atr.value : pair.atr_floor;
  const slMult = marketCondition === 'VOLATILE' ? 2.0
    : marketCondition === 'TRENDING' ? 1.5 : 1.8;
  const tp1Mult = slMult * 1.5;
  const tp2Mult = slMult * 3.0;

  let slDist  = atrVal * slMult;
  let tp1Dist = atrVal * tp1Mult;
  const tp2Dist = atrVal * tp2Mult;

  const buffer = Math.max(atrVal * 0.15, 2 * pair.pip_size);

  if (direction === 'BUY') {
    const resAbove = (sr && sr.resistance ? sr.resistance : [])
      .filter(r => r > price && (r - price) < tp1Dist)
      .sort((a, b) => a - b)[0];
    if (resAbove) tp1Dist = Math.max(resAbove - price - buffer, atrVal * 0.6);

    const supBelow = (sr && sr.support ? sr.support : [])
      .filter(s => s < price && (price - s) < slDist)
      .sort((a, b) => b - a)[0];
    if (supBelow) slDist = Math.max(price - supBelow + buffer, atrVal * 0.8);

    return {
      stop_loss:     parseFloat((price - slDist).toFixed(pair.digits)),
      take_profit_1: parseFloat((price + tp1Dist).toFixed(pair.digits)),
      take_profit_2: parseFloat((price + tp2Dist).toFixed(pair.digits)),
    };
  }
  const supBelowTP = (sr && sr.support ? sr.support : [])
    .filter(s => s < price && (price - s) < tp1Dist)
    .sort((a, b) => b - a)[0];
  if (supBelowTP) tp1Dist = Math.max(price - supBelowTP - buffer, atrVal * 0.6);

  const resAboveSL = (sr && sr.resistance ? sr.resistance : [])
    .filter(r => r > price && (r - price) < slDist)
    .sort((a, b) => a - b)[0];
  if (resAboveSL) slDist = Math.max(resAboveSL - price + buffer, atrVal * 0.8);

  return {
    stop_loss:     parseFloat((price + slDist).toFixed(pair.digits)),
    take_profit_1: parseFloat((price - tp1Dist).toFixed(pair.digits)),
    take_profit_2: parseFloat((price - tp2Dist).toFixed(pair.digits)),
  };
}

// ─── Strategy name ───────────────────────────────────────────────────────────
function buildStrategyName(ind, direction, regime) {
  const parts = [regime[0] + regime.slice(1).toLowerCase()];
  if (ind.ichimoku.available && ind.ichimoku.signal === direction) parts.push('Ichimoku');
  if (ind.mtf.aligned) parts.push('MTF Confluence');
  if (ind.candlePatterns.signal === direction) {
    const patterns = direction === 'BUY' ? ind.candlePatterns.bullish : ind.candlePatterns.bearish;
    if (patterns.length > 0) parts.push(patterns[0]);
  }
  if (ind.ema20.available && ind.ema50.available
      && ind.ema20.signal === direction && ind.ema50.signal === direction) parts.push('EMA Cross');
  if (ind.macd.available && ind.macd.signal === direction) parts.push('MACD');
  if (ind.adx.available && ind.adx.trending) parts.push('ADX Trend');
  if (ind.rsi.available && ind.rsi.signal === direction) parts.push('RSI');
  return parts.slice(0, 5).join(' + ') || 'Multi-Indicator';
}

// ─── Main: per-pair signal generation ────────────────────────────────────────
async function generateSignal(symbol = PRIMARY_SYMBOL) {
  const sym = priceService.resolveSymbol(symbol);
  const pair = getPair(sym);
  const cacheKey = `current_signal_${sym}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const [indicators, news, candles] = await Promise.all([
      indicatorService.calculateIndicators('1h', sym),
      newsService.fetchNews().catch(() => []),
      // Strategies need candle access for swing/range/sweep detection.
      priceService.fetchHistoricalData('1h', 50, sym).catch(() => []),
    ]);

    const price = indicators.reference_price;
    if (!price) throw new Error(`No reference price for ${sym}`);

    const session = getSessionContext();
    const sessionPenalty = sessionPenaltyForPair(pair, session.label);
    const blackout = isInNewsBlackout(news, pair);
    const regime = indicators.market_condition;

    // ── Strategy engine ──────────────────────────────────────────────────────
    // Run all 8 named strategies in parallel; the best-firing one's
    // confidence boosts the indicator vote when they agree (or pulls it
    // down when they disagree). Watchlist (partial setups) is also
    // surfaced so the UI can show what's "almost ready".
    const stratResult = strategies.evaluateAllStrategies({
      ind: indicators, candles, price, pair, session, news,
    });

    const voteResult = voteIndicators(indicators, price, pair, regime);
    const { direction: indicatorDir, agreeing, total, agreeing_indicators } = voteResult;
    let { confidence } = voteResult;

    // Direction: if a strategy fired in the same direction as the indicator
    // vote, that's confirmation. If a strategy fired in the OPPOSITE
    // direction, the indicator vote is suspect — fall back to NEUTRAL
    // unless one side has substantially more weight.
    let direction = indicatorDir;
    let firedStrategy = null;
    if (stratResult.best) {
      firedStrategy = stratResult.best;
      if (indicatorDir === 'NEUTRAL') {
        // Strategy fires even when indicator vote is mixed — adopt it.
        direction = firedStrategy.direction;
        confidence = Math.max(confidence, firedStrategy.confidence);
      } else if (firedStrategy.direction === indicatorDir) {
        // Agreement — boost confidence.
        confidence = Math.min(99, confidence + Math.round(firedStrategy.confidence * 0.15));
      } else {
        // Disagreement — major haircut, often go NEUTRAL.
        confidence -= 20;
      }
    }

    // Multi-strategy consensus bonus: when 2+ strategies fire in the
    // same direction, that's strong confluence.
    if (stratResult.fired_count >= 2 && stratResult.consensus === direction) {
      confidence = Math.min(99, confidence + 8);
    }

    confidence = applyMTFAdjustment(confidence, direction, indicators.mtf);
    confidence = Math.max(0, Math.min(99, confidence - sessionPenalty));

    // ── Calibration lookup ──────────────────────────────────────────────────
    const cal = direction !== 'NEUTRAL'
      ? await calibration.lookup(sym, confidence).catch(() => ({ calibrated: false, sample_size: 0 }))
      : { calibrated: false, sample_size: 0 };

    // Floor logic:
    //   - Calibrated band: require a positive conservative edge (mean R minus
    //     one standard error > 0, net of spread)
    //   - Uncalibrated band: fall back to HEURISTIC_FLOOR
    const meetsCalibration = cal.calibrated
      ? calibration.passesGate(cal)
      : confidence >= HEURISTIC_FLOOR;

    const blocked = blackout !== null;
    const shouldEmit = direction !== 'NEUTRAL' && meetsCalibration && !blocked;

    if (!shouldEmit) {
      const reason = blocked
        ? `News blackout — ${blackout.title} (${blackout.currency}) in ${blackout.minutes} min`
        : direction === 'NEUTRAL'
          ? 'Mixed signals — no decisive direction'
          : cal.calibrated
            ? `No proven edge in this band yet — avg ${cal.avg_r}R after spread over ${cal.sample_size} signals`
            : `Confidence ${confidence}% below floor ${HEURISTIC_FLOOR}%`;

      const signal = {
        symbol: sym,
        display_name: pair.display_name,
        direction: 'NEUTRAL',
        entry: parseFloat(price.toFixed(pair.digits)),
        stop_loss: null, take_profit_1: null, take_profit_2: null,
        confidence,
        strategy: reason,
        fired_strategy: null,
        watchlist: stratResult.watching.slice(0, 3).map(w => ({
          name: w.name, direction: w.direction, completion_pct: w.completion_pct,
          conditions: w.conditions, description: w.description,
        })),
        strategies_fired: stratResult.fired.length,
        market_condition: regime,
        timeframe: 'H1',
        risk_reward: null,
        mtf: indicators.mtf,
        session: session.label,
        news_blackout: blackout,
        calibration: cal,
        timestamp: new Date().toISOString(),
        indicators_agreeing: agreeing,
        total_indicators: total,
        agreeing_indicators,
        abstentions: voteResult.abstentions,
      };

      // Blocked by calibration (not by news, not neutral): keep tracking it as
      // a shadow signal so this band keeps collecting outcome data.
      if (direction !== 'NEUTRAL' && !blocked && cal.calibrated && !meetsCalibration) {
        const lv = calcATRLevels(direction, price, indicators.atr, regime, indicators.support_resistance, pair);
        const slP = Math.abs(price - lv.stop_loss) / pair.pip_size;
        const tpP = Math.abs(price - lv.take_profit_1) / pair.pip_size;
        saveSignal({
          symbol: sym,
          direction,
          entry: parseFloat(price.toFixed(pair.digits)),
          stop_loss: lv.stop_loss,
          take_profit_1: lv.take_profit_1,
          take_profit_2: lv.take_profit_2,
          confidence,
          strategy: firedStrategy ? firedStrategy.name : buildStrategyName(indicators, direction, regime),
          fired_strategy: firedStrategy ? { name: firedStrategy.name } : null,
          market_condition: regime,
          timeframe: 'H1',
          risk_reward: slP > 0 ? `1:${(tpP / slP).toFixed(1)}` : null,
          indicators_agreeing: agreeing,
          total_indicators: total,
        }, { shadow: true }).catch(err => console.error(`[${sym}] shadow save error:`, err.message));
      }

      cache.set(cacheKey, signal,
        Math.min(priceService.secondsUntilCandleClose('1h'), 300));
      return signal;
    }

    const { stop_loss, take_profit_1, take_profit_2 } = calcATRLevels(
      direction, price, indicators.atr, regime, indicators.support_resistance, pair,
    );
    const pipSize = pair.pip_size;
    const slPips  = Math.abs(price - stop_loss)     / pipSize;
    const tp1Pips = Math.abs(price - take_profit_1) / pipSize;
    const rr = slPips > 0 ? `1:${(tp1Pips / slPips).toFixed(1)}` : '1:1.5';

    // Strategy name: prefer the named strategy that fired; fall back to
    // the indicator-based label so we always have something.
    const strategyName = firedStrategy
      ? firedStrategy.name + (stratResult.fired_count > 1 ? ` + ${stratResult.fired_count - 1} more` : '')
      : buildStrategyName(indicators, direction, regime);

    const signal = {
      symbol: sym,
      display_name: pair.display_name,
      direction,
      entry: parseFloat(price.toFixed(pair.digits)),
      stop_loss, take_profit_1, take_profit_2,
      confidence,
      strategy: strategyName,
      // Full firing-strategy detail — UI shows the conditions that hit.
      fired_strategy: firedStrategy ? {
        name: firedStrategy.name,
        description: firedStrategy.description,
        confidence: firedStrategy.confidence,
        conditions: firedStrategy.conditions,
        context: firedStrategy.context,
      } : null,
      // Other strategies that also fired (for "confluence" tags).
      additional_strategies: stratResult.fired
        .filter(s => firedStrategy && s.name !== firedStrategy.name)
        .map(s => ({ name: s.name, direction: s.direction, confidence: s.confidence })),
      // Setups not quite ready — surfaces what to watch next.
      watchlist: stratResult.watching.slice(0, 3).map(w => ({
        name: w.name, direction: w.direction, completion_pct: w.completion_pct,
        conditions: w.conditions, description: w.description,
      })),
      strategies_fired: stratResult.fired_count,
      market_condition: regime,
      timeframe: 'H1',
      risk_reward: rr,
      atr_pips: indicators.atr.available ? indicators.atr.pips : null,
      mtf: indicators.mtf,
      session: session.label,
      news_blackout: null,
      calibration: cal,
      timestamp: new Date().toISOString(),
      indicators_agreeing: agreeing,
      total_indicators: total,
      agreeing_indicators,
      abstentions: voteResult.abstentions,
      margin_ratio: voteResult.margin_ratio,
    };

    cache.set(cacheKey, signal,
      Math.min(priceService.secondsUntilCandleClose('1h'), 300));

    saveSignal(signal)
      .then(row => { if (row) telegram.notifySignal(signal); }) // alert once per stored signal, never on duplicates
      .catch(err => console.error(`[${sym}] saveSignal error:`, err.message));
    return signal;
  } catch (err) {
    console.error(`[${sym}] Signal generation error:`, err.message);
    throw err;
  }
}

module.exports = { generateSignal };
