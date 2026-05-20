// ─── Named strategy engine ───────────────────────────────────────────────────
// Each strategy is a well-defined trading setup with explicit entry rules.
// Strategies are evaluated in parallel; the one whose conditions are all
// met with the highest confidence wins. Partial matches (≥50% of conditions
// satisfied) populate a "watchlist" so the UI can show setups that are
// almost ready.
//
// Honest framing:
//   These are setups that disciplined traders use, NOT guaranteed-profit
//   formulas. Whether each strategy actually works on a given pair is
//   answered by the calibration system over time. The engine identifies
//   well-defined opportunities; reality decides if they're worth taking.
//
// Strategy shape returned from evaluate():
// {
//   name, description, applicable, direction, conditions: [{name, met, weight}],
//   fired: boolean, confidence: 0-100, completion_pct: 0-1,
//   regime_fit: boolean, session_fit: boolean,
// }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pct(arr) {
  if (!arr || arr.length === 0) return 0;
  const weighted = arr.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const total    = arr.reduce((s, c) => s + c.weight, 0);
  return total > 0 ? weighted / total : 0;
}

function lastCandle(candles) {
  return candles && candles.length > 0 ? candles[candles.length - 1] : null;
}

function isBullishCandle(c) {
  if (!c) return false;
  return c.close > c.open && (c.close - c.open) > (c.high - c.low) * 0.4;
}

function isBearishCandle(c) {
  if (!c) return false;
  return c.close < c.open && (c.open - c.close) > (c.high - c.low) * 0.4;
}

// Pin bar / rejection wick — a candle whose wick is at least 2× the body
// in the rejection direction.
function isBullishPinBar(c) {
  if (!c) return false;
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  return body > 0 && lowerWick >= body * 2 && c.close >= c.open;
}
function isBearishPinBar(c) {
  if (!c) return false;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  return body > 0 && upperWick >= body * 2 && c.close <= c.open;
}

// Distance between price and a level, in pips for the pair.
function distInPips(price, level, pipSize) {
  if (level == null) return Infinity;
  return Math.abs(price - level) / pipSize;
}

// Build the final result object from a list of conditions + direction.
function buildResult({ name, description, applicable, direction, conditions, regime_fit, session_fit, prerequisites_met = true }) {
  const completion = pct(conditions);
  // All-or-nothing for required conditions: only "fired" if every condition
  // marked required is met AND the strategy is applicable to current regime/
  // session AND prerequisites are satisfied.
  const requiredMissing = conditions.filter(c => c.required && !c.met);
  const fired = applicable && prerequisites_met && requiredMissing.length === 0 && direction !== null;
  // Confidence — composite of completion %, regime/session fit, and a
  // base score per strategy (some setups are inherently more reliable
  // than others when their conditions all hit).
  let confidence = Math.round(completion * 100);
  if (!regime_fit) confidence -= 10;
  if (!session_fit) confidence -= 10;
  confidence = Math.max(0, Math.min(99, confidence));

  return {
    name, description,
    applicable,
    regime_fit,
    session_fit,
    direction,
    conditions,
    fired,
    confidence,
    completion_pct: parseFloat(completion.toFixed(3)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 1: EMA Pullback (trend continuation)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: in an established trend, price periodically pulls back to a
//  fast moving average before continuing. Enter on the bounce.
function emaPullback(ctx) {
  const { ind, candles, price, pair, session } = ctx;
  const regime_fit = ind.market_condition === 'TRENDING';
  const session_fit = ['LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP'].includes(session.label);

  // Direction from H4 trend bias (the higher timeframe)
  const trend = ind.mtf.h4_bias;
  let direction = null;
  if (trend === 'BUY' || trend === 'SELL') direction = trend;

  const last = lastCandle(candles);
  const ema20 = ind.ema20.value;
  const ema50 = ind.ema50.value;
  const rsi = ind.rsi.value;
  const pipSize = pair.pip_size;

  // Pullback proximity: how close are we to EMA20 (the dynamic S/R)?
  const distToEma20 = ind.ema20.available ? distInPips(price, ema20, pipSize) : Infinity;
  const closeToEma20 = distToEma20 < 15;

  const conditions = [
    { name: 'H4 trend exists', met: trend === 'BUY' || trend === 'SELL', weight: 1, required: true },
    { name: 'ADX confirms trend (≥20)', met: ind.adx.available && ind.adx.value >= 20, weight: 1, required: true },
    { name: 'EMA20 > EMA50 (bull) / < (bear)', met: ind.ema20.available && ind.ema50.available &&
        ((direction === 'BUY'  && ema20 > ema50) ||
         (direction === 'SELL' && ema20 < ema50)), weight: 1, required: true },
    { name: 'Price pulled back to EMA20 (≤15 pips)', met: closeToEma20, weight: 1.5, required: true },
    { name: 'RSI bouncing from 40 (bull) / 60 (bear)', met: ind.rsi.available &&
        ((direction === 'BUY'  && rsi >= 38 && rsi <= 55) ||
         (direction === 'SELL' && rsi <= 62 && rsi >= 45)), weight: 1, required: false },
    { name: 'Bounce candle in trend direction', met:
        (direction === 'BUY'  && (isBullishCandle(last) || isBullishPinBar(last))) ||
        (direction === 'SELL' && (isBearishCandle(last) || isBearishPinBar(last))),
      weight: 1.2, required: false },
  ];

  return buildResult({
    name: 'EMA Pullback',
    description: 'Trend continuation entry after a pullback to the 20 EMA',
    applicable: regime_fit && direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 2: Asian Range Breakout (London session opener)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: the Asian session typically forms a tight range. London opens
//  often break this range with momentum. Enter on the break, target the
//  range height.
function asianRangeBreakout(ctx) {
  const { ind, candles, price, pair, session } = ctx;
  const utcHour = session.utc_hour;
  // Best window: London open through first NY hour (07-13 UTC)
  const session_fit = utcHour >= 7 && utcHour < 14;
  // Regime: was likely RANGING during Asian session
  const regime_fit = true; // works across regimes — defining condition is the range itself

  // Build the Asian session range from candles: typically 23:00 prev day
  // through 07:00 UTC today. We approximate by taking the last 8 H1
  // candles before the current London-active period.
  let asianHigh = -Infinity, asianLow = Infinity;
  let asianCandlesFound = 0;
  if (candles && candles.length >= 10) {
    // Walk backwards through candles to find ones whose UTC hour is in [23, 07]
    for (let i = candles.length - 2; i >= Math.max(0, candles.length - 30); i--) {
      const c = candles[i];
      const h = new Date(c.time * 1000).getUTCHours();
      if (h >= 23 || h < 7) {
        if (c.high > asianHigh) asianHigh = c.high;
        if (c.low  < asianLow)  asianLow  = c.low;
        asianCandlesFound++;
      } else if (asianCandlesFound > 0) {
        // We've walked past the Asian block
        break;
      }
    }
  }

  const haveRange = asianCandlesFound >= 4 && isFinite(asianHigh) && isFinite(asianLow);
  const rangePips = haveRange ? (asianHigh - asianLow) / pair.pip_size : 0;
  // Want a reasonably tight Asian range (not after wild news) — under 80 pips for FX.
  const tightRange = rangePips > 0 && rangePips < 80;
  // For gold the scale differs — clamp to a sensible band.
  const sensibleRange = pair.symbol === 'XAU/USD' ? rangePips < 800 : tightRange;

  const breakAbove = haveRange && price > asianHigh;
  const breakBelow = haveRange && price < asianLow;
  const direction = breakAbove ? 'BUY' : breakBelow ? 'SELL' : null;

  const atrAvailable = ind.atr.available;
  const atrExpanding = atrAvailable && ind.atr.value > pair.atr_floor * 1.2;

  const conditions = [
    { name: 'Asian range identified (≥4 candles)', met: haveRange, weight: 1, required: true },
    { name: 'Range size is sensible', met: sensibleRange, weight: 1, required: true },
    { name: 'Price broke range high / low', met: breakAbove || breakBelow, weight: 1.5, required: true },
    { name: 'ATR expanding (momentum)', met: atrExpanding, weight: 1, required: false },
    { name: 'MACD aligned with break', met: ind.macd.available &&
        ((direction === 'BUY'  && ind.macd.histogram > 0) ||
         (direction === 'SELL' && ind.macd.histogram < 0)), weight: 1, required: false },
    { name: 'H4 bias agrees', met: ind.mtf.h4_bias === direction, weight: 1, required: false },
  ];

  return buildResult({
    name: 'Asian Range Breakout',
    description: 'London session break of Asian-session range with momentum',
    applicable: session_fit && haveRange && direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 3: Bollinger Squeeze Breakout (volatility expansion)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: when Bollinger Bands contract (squeeze), volatility expansion is
//  likely. Enter in the direction of the breakout once it begins.
function bollingerSqueeze(ctx) {
  const { ind, candles, price, pair, session } = ctx;
  const session_fit = !['DEAD_ZONE'].includes(session.label);

  // A "squeeze" = current band width < 70% of the recent average.
  const bw = ind.bollinger.available ? ind.bollinger.width : null;
  if (bw === null || !candles || candles.length < 30) {
    return buildResult({
      name: 'Bollinger Squeeze Breakout',
      description: 'Volatility expansion out of a band contraction',
      applicable: false, direction: null, regime_fit: false, session_fit,
      conditions: [{ name: 'Bollinger data available', met: false, weight: 1, required: true }],
    });
  }

  // Recompute approximate Bollinger width on a few recent windows for comparison.
  // Since we already have the current width, approximate "recent avg" using
  // the average price range over the last 20 bars × 2 (rough proxy for 2 stddev).
  const last20 = candles.slice(-20);
  const avgRange = last20.reduce((s, c) => s + (c.high - c.low), 0) / last20.length;
  const recentWidthProxy = avgRange * 4; // very rough — Bollinger is stddev*4 wide
  const squeezed = bw < recentWidthProxy * 0.7;

  const upper = ind.bollinger.upper;
  const lower = ind.bollinger.lower;
  const breakUp   = price > upper;
  const breakDown = price < lower;
  const direction = breakUp ? 'BUY' : breakDown ? 'SELL' : null;
  const regime_fit = squeezed; // the setup itself

  const conditions = [
    { name: 'Bands are squeezed (low vol)', met: squeezed, weight: 1, required: true },
    { name: 'Price broke a band', met: breakUp || breakDown, weight: 1.5, required: true },
    { name: 'Volume / range expansion', met: candles && candles.length >= 2 &&
        (candles[candles.length-1].high - candles[candles.length-1].low) > avgRange * 1.3,
      weight: 1, required: false },
    { name: 'ADX rising', met: ind.adx.available && ind.adx.value > 18, weight: 1, required: false },
    { name: 'MACD aligns with break', met: ind.macd.available &&
        ((direction === 'BUY'  && ind.macd.histogram > 0) ||
         (direction === 'SELL' && ind.macd.histogram < 0)), weight: 1, required: false },
  ];

  return buildResult({
    name: 'Bollinger Squeeze Breakout',
    description: 'Volatility expansion out of a Bollinger contraction',
    applicable: squeezed && direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 4: Mean Reversion at S/R (range trade)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: in a range, price rejected at known support/resistance is a
//  mean-reversion entry. Confirmation: rejection candle + oscillator extreme.
function srMeanReversion(ctx) {
  const { ind, candles, price, pair, session } = ctx;
  const regime_fit = ind.market_condition === 'RANGING';
  const session_fit = !['DEAD_ZONE'].includes(session.label);

  const last = lastCandle(candles);
  const sr = ind.support_resistance || { resistance: [], support: [] };
  const pipSize = pair.pip_size;
  const atrVal = ind.atr.available ? ind.atr.value : pair.atr_floor;
  const proximityPips = Math.max((atrVal * 0.4) / pipSize, 5);

  const nearResistance = sr.resistance[0] != null &&
    distInPips(price, sr.resistance[0], pipSize) < proximityPips;
  const nearSupport    = sr.support[0] != null &&
    distInPips(price, sr.support[0], pipSize) < proximityPips;

  let direction = null;
  if (nearResistance) direction = 'SELL';
  else if (nearSupport) direction = 'BUY';

  const rsi = ind.rsi.value;
  const rsiExtreme = ind.rsi.available && (
    (direction === 'BUY'  && rsi <= 35) ||
    (direction === 'SELL' && rsi >= 65)
  );
  const rejectionCandle =
    (direction === 'BUY'  && (isBullishPinBar(last) || isBullishCandle(last))) ||
    (direction === 'SELL' && (isBearishPinBar(last) || isBearishCandle(last)));

  const conditions = [
    { name: 'Price at major S/R level', met: nearResistance || nearSupport, weight: 1.5, required: true },
    { name: 'Rejection candle formed', met: rejectionCandle, weight: 1.5, required: true },
    { name: 'RSI at extreme aligned with reversal', met: rsiExtreme, weight: 1, required: false },
    { name: 'ADX low (ranging, not trending)', met: ind.adx.available && ind.adx.value < 25, weight: 1, required: false },
    { name: 'Bollinger band touched',
      met: ind.bollinger.available && (
        (direction === 'BUY'  && price <= ind.bollinger.lower) ||
        (direction === 'SELL' && price >= ind.bollinger.upper)
      ), weight: 1, required: false },
  ];

  return buildResult({
    name: 'S/R Mean Reversion',
    description: 'Counter-trend entry at a major support/resistance level with rejection',
    applicable: regime_fit && direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 5: Liquidity Sweep Reversal (stop-hunt fade)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: price briefly pokes through a recent swing high/low (sweeping
//  stops) and immediately reverses, leaving a long wick. Counter-trend entry.
function liquiditySweep(ctx) {
  const { ind, candles, price, pair, session } = ctx;
  const session_fit = ['LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP', 'ASIAN'].includes(session.label);
  // Works in any regime but most reliable after extension into a level.
  const regime_fit = true;

  if (!candles || candles.length < 30) {
    return buildResult({
      name: 'Liquidity Sweep Reversal',
      description: 'Counter-trend entry after a stop-hunt sweep of a swing point',
      applicable: false, direction: null, regime_fit, session_fit,
      conditions: [{ name: 'Sufficient candles', met: false, weight: 1, required: true }],
    });
  }

  const last = lastCandle(candles);
  const recent = candles.slice(-30, -1); // exclude current candle
  const swingHigh = Math.max(...recent.map(c => c.high));
  const swingLow  = Math.min(...recent.map(c => c.low));

  // Sweep: current candle's high pierced swingHigh but closed back below
  // (bearish sweep) or low pierced swingLow but closed back above (bullish).
  const sweptHigh = last && last.high > swingHigh && last.close < swingHigh;
  const sweptLow  = last && last.low  < swingLow  && last.close > swingLow;
  const direction = sweptHigh ? 'SELL' : sweptLow ? 'BUY' : null;

  const wickRatio = (() => {
    if (!last) return 0;
    const body = Math.abs(last.close - last.open);
    if (body <= 0) return 0;
    if (sweptHigh) return (last.high - Math.max(last.open, last.close)) / body;
    if (sweptLow)  return (Math.min(last.open, last.close) - last.low)  / body;
    return 0;
  })();

  const conditions = [
    { name: 'Recent swing high/low identified', met: isFinite(swingHigh) && isFinite(swingLow), weight: 1, required: true },
    { name: 'Wick swept the swing point', met: sweptHigh || sweptLow, weight: 1.5, required: true },
    { name: 'Wick is ≥2× body (strong rejection)', met: wickRatio >= 2, weight: 1.2, required: true },
    { name: 'RSI at extreme', met: ind.rsi.available && (
        (direction === 'BUY'  && ind.rsi.value <= 40) ||
        (direction === 'SELL' && ind.rsi.value >= 60)
      ), weight: 1, required: false },
    { name: 'Volume/range above average',
      met: last && (last.high - last.low) > (recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length) * 1.5,
      weight: 1, required: false },
  ];

  return buildResult({
    name: 'Liquidity Sweep Reversal',
    description: 'Counter-trend entry after a stop-hunt sweep of a swing point',
    applicable: direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 6: MTF Confluence Entry (top-down)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: H4 trend + H1 confirmation + M15 trigger all aligned. Highest
//  probability standard setup.
function mtfConfluence(ctx) {
  const { ind, session } = ctx;
  const session_fit = ['LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP'].includes(session.label);
  const regime_fit = ind.market_condition === 'TRENDING';

  const h4 = ind.mtf.h4_bias;
  const h1 = ind.mtf.h1_bias;
  const m15 = ind.mtf.m15_bias;

  let direction = null;
  if (h4 === 'BUY'  && h1 === 'BUY'  && m15 === 'BUY')  direction = 'BUY';
  if (h4 === 'SELL' && h1 === 'SELL' && m15 === 'SELL') direction = 'SELL';

  const conditions = [
    { name: 'H4 bias in direction', met: h4 === direction, weight: 1.2, required: true },
    { name: 'H1 bias in direction', met: h1 === direction, weight: 1.2, required: true },
    { name: 'M15 bias in direction', met: m15 === direction, weight: 1.2, required: true },
    { name: 'ADX confirms trend',   met: ind.adx.available && ind.adx.value >= 22, weight: 1, required: false },
    { name: 'EMA200 supports',      met: ind.ema200.available && ind.ema200.signal === direction, weight: 1, required: false },
  ];

  return buildResult({
    name: 'MTF Confluence',
    description: 'All three timeframes (H4 / H1 / M15) aligned — high-probability trend entry',
    applicable: direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 7: Pivot Bounce / Break (daily pivot levels)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: daily pivots are widely-watched levels. Price often reacts at
//  S1/S2/R1/R2/PP — either bouncing (mean revert) or breaking (continuation).
function pivotReaction(ctx) {
  const { ind, candles, price, pair, session } = ctx;
  const session_fit = !['DEAD_ZONE'].includes(session.label);
  const regime_fit = true; // pivots work in any regime

  if (!ind.pivot_points) {
    return buildResult({
      name: 'Pivot Reaction',
      description: 'Bounce or break of a daily pivot level',
      applicable: false, direction: null, regime_fit, session_fit,
      conditions: [{ name: 'Daily pivots available', met: false, weight: 1, required: true }],
    });
  }

  const pp = ind.pivot_points;
  const last = lastCandle(candles);
  const pipSize = pair.pip_size;
  const tol = Math.max((ind.atr.value || pair.atr_floor) * 0.3 / pipSize, 4);

  // Find the nearest pivot level
  const levels = [
    { v: pp.s2, type: 'support',    label: 'S2' },
    { v: pp.s1, type: 'support',    label: 'S1' },
    { v: pp.pp, type: 'pivot',      label: 'PP' },
    { v: pp.r1, type: 'resistance', label: 'R1' },
    { v: pp.r2, type: 'resistance', label: 'R2' },
  ];
  const nearest = levels
    .map(l => ({ ...l, dist: distInPips(price, l.v, pipSize) }))
    .sort((a, b) => a.dist - b.dist)[0];
  const atLevel = nearest && nearest.dist < tol;

  let direction = null;
  let setupKind = null;
  if (atLevel) {
    if (nearest.type === 'support'    && isBullishPinBar(last))  { direction = 'BUY';  setupKind = 'bounce'; }
    else if (nearest.type === 'resistance' && isBearishPinBar(last)) { direction = 'SELL'; setupKind = 'bounce'; }
    else if (nearest.type === 'support'    && last && last.close < nearest.v && isBearishCandle(last)) { direction = 'SELL'; setupKind = 'break'; }
    else if (nearest.type === 'resistance' && last && last.close > nearest.v && isBullishCandle(last)) { direction = 'BUY';  setupKind = 'break'; }
  }

  const conditions = [
    { name: 'Price at a daily pivot level', met: !!atLevel, weight: 1.5, required: true },
    { name: 'Clear bounce/break candle', met: direction !== null, weight: 1.5, required: true },
    { name: 'H4 bias aligns', met: ind.mtf.h4_bias === direction, weight: 1, required: false },
    { name: 'RSI confirms direction',
      met: ind.rsi.available && (
        (direction === 'BUY'  && ind.rsi.value > 45) ||
        (direction === 'SELL' && ind.rsi.value < 55)
      ), weight: 1, required: false },
  ];

  const result = buildResult({
    name: 'Pivot Reaction',
    description: setupKind === 'break'
      ? 'Break of a daily pivot level with momentum'
      : 'Bounce off a daily pivot level with rejection',
    applicable: atLevel && direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
  if (nearest) result.context = { level: nearest.label, level_price: nearest.v, setup_kind: setupKind };
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 8: News Fade (post-volatility mean reversion)
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: after a HIGH-impact news event, the initial spike often
//  over-extends and reverses within 30-60 min. Counter-trend fade.
//  Note: ONLY emits in the POST-news window, never inside the blackout.
function newsFade(ctx) {
  const { ind, candles, news, pair, session } = ctx;
  const session_fit = !['DEAD_ZONE'].includes(session.label);
  const regime_fit = ind.market_condition === 'VOLATILE';

  // Find a HIGH-impact news event for this pair that was released in the
  // last 15-60 minutes (the fade window).
  const now = Date.now();
  const recentNews = (news || []).find(n => {
    if (n.impact !== 'HIGH') return false;
    if (!pair.news_currencies.includes(n.currency)) return false;
    const ageMin = (now - new Date(n.date).getTime()) / 60000;
    return ageMin > 15 && ageMin < 60;
  });

  const last = lastCandle(candles);
  const recent = candles && candles.length >= 5 ? candles.slice(-5, -1) : [];
  const avgRange = recent.length > 0 ? recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length : 0;
  const overExtended = last && avgRange > 0 && (last.high - last.low) > avgRange * 2;
  const wickRevealsReversal =
    last && (isBullishPinBar(last) || isBearishPinBar(last));

  const direction = !last ? null
    : isBullishPinBar(last) ? 'BUY'
    : isBearishPinBar(last) ? 'SELL'
    : null;

  const conditions = [
    { name: 'HIGH-impact news in last 15-60 min', met: !!recentNews, weight: 1, required: true },
    { name: 'Over-extended candle (≥2× recent range)', met: overExtended, weight: 1.2, required: true },
    { name: 'Pin-bar / rejection wick formed', met: wickRevealsReversal, weight: 1.5, required: true },
    { name: 'RSI at extreme',
      met: ind.rsi.available && (
        (direction === 'BUY'  && ind.rsi.value <= 30) ||
        (direction === 'SELL' && ind.rsi.value >= 70)
      ), weight: 1, required: false },
  ];

  const result = buildResult({
    name: 'News Fade',
    description: 'Counter-trend entry against an over-extended post-news spike',
    applicable: !!recentNews && direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
  if (recentNews) result.context = { news_title: recentNews.title, news_currency: recentNews.currency };
  return result;
}

// ─── Registry ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 9: RSI Divergence Reversal
// ═══════════════════════════════════════════════════════════════════════════
//  Idea: when price prints a new extreme (lower low / higher high) but RSI
//  does NOT, momentum is exhausting → counter-trend reversal entry.
//  Bullish divergence → BUY. Bearish → SELL.
//
//  Requires the divergenceService to have detected one. The divergence is
//  computed on the H1 candles passed in through ctx.candles. (Higher-TF
//  divergence — H4 — is added as a confluence bonus elsewhere.)
const { detectDivergence } = require('./divergenceService');

function divergenceReversal(ctx) {
  const { ind, candles, session } = ctx;
  // Works in any regime but most reliable when ADX is moderate (trend has
  // had room to extend but isn't accelerating).
  const adxVal = ind.adx && ind.adx.available ? ind.adx.value : null;
  const regime_fit = adxVal !== null && adxVal >= 18 && adxVal <= 35;
  const session_fit = ['LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP'].includes(session.label);

  const div = detectDivergence(candles, 30);
  let direction = null;
  if (div.type === 'bullish') direction = 'BUY';
  else if (div.type === 'bearish') direction = 'SELL';

  const conditions = [
    { name: 'Divergence detected on H1', met: div.type !== null, weight: 2, required: true },
    { name: 'Divergence strength ≥ 0.3', met: div.strength >= 0.3, weight: 1, required: true },
    { name: 'RSI at extreme aligned with reversal', met: ind.rsi.available && (
        (direction === 'BUY'  && ind.rsi.value <= 35) ||
        (direction === 'SELL' && ind.rsi.value >= 65)
      ), weight: 1.2, required: false },
    { name: 'ADX moderate (18-35) — trend not accelerating', met: regime_fit, weight: 1, required: false },
    { name: 'H4 bias agrees with divergence (counter-H1-trend)', met:
        (direction === 'BUY'  && (ind.mtf.h4_bias === 'BUY' || ind.mtf.h4_bias === 'NEUTRAL')) ||
        (direction === 'SELL' && (ind.mtf.h4_bias === 'SELL' || ind.mtf.h4_bias === 'NEUTRAL')),
      weight: 1, required: false },
  ];

  const result = buildResult({
    name: 'RSI Divergence Reversal',
    description: div.type
      ? `${div.type === 'bullish' ? 'Bullish' : 'Bearish'} RSI divergence — momentum exhausting`
      : 'Awaiting RSI divergence pattern',
    applicable: div.type !== null && direction !== null,
    direction,
    conditions,
    regime_fit,
    session_fit,
  });
  if (div.type) result.context = {
    div_type: div.type, strength: parseFloat(div.strength.toFixed(2)),
    rsi_change: div.rsi_change,
  };
  return result;
}

const STRATEGIES = [
  emaPullback,
  asianRangeBreakout,
  bollingerSqueeze,
  srMeanReversion,
  liquiditySweep,
  mtfConfluence,
  pivotReaction,
  newsFade,
  divergenceReversal,
];

// Run every strategy and return:
//   - all: every strategy's evaluation
//   - fired: strategies that fully fired in the same direction
//   - watching: partial setups ≥50% complete (UI watchlist)
//   - best: highest-confidence fired strategy (or null)
function evaluateAllStrategies(ctx) {
  const all = STRATEGIES.map(s => {
    try { return s(ctx); }
    catch (err) {
      return {
        name: s.name || 'unknown', applicable: false, fired: false,
        direction: null, confidence: 0, completion_pct: 0,
        conditions: [{ name: 'evaluation error', met: false, weight: 1 }],
        error: err.message,
      };
    }
  });

  const fired = all.filter(r => r.fired);
  const watching = all
    .filter(r => !r.fired && r.applicable && r.completion_pct >= 0.5)
    .sort((a, b) => b.completion_pct - a.completion_pct);

  const best = fired
    .slice()
    .sort((a, b) => b.confidence - a.confidence)[0] || null;

  // Consensus direction across all FIRED strategies — when multiple strategies
  // agree on direction, that's strong confirmation.
  const buyFired  = fired.filter(r => r.direction === 'BUY').length;
  const sellFired = fired.filter(r => r.direction === 'SELL').length;
  const consensus = buyFired > sellFired ? 'BUY'
                  : sellFired > buyFired ? 'SELL'
                  : null;

  return { all, fired, watching, best, consensus, fired_count: fired.length };
}

module.exports = { evaluateAllStrategies, STRATEGIES };
