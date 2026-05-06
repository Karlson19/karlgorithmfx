const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const indicatorService = require('../services/indicatorService');
const signalService = require('../services/signalService');
const priceService = require('../services/priceService');
const newsService = require('../services/newsService');

router.get('/', async (req, res) => {
  try {
    const [indicators, signal, priceData, news] = await Promise.all([
      indicatorService.calculateIndicators('1h'),
      signalService.generateSignal(),
      priceService.fetchLivePrice(),
      newsService.fetchNews()
    ]);

    const analysis = await aiService.analyzeMarket(indicators, signal, priceData, news);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    aiService.invalidateCache();
    const [indicators, signal, priceData, news] = await Promise.all([
      indicatorService.calculateIndicators('1h'),
      signalService.generateSignal(),
      priceService.fetchLivePrice(),
      newsService.fetchNews()
    ]);
    const analysis = await aiService.analyzeMarket(indicators, signal, priceData, news);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
