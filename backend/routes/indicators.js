const express = require('express');
const router = express.Router();
const indicatorService = require('../services/indicatorService');

router.get('/', async (req, res) => {
  try {
    const { interval = '1h' } = req.query;
    const indicators = await indicatorService.calculateIndicators(interval);
    res.json(indicators);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
