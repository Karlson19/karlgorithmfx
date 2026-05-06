const express = require('express');
const router = express.Router();
const newsService = require('../services/newsService');

router.get('/', async (req, res) => {
  try {
    const news = await newsService.fetchNews();
    const { currency, impact } = req.query;

    let filtered = news;
    if (currency && currency !== 'ALL') {
      filtered = filtered.filter(n => n.currency === currency);
    }
    if (impact === 'HIGH') {
      filtered = filtered.filter(n => n.impact === 'HIGH');
    }

    const hasHighImpact = newsService.hasHighImpactNewsNearby(news, 60);
    res.json({ news: filtered, has_high_impact_nearby: hasHighImpact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
