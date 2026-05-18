const express = require('express');
const router = express.Router();
const priceService = require('../services/priceService');
const { listEnabledSymbols, PRIMARY_SYMBOL } = require('../config/pairs');

// GET /api/price/pairs  → list of enabled pairs (frontend bootstrap)
router.get('/pairs', (req, res) => {
  const { PAIRS } = require('../config/pairs');
  res.json(Object.values(PAIRS).filter(p => p.enabled));
});

// GET /api/price/live?symbol=EUR/USD  (default PRIMARY_SYMBOL)
router.get('/live', async (req, res) => {
  try {
    const symbol = req.query.symbol || PRIMARY_SYMBOL;
    const price = await priceService.fetchLivePrice(symbol);
    if (!price) return res.status(503).json({ error: 'Price data unavailable' });
    res.json(price);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/price/live/all  → fetch live price for every enabled pair
router.get('/live/all', async (req, res) => {
  try {
    const symbols = listEnabledSymbols();
    const results = await Promise.allSettled(
      symbols.map(s => priceService.fetchLivePrice(s))
    );
    const out = {};
    results.forEach((r, i) => {
      out[symbols[i]] = r.status === 'fulfilled' ? r.value : null;
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/price/history?symbol=EUR/USD&interval=1h&outputsize=200
router.get('/history', async (req, res) => {
  try {
    const symbol = req.query.symbol || PRIMARY_SYMBOL;
    const interval = req.query.interval || '1h';
    const outputsize = parseInt(req.query.outputsize) || 200;
    const candles = await priceService.fetchHistoricalData(interval, outputsize, symbol);
    res.json(candles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
