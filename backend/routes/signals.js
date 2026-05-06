const express = require('express');
const router = express.Router();
const signalService = require('../services/signalService');
const signalHistoryService = require('../services/signalHistoryService');
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

router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const history = await signalHistoryService.getSignalHistory(limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await signalHistoryService.getSignalStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
