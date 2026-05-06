const cache = require('../utils/cache');

async function analyzeMarket(indicators, signal, priceData, news) {
  const cached = cache.get('ai_analysis');
  if (cached) return cached;

  const prompt = `You are an expert EUR/USD forex analyst. Analyze the following market data and provide a professional trading analysis.

CURRENT MARKET DATA:
- EUR/USD Price: ${priceData.price}
- Direction: ${signal.direction}
- Confidence: ${signal.confidence}%
- Strategy: ${signal.strategy}
- Market Condition: ${signal.market_condition}

TECHNICAL INDICATORS:
- RSI (14): ${indicators.rsi.value} → ${indicators.rsi.signal}
- MACD: ${indicators.macd.value} → ${indicators.macd.signal}
- EMA 20: ${indicators.ema20.value} → ${indicators.ema20.signal}
- EMA 50: ${indicators.ema50.value} → ${indicators.ema50.signal}
- EMA 200: ${indicators.ema200.value} → ${indicators.ema200.signal}
- Bollinger Bands: Upper ${indicators.bollinger.upper}, Lower ${indicators.bollinger.lower}
- ADX: ${indicators.adx.value} (${indicators.adx.trending ? 'Trending' : 'Not Trending'})
- Stochastic: K=${indicators.stochastic.k}, D=${indicators.stochastic.d}

KEY LEVELS:
- Resistance: ${(indicators.support_resistance.resistance || []).join(', ')}
- Support: ${(indicators.support_resistance.support || []).join(', ')}
- Fibonacci 50%: ${indicators.fibonacci.levels['50']}
- Fibonacci 61.8%: ${indicators.fibonacci.levels['61.8']}

SIGNAL DETAILS:
- Entry: ${signal.entry}
- Stop Loss: ${signal.stop_loss}
- Take Profit 1: ${signal.take_profit_1}
- Take Profit 2: ${signal.take_profit_2}
- Risk/Reward: ${signal.risk_reward}

UPCOMING NEWS:
${(news || []).slice(0, 3).map(n => `- ${n.title}: ${n.date} (${n.impact} impact)`).join('\n')}

Provide a professional analysis in this exact JSON format:
{
  "summary": "2-3 sentence market summary",
  "reasoning": "Detailed explanation of why this signal makes sense based on the indicators",
  "risks": "Key risks to watch for this trade",
  "recommendation": "Specific actionable recommendation including lot size caution if news nearby",
  "session_advice": "Advice based on current market session timing"
}

Respond ONLY with the JSON object, no markdown, no extra text.`;

  try {
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

    if (!data.choices || !data.choices[0]) {
      throw new Error('No response from primary model');
    }

    const text = data.choices[0].message.content;
    const analysis = JSON.parse(text);
    analysis.generated_at = new Date().toISOString();
    analysis.model = 'claude-sonnet-4-5';

    cache.set('ai_analysis', analysis, 900); // 15 min
    return analysis;
  } catch (primaryErr) {
    console.error('Primary AI model error:', primaryErr.message);

    // Fallback to Llama
    try {
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

      cache.set('ai_analysis', analysis, 900);
      return analysis;
    } catch (fallbackErr) {
      console.error('Fallback AI error:', fallbackErr.message);
      return {
        summary: `EUR/USD is currently trading at ${priceData.price} with a ${signal.direction} signal at ${signal.confidence}% confidence.`,
        reasoning: `Based on ${signal.indicators_agreeing} of ${signal.total_indicators} indicators agreeing, the ${signal.strategy} strategy suggests a ${signal.direction} opportunity.`,
        risks: 'Monitor upcoming economic news releases and manage position size carefully.',
        recommendation: `Consider a ${signal.direction} position with risk management. Risk/Reward: ${signal.risk_reward}.`,
        session_advice: 'Best trading opportunities occur during London and New York session overlap (12:00-16:00 UTC).',
        generated_at: new Date().toISOString(),
        model: 'fallback'
      };
    }
  }
}

function invalidateCache() {
  cache.del('ai_analysis');
}

module.exports = { analyzeMarket, invalidateCache };
