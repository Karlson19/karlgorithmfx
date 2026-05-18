const express = require('express');
const router = express.Router();
const signalService = require('../services/signalService');
const signalsOrchestrator = require('../services/signalsOrchestrator');
const signalHistoryService = require('../services/signalHistoryService');
const calibration = require('../services/calibrationService');
const cache = require('../utils/cache');
const { PRIMARY_SYMBOL, listEnabledSymbols } = require('../config/pairs');

// GET /api/signals?symbol=EUR/USD  → single-pair signal
router.get('/', async (req, res) => {
  try {
    const symbol = req.query.symbol || PRIMARY_SYMBOL;
    const signal = await signalService.generateSignal(symbol);
    res.json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signals/all  → every enabled pair, ranked
router.get('/all', async (req, res) => {
  try {
    const out = await signalsOrchestrator.generateAllSignals();
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signals/refresh?symbol=…  → bust cache + regenerate
router.post('/refresh', async (req, res) => {
  try {
    const symbol = req.query.symbol || PRIMARY_SYMBOL;
    cache.del(`current_signal_${symbol}`);
    cache.del(`ai_analysis_${symbol}`);
    cache.del('signals_all_v1');
    const signal = await signalService.generateSignal(symbol);
    res.json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signals/refresh/all  → bust all signal caches
router.post('/refresh/all', async (req, res) => {
  try {
    for (const sym of listEnabledSymbols()) {
      cache.del(`current_signal_${sym}`);
      cache.del(`ai_analysis_${sym}`);
    }
    cache.del('signals_all_v1');
    const out = await signalsOrchestrator.generateAllSignals();
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signals/history?symbol=…&limit=50
router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const symbol = req.query.symbol || null;
    const history = await signalHistoryService.getSignalHistory(limit, symbol);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signals/stats?symbol=…  → overall + per-pair breakdown
router.get('/stats', async (req, res) => {
  try {
    const symbol = req.query.symbol || null;
    const stats = await signalHistoryService.getSignalStats(symbol);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signals/calibration  → confidence-band → win-rate table per pair
router.get('/calibration', async (req, res) => {
  try {
    const table = await calibration.getFullTable();
    res.json({ table, min_samples: calibration.MIN_SAMPLES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
