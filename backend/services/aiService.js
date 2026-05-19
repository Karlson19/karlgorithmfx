const cache = require('../utils/cache');
const quota = require('../utils/quotaTracker');
const { getPair, PRIMARY_SYMBOL } = require('../config/pairs');

// Safe formatter — indicators may report `available: false` with null
// numeric fields. We render "n/a" so the LLM doesn't see literal "null".
const fmt = (v, d = 2) => (v == null || !isFinite(v) ? 'n/a' : Number(v).toFixed(d));
const indLine = (label, ind, formatter) =>
  ind && ind.available
    ? `- ${label}: ${formatter(ind)}`
    : `- ${label}: n/a (insufficient data)`;

async function analyzeMarket(indicators, signal, priceData, news, symbol = PRIMARY_SYMBOL) {
  const sym = signal.symbol || symbol;
  const pair = getPair(sym) || getPair(PRIMARY_SYMBOL);
  const cacheKey = `ai_analysis_${sym}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const abstentionsLine = signal.abstentions && signal.abstentions.length
    ? `\n- Abstaining indicators (no clear reading): ${signal.abstentions.join(', ')}`
    : '';
  const calLine = signal.calibration && signal.calibration.calibrated
    ? `\n- Historical win rate for this confidence band on ${sym}: ${signal.calibration.win_rate}% (n=${signal.calibration.sample_size})`
    : `\n- Confidence band on ${sym} is not yet calibrated (samples: ${signal.calibration ? signal.calibration.sample_size : 0})`;
  const blackoutLine = signal.news_blackout
    ? `\n- NEWS BLACKOUT ACTIVE: ${signal.news_blackout.title} (${signal.news_blackout.currency}) in ${signal.news_blackout.minutes} min — signal suppressed`
    : '';

  const digits = pair.digits;
  const prompt = `You are an expert forex analyst. Analyse the following ${pair.display_name} market data and produce a professional trading analysis.

CURRENT MARKET DATA:
- Pair: ${pair.display_name}
- Pair character: ${pair.description}
- Price: ${priceData && priceData.price ? Number(priceData.price).toFixed(digits) : signal.entry}
- Direction: ${signal.direction}
- Confidence: ${signal.confidence}%
- Strategy: ${signal.strategy}
- Market Condition: ${signal.market_condition}
- Trading Session: ${signal.session || 'unknown'}${abstentionsLine}${calLine}${blackoutLine}

TECHNICAL INDICATORS (only available ones listed):
${indLine('RSI (14)',  indicators.rsi,       i => `${fmt(i.value)} → ${i.signal}`)}
${indLine('MACD',      indicators.macd,      i => `${fmt(i.value, 6)} → ${i.signal} (hist ${fmt(i.histogram, 6)})`)}
${indLine('EMA 20',    indicators.ema20,     i => `${fmt(i.value, digits)} → ${i.signal}`)}
${indLine('EMA 50',    indicators.ema50,     i => `${fmt(i.value, digits)} → ${i.signal}`)}
${indLine('EMA 200',   indicators.ema200,    i => `${fmt(i.value, digits)} → ${i.signal}`)}
${indLine('Bollinger', indicators.bollinger, i => `Upper ${fmt(i.upper, digits)}, Lower ${fmt(i.lower, digits)} → ${i.signal}`)}
${indLine('ADX (14)',  indicators.adx,       i => `${fmt(i.value)} (${i.trending ? 'Trending' : 'Not Trending'})`)}
${indLine('Stochastic',indicators.stochastic,i => `K=${fmt(i.k, 1)}, D=${fmt(i.d, 1)} → ${i.signal}`)}
${indLine('Williams %R', indicators.williamsR, i => `${fmt(i.value)} → ${i.signal}`)}
${indLine('CCI (20)',  indicators.cci,       i => `${fmt(i.value)} → ${i.signal}`)}
${indLine('Ichimoku',  indicators.ichimoku,  i => `${i.cloud_position} → ${i.signal}`)}
${indLine('ATR (14)',  indicators.atr,       i => `${fmt(i.value, digits)} (${i.pips} pips)`)}

MULTI-TIMEFRAME BIAS:
- H4: ${indicators.mtf.h4_bias}
- H1: ${indicators.mtf.h1_bias}
- M15: ${indicators.mtf.m15_bias}
- Aligned: ${indicators.mtf.aligned ? 'YES' : 'NO'}

KEY LEVELS:
- Resistance: ${(indicators.support_resistance.resistance || []).join(', ') || 'none detected'}
- Support: ${(indicators.support_resistance.support || []).join(', ') || 'none detected'}
- Fibonacci 50%: ${indicators.fibonacci.levels['50']}
- Fibonacci 61.8%: ${indicators.fibonacci.levels['61.8']}

SIGNAL DETAILS:
- Entry: ${signal.entry}
- Stop Loss: ${signal.stop_loss ?? 'n/a'}
- Take Profit 1: ${signal.take_profit_1 ?? 'n/a'}
- Take Profit 2: ${signal.take_profit_2 ?? 'n/a'}
- Risk/Reward: ${signal.risk_reward ?? 'n/a'}

UPCOMING NEWS (filter to ${pair.news_currencies.join('/')}):
${(news || [])
  .filter(n => pair.news_currencies.includes(n.currency))
  .slice(0, 3)
  .map(n => `- ${n.title}: ${n.date} (${n.impact} impact)`)
  .join('\n') || '- None'}

Provide a professional analysis in this exact JSON format:
{
  "summary": "2-3 sentence market summary for ${pair.display_name}",
  "reasoning": "Detailed explanation of why this signal makes sense based on the indicators and regime",
  "risks": "Key risks to watch — include news risk if relevant",
  "recommendation": "Specific actionable recommendation including lot size caution if news nearby",
  "session_advice": "Advice based on current market session timing for ${pair.display_name}"
}

Respond ONLY with the JSON object, no markdown, no extra text.`;

  try {
    quota.recordCall('openrouter');
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
        'X-Title': 'KarlgorithmFX'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!data.choices || !data.choices[0]) throw new Error('No response from primary model');

    const text = data.choices[0].message.content;
    const analysis = JSON.parse(text);
    analysis.generated_at = new Date().toISOString();
    analysis.model = 'claude-sonnet-4-5';
    analysis.symbol = sym;

    cache.set(cacheKey, analysis, 900);
    return analysis;
  } catch (primaryErr) {
    console.error(`[${sym}] Primary AI model error:`, primaryErr.message);

    try {
      quota.recordCall('openrouter');
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
          'X-Title': 'KarlgorithmFX'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.1-8b-instruct',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();
      const text = data.choices[0].message.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse fallback response');
      const analysis = JSON.parse(jsonMatch[0]);
      analysis.generated_at = new Date().toISOString();
      analysis.model = 'llama-3.1-8b';
      analysis.symbol = sym;

      cache.set(cacheKey, analysis, 900);
      return analysis;
    } catch (fallbackErr) {
      console.error(`[${sym}] Fallback AI error:`, fallbackErr.message);
      return {
        summary: `${pair.display_name} is currently trading at ${priceData && priceData.price ? Number(priceData.price).toFixed(digits) : signal.entry} with a ${signal.direction} signal at ${signal.confidence}% confidence.`,
        reasoning: `Based on ${signal.indicators_agreeing} of ${signal.total_indicators} indicators agreeing in the ${signal.market_condition} regime, the ${signal.strategy} strategy suggests a ${signal.direction} opportunity on ${pair.display_name}.`,
        risks: 'Monitor upcoming economic news releases and manage position size carefully.',
        recommendation: `Consider a ${signal.direction} position with risk management. Risk/Reward: ${signal.risk_reward}.`,
        session_advice: `Best ${pair.display_name} opportunities occur during ${Object.entries(pair.session_weights).filter(([, w]) => w >= 0.9).map(([s]) => s).join(', ')}.`,
        generated_at: new Date().toISOString(),
        model: 'fallback',
        symbol: sym,
      };
    }
  }
}

function invalidateCache(symbol = null) {
  if (symbol) cache.del(`ai_analysis_${symbol}`);
  else cache.del('ai_analysis'); // legacy
}

module.exports = { analyzeMarket, invalidateCache };
