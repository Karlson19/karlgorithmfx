const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const indicatorService = require('../services/indicatorService');
const signalService = require('../services/signalService');
const priceService = require('../services/priceService');
const newsService = require('../services/newsService');
const { PRIMARY_SYMBOL } = require('../config/pairs');

async function buildAnalysis(symbol) {
  const [indicators, signal, priceData, news] = await Promise.all([
    indicatorService.calculateIndicators('1h', symbol),
    signalService.generateSignal(symbol),
    priceService.fetchLivePrice(symbol),
    newsService.fetchNews(),
  ]);
  return aiService.analyzeMarket(indicators, signal, priceData, news, symbol);
}

router.get('/', async (req, res) => {
  try {
    const symbol = req.query.symbol || PRIMARY_SYMBOL;
    res.json(await buildAnalysis(symbol));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const symbol = req.query.symbol || PRIMARY_SYMBOL;
    aiService.invalidateCache(symbol);
    res.json(await buildAnalysis(symbol));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
