const express = require('express');
const router = express.Router();
const marketFocus = require('../services/marketFocusService');
const signalsOrchestrator = require('../services/signalsOrchestrator');

// GET /api/market/focus  → real-time session/news/recommended pairs
router.get('/focus', async (req, res) => {
  try {
    const focus = await marketFocus.getMarketFocus();
    res.json(focus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/watchlist  → strategies that are 50%+ ready (not fired yet)
router.get('/watchlist', async (req, res) => {
  try {
    const wl = await signalsOrchestrator.getWatchlist();
    res.json(wl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
