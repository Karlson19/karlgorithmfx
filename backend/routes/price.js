const express = require('express');
const router = express.Router();
const priceService = require('../services/priceService');

router.get('/live', async (req, res) => {
  try {
    const price = await priceService.fetchLivePrice();
    if (!price) return res.status(503).json({ error: 'Price data unavailable' });
    res.json(price);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const { interval = '1h', outputsize = 200 } = req.query;
    const candles = await priceService.fetchHistoricalData(interval, parseInt(outputsize));
    res.json(candles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
