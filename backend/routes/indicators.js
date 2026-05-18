const express = require('express');
const router = express.Router();
const indicatorService = require('../services/indicatorService');
const { PRIMARY_SYMBOL } = require('../config/pairs');

router.get('/', async (req, res) => {
  try {
    const interval = req.query.interval || '1h';
    const symbol = req.query.symbol || PRIMARY_SYMBOL;
    const indicators = await indicatorService.calculateIndicators(interval, symbol);
    res.json(indicators);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
