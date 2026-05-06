const express = require('express');
const router = express.Router();
const signalService = require('../services/signalService');
const cache = require('../utils/cache');

router.get('/', async (req, res) => {
  try {
    const signal = await signalService.generateSignal();
    res.json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    cache.del('current_signal');
    cache.del('ai_analysis');
    const signal = await signalService.generateSignal();
    res.json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
